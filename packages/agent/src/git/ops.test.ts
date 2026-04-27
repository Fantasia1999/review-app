import { describe, expect, it } from 'bun:test';
import { GitOps, parsePorcelainV2, parseNumstat } from './ops';
import { RemoteExecError, type ExecResult, type RemoteExecutor } from '../remote/executor';

class MockExecutor implements RemoteExecutor {
  public calls: { cmd: string; opts: any }[] = [];
  constructor(
    private handler: (cmd: string) => ExecResult | Promise<ExecResult>,
  ) {}
  async exec(cmd: string, opts: any = {}) {
    this.calls.push({ cmd, opts });
    return await this.handler(cmd);
  }
  execStream(): AsyncIterable<Uint8Array> {
    throw new Error('not implemented');
  }
  async close() {}
  isReady() {
    return true;
  }
}

const ok = (stdout = '', stderr = '', code = 0): ExecResult => ({ stdout, stderr, code });

describe('parsePorcelainV2', () => {
  it('returns empty list for empty input', () => {
    expect(parsePorcelainV2('')).toEqual([]);
  });

  it('parses changed (1) entries', () => {
    const out = '1 .M N... 100644 100644 100644 abc123 def456 src/foo.ts\0';
    const r = parsePorcelainV2(out);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ path: 'src/foo.ts', status: 'modified' });
  });

  it('parses added entries', () => {
    const out = '1 A. N... 000000 100644 100644 0000000 abc123 new.ts\0';
    const r = parsePorcelainV2(out);
    expect(r[0].status).toBe('added');
  });

  it('parses deleted entries', () => {
    const out = '1 .D N... 100644 100644 000000 abc 000 gone.ts\0';
    const r = parsePorcelainV2(out);
    expect(r[0].status).toBe('deleted');
  });

  it('parses untracked (?) entries', () => {
    const out = '? newfile.txt\0';
    const r = parsePorcelainV2(out);
    expect(r).toEqual([
      { path: 'newfile.txt', status: 'untracked', additions: 0, deletions: 0, binary: false },
    ]);
  });

  it('parses renamed (2) entries with both paths', () => {
    const out = '2 R. N... 100644 100644 100644 abc def R100 newpath.ts\0oldpath.ts\0';
    const r = parsePorcelainV2(out);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      path: 'newpath.ts',
      oldPath: 'oldpath.ts',
      status: 'renamed',
    });
  });

  it('classifies submodules', () => {
    const out = '1 .M S... 160000 160000 160000 abc def vendored\0';
    const r = parsePorcelainV2(out);
    expect(r[0].status).toBe('submodule');
  });

  it('handles mixed entries', () => {
    const out =
      '1 .M N... 100644 100644 100644 a b foo.ts\0' +
      '? new.txt\0' +
      '1 A. N... 000000 100644 100644 0 a added.ts\0';
    const r = parsePorcelainV2(out);
    expect(r.map((f) => [f.path, f.status])).toEqual([
      ['foo.ts', 'modified'],
      ['new.txt', 'untracked'],
      ['added.ts', 'added'],
    ]);
  });
});

describe('parseNumstat', () => {
  it('parses additions/deletions', () => {
    const out = '3\t1\tfoo.ts\0' + '10\t0\tnew.ts\0';
    const m = parseNumstat(out);
    expect(m.get('foo.ts')).toEqual({ additions: 3, deletions: 1, binary: false });
    expect(m.get('new.ts')).toEqual({ additions: 10, deletions: 0, binary: false });
  });

  it('marks binary files when adds/dels are "-"', () => {
    const out = '-\t-\timage.png\0';
    const m = parseNumstat(out);
    expect(m.get('image.png')).toEqual({ additions: 0, deletions: 0, binary: true });
  });

  it('returns empty map for empty input', () => {
    expect(parseNumstat('').size).toBe(0);
  });
});

describe('GitOps.validateRepo', () => {
  it('passes when git rev-parse returns true', async () => {
    const exec = new MockExecutor(() => ok('true\n'));
    const ops = new GitOps(exec, '/repo');
    await ops.validateRepo();
    expect(exec.calls[0].cmd).toContain('rev-parse --is-inside-work-tree');
    expect(exec.calls[0].cmd).toContain('/repo');
  });

  it('throws not_a_repo when stdout is not "true"', async () => {
    const exec = new MockExecutor(() => ok('', 'fatal', 128));
    const ops = new GitOps(exec, '/repo');
    await expect(ops.validateRepo()).rejects.toBeInstanceOf(RemoteExecError);
  });

  it('escapes the repo path', async () => {
    const exec = new MockExecutor(() => ok('true\n'));
    const ops = new GitOps(exec, "/tmp/it's mine");
    await ops.validateRepo();
    expect(exec.calls[0].cmd).toContain("'/tmp/it'\\''s mine'");
  });
});

describe('GitOps.getFileDiff', () => {
  it('returns full content for untracked', async () => {
    const exec = new MockExecutor((cmd) => {
      if (cmd.startsWith('cat ')) return ok('hello\nworld\n');
      return ok('', '', 1);
    });
    const ops = new GitOps(exec, '/repo');
    const fd = await ops.getFileDiff('new.txt', 'untracked');
    expect(fd.status).toBe('untracked');
    expect(fd.newContent).toBe('hello\nworld\n');
    expect(fd.binary).toBe(false);
    expect(fd.contentHash).toMatch(/^[a-f0-9]{40}$/);
  });

  it('marks lockfiles as collapsedByDefault', async () => {
    const exec = new MockExecutor(() => ok('--- a\n+++ b\n'));
    const ops = new GitOps(exec, '/repo');
    const fd = await ops.getFileDiff('package-lock.json', 'modified');
    expect(fd.collapsedByDefault).toBe(true);
  });

  it('returns submodule placeholder', async () => {
    const exec = new MockExecutor(() => ok(''));
    const ops = new GitOps(exec, '/repo');
    const fd = await ops.getFileDiff('vendor/sub', 'submodule');
    expect(fd.status).toBe('submodule');
    expect(fd.collapsedByDefault).toBe(true);
  });

  it('detects binary diffs', async () => {
    const exec = new MockExecutor(() =>
      ok('diff --git a/x b/x\nBinary files a/x and b/x differ\n'),
    );
    const ops = new GitOps(exec, '/repo');
    const fd = await ops.getFileDiff('x', 'modified');
    expect(fd.binary).toBe(true);
  });
});

describe('GitOps.listChanges', () => {
  it('combines status and numstat', async () => {
    const exec = new MockExecutor((cmd) => {
      if (cmd.includes('rev-parse HEAD')) return ok('abc1234\n');
      if (cmd.includes('--porcelain=v2'))
        return ok('1 .M N... 100644 100644 100644 a b foo.ts\0? new.txt\0');
      if (cmd.includes('--numstat')) return ok('5\t2\tfoo.ts\0');
      return ok('');
    });
    const ops = new GitOps(exec, '/repo');
    const summary = await ops.listChanges();
    expect(summary.headSha).toBe('abc1234');
    expect(summary.hasChanges).toBe(true);
    expect(summary.files).toHaveLength(2);
    const foo = summary.files.find((f) => f.path === 'foo.ts')!;
    expect(foo.additions).toBe(5);
    expect(foo.deletions).toBe(2);
  });
});
