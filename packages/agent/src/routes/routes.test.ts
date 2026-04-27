/**
 * Integration tests for HTTP routes (annotations, hosts, read-marks).
 * Uses a temp config dir + DB and Hono's app.fetch.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { Hono } from 'hono';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'review-app-routes-'));
  process.env.REVIEW_APP_CONFIG_DIR = dir;
  process.env.REVIEW_APP_DB_PATH = join(dir, 'db.sqlite');
});

afterEach(async () => {
  const ann = await import('../db/annotations');
  ann.__closeDbForTests();
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
  delete process.env.REVIEW_APP_CONFIG_DIR;
  delete process.env.REVIEW_APP_DB_PATH;
});

async function buildApp() {
  const { ExecutorPool } = await import('../remote/pool');
  const { hostsRoutes } = await import('./hosts');
  const { reposRoutes } = await import('./repos');
  const { diffRoutes } = await import('./diff');
  const { annotationsRoutes } = await import('./annotations');
  const { readMarksRoutes } = await import('./read-marks');
  const cfg = await import('../config/store');
  cfg.__resetConfigCacheForTests();
  const pool = new ExecutorPool();
  const app = new Hono();
  app.route('/api/hosts', hostsRoutes(pool));
  app.route('/api/repos', reposRoutes(pool));
  app.route('/api/diff', diffRoutes(pool));
  app.route('/api/annotations', annotationsRoutes());
  app.route('/api/read-marks', readMarksRoutes());
  return { app, pool };
}

function jsonReq(path: string, init: RequestInit = {}) {
  return new Request('http://localhost' + path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
}

describe('hosts routes', () => {
  it('lists empty initially', async () => {
    const { app } = await buildApp();
    const res = await app.fetch(jsonReq('/api/hosts'));
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.hosts).toEqual([]);
  });

  it('rejects POST with missing fields (400)', async () => {
    const { app } = await buildApp();
    const res = await app.fetch(
      jsonReq('/api/hosts', { method: 'POST', body: JSON.stringify({ alias: 'a' }) }),
    );
    expect(res.status).toBe(400);
  });

  it('creates a host (200) and rejects duplicate alias (409)', async () => {
    const { app } = await buildApp();
    const keyPath = join(dir, 'fake-key');
    writeFileSync(keyPath, 'not-a-real-key');
    const body = JSON.stringify({
      alias: 'a',
      kind: 'ssh',
      auth: 'key',
      hostname: 'h',
      user: 'u',
      keyPath,
    });
    const r1 = await app.fetch(jsonReq('/api/hosts', { method: 'POST', body }));
    expect(r1.status).toBe(200);

    const r2 = await app.fetch(jsonReq('/api/hosts', { method: 'POST', body }));
    expect(r2.status).toBe(409);
    const dupBody = await r2.json() as any;
    expect(dupBody.error).toMatch(/already exists/);
  });

  it('PUT returns 404 for unknown alias', async () => {
    const { app } = await buildApp();
    const r = await app.fetch(
      jsonReq('/api/hosts/nope', { method: 'PUT', body: '{}' }),
    );
    expect(r.status).toBe(404);
  });

  it('DELETE removes a host', async () => {
    const { app } = await buildApp();
    const keyPath = join(dir, 'fake-key');
    writeFileSync(keyPath, 'x');
    await app.fetch(
      jsonReq('/api/hosts', {
        method: 'POST',
        body: JSON.stringify({ alias: 'b', hostname: 'h', user: 'u', keyPath }),
      }),
    );
    const r = await app.fetch(jsonReq('/api/hosts/b', { method: 'DELETE' }));
    expect(r.status).toBe(200);
    const after = await app.fetch(jsonReq('/api/hosts'));
    expect((await after.json() as any).hosts).toEqual([]);
  });

  it('passphrase endpoint stores in pool', async () => {
    const { app, pool } = await buildApp();
    const r = await app.fetch(
      jsonReq('/api/hosts/x/passphrase', {
        method: 'POST',
        body: JSON.stringify({ passphrase: 'secret' }),
      }),
    );
    expect(r.status).toBe(200);
    expect(pool.hasPassphrase('x')).toBe(true);
  });

  it('creates a local host', async () => {
    const { app } = await buildApp();
    const r = await app.fetch(
      jsonReq('/api/hosts', {
        method: 'POST',
        body: JSON.stringify({ alias: 'local', kind: 'local' }),
      }),
    );
    expect(r.status).toBe(200);
    const body = await r.json() as any;
    expect(body.host).toEqual({ alias: 'local', kind: 'local' });
  });

  it('stores password auth host credentials in memory only', async () => {
    const { app } = await buildApp();
    const create = await app.fetch(
      jsonReq('/api/hosts', {
        method: 'POST',
        body: JSON.stringify({
          alias: 'pw',
          kind: 'ssh',
          auth: 'password',
          hostname: 'example.com',
          user: 'me',
          password: 'secret',
        }),
      }),
    );
    expect(create.status).toBe(200);

    const list = await app.fetch(jsonReq('/api/hosts'));
    const body = await list.json() as any;
    expect(body.credentialLoaded).toContain('pw');
    expect(body.hosts[0]).toEqual({
      alias: 'pw',
      kind: 'ssh',
      auth: 'password',
      hostname: 'example.com',
      user: 'me',
      port: 22,
    });
  });
});

describe('local host repo routes', () => {
  it('validates and reads diffs from a local git repository', async () => {
    const { app } = await buildApp();
    const repo = createLocalRepo();

    const hostRes = await app.fetch(
      jsonReq('/api/hosts', {
        method: 'POST',
        body: JSON.stringify({ alias: 'local', kind: 'local' }),
      }),
    );
    expect(hostRes.status).toBe(200);

    const validate = await app.fetch(
      jsonReq('/api/repos/local/validate', {
        method: 'POST',
        body: JSON.stringify({ path: repo }),
      }),
    );
    expect(validate.status).toBe(200);
    expect((await validate.json() as any).ok).toBe(true);

    const changes = await app.fetch(
      jsonReq(`/api/diff/local/changes?repo=${encodeURIComponent(repo)}`),
    );
    expect(changes.status).toBe(200);
    const summary = await changes.json() as any;
    expect(summary.hasChanges).toBe(true);
    expect(summary.files[0]).toMatchObject({ path: 'hello.txt', status: 'modified' });

    const file = await app.fetch(
      jsonReq(
        `/api/diff/local/file?repo=${encodeURIComponent(repo)}&path=${encodeURIComponent('hello.txt')}&status=modified`,
      ),
    );
    expect(file.status).toBe(200);
    const diff = await file.json() as any;
    expect(diff.patch).toContain('+hello again');

    const content = await app.fetch(
      jsonReq(
        `/api/diff/local/content?repo=${encodeURIComponent(repo)}&path=${encodeURIComponent('hello.txt')}&side=new`,
      ),
    );
    expect(content.status).toBe(200);
    expect((await content.json() as any).content).toContain('hello again');
  });
});

describe('annotations routes', () => {
  it('rejects GET without host/repo', async () => {
    const { app } = await buildApp();
    const r = await app.fetch(jsonReq('/api/annotations'));
    expect(r.status).toBe(400);
  });

  it('full CRUD lifecycle', async () => {
    const { app } = await buildApp();
    const create = await app.fetch(
      jsonReq('/api/annotations', {
        method: 'POST',
        body: JSON.stringify({
          hostAlias: 'h',
          repoPath: '/r',
          filePath: 'f.ts',
          side: 'new',
          quotedStartLine: 1,
          quotedLines: 'a\nb\nc\nd\ne',
          quotedLang: 'ts',
          body: 'hi',
        }),
      }),
    );
    expect(create.status).toBe(200);
    const created = (await create.json() as any).annotation;
    expect(created.id).toBeTruthy();

    const list = await app.fetch(jsonReq('/api/annotations?host=h&repo=/r'));
    expect((await list.json() as any).annotations).toHaveLength(1);

    const patch = await app.fetch(
      jsonReq('/api/annotations/' + created.id, {
        method: 'PATCH',
        body: JSON.stringify({ body: 'updated' }),
      }),
    );
    expect(patch.status).toBe(200);

    const list2 = await app.fetch(jsonReq('/api/annotations?host=h&repo=/r'));
    expect((await list2.json() as any).annotations[0].body).toBe('updated');

    const del = await app.fetch(
      jsonReq('/api/annotations/' + created.id, { method: 'DELETE' }),
    );
    expect(del.status).toBe(200);

    const list3 = await app.fetch(jsonReq('/api/annotations?host=h&repo=/r'));
    expect((await list3.json() as any).annotations).toEqual([]);
  });

  it('rejects invalid create payload', async () => {
    const { app } = await buildApp();
    const r = await app.fetch(
      jsonReq('/api/annotations', {
        method: 'POST',
        body: JSON.stringify({ hostAlias: 'h' }),
      }),
    );
    expect(r.status).toBe(400);
  });
});

function createLocalRepo(): string {
  const repo = join(dir, 'repo');
  mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init'], { cwd: repo, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], {
    cwd: repo,
    stdio: 'pipe',
  });
  execFileSync('git', ['config', 'user.name', 'Test User'], {
    cwd: repo,
    stdio: 'pipe',
  });
  writeFileSync(join(repo, 'hello.txt'), 'hello\n');
  execFileSync('git', ['add', 'hello.txt'], { cwd: repo, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: repo, stdio: 'pipe' });
  writeFileSync(join(repo, 'hello.txt'), 'hello again\n');
  return repo;
}

describe('read-marks routes', () => {
  it('add then list, then delete', async () => {
    const { app } = await buildApp();
    const mark = {
      hostAlias: 'h',
      repoPath: '/r',
      filePath: 'f.ts',
      contentHash: 'abc',
    };
    const post = await app.fetch(
      jsonReq('/api/read-marks', { method: 'POST', body: JSON.stringify(mark) }),
    );
    expect(post.status).toBe(200);

    const list = await app.fetch(jsonReq('/api/read-marks?host=h&repo=/r'));
    expect((await list.json() as any).marks).toHaveLength(1);

    // Re-add same file replaces the mark instead of duplicating
    await app.fetch(
      jsonReq('/api/read-marks', {
        method: 'POST',
        body: JSON.stringify({ ...mark, contentHash: 'def' }),
      }),
    );
    const list2 = await app.fetch(jsonReq('/api/read-marks?host=h&repo=/r'));
    const marks = (await list2.json() as any).marks;
    expect(marks).toHaveLength(1);
    expect(marks[0].contentHash).toBe('def');

    const del = await app.fetch(
      jsonReq('/api/read-marks', { method: 'DELETE', body: JSON.stringify(mark) }),
    );
    expect(del.status).toBe(200);
    const list3 = await app.fetch(jsonReq('/api/read-marks?host=h&repo=/r'));
    expect((await list3.json() as any).marks).toEqual([]);
  });
});
