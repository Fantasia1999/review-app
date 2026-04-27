/**
 * Git operations on a remote working tree, via a RemoteExecutor.
 *
 * All paths are POSIX (the remote is assumed to be unix-like). All paths
 * passed in from outside (repo path, file path) are escaped before being
 * concatenated into shell commands - see utils/shell.ts.
 *
 * v1 scope: only HEAD-relative working-tree review.
 *   - listChanges() = `git status` (tracked + untracked)
 *   - getDiff(file)  = `git diff HEAD -- file` for tracked
 *                    | full content as added for untracked
 *   - getHeadSha()   = `git rev-parse HEAD`
 *   - validateRepo() = `git rev-parse --is-inside-work-tree`
 */

import { createHash } from 'node:crypto';
import type { FileChange, FileDiff, FileStatus, DiffSummary, RemoteError } from '@review-app/shared';
import type { RemoteExecutor } from '../remote/executor';
import { RemoteExecError } from '../remote/executor';
import { shellEscape } from '../utils/shell';

const LARGE_FILE_THRESHOLD = 200 * 1024; // 200KB - default-collapsed
const LOCK_FILES = new Set([
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
  'Cargo.lock',
  'go.sum',
  'composer.lock',
  'Gemfile.lock',
  'poetry.lock',
  'Pipfile.lock',
]);

export class GitOps {
  constructor(
    private readonly exec: RemoteExecutor,
    private readonly repoPath: string,
  ) {}

  /** Verify the path is a git work tree. Throws RemoteExecError on failure. */
  async validateRepo(): Promise<void> {
    try {
      const r = await this.exec.exec(
        `git -C ${shellEscape(this.repoPath)} rev-parse --is-inside-work-tree`,
        { timeoutMs: 5000 },
      );
      if (r.code !== 0 || r.stdout.trim() !== 'true') {
        throw new RemoteExecError({
          kind: 'not_a_repo',
          message: 'Path is not inside a git work tree',
          stderr: r.stderr,
          exitCode: r.code,
        });
      }
    } catch (err) {
      if (err instanceof RemoteExecError) throw err;
      // Could be path doesn't exist, or git not installed - try to disambiguate
      const msg = err instanceof Error ? err.message : String(err);
      const kind: RemoteError['kind'] = /no such file|not found/i.test(msg)
        ? 'path_not_found'
        : 'cmd_failed';
      throw new RemoteExecError({ kind, message: msg });
    }
  }

  async getHeadSha(): Promise<string> {
    const r = await this.exec.exec(
      `git -C ${shellEscape(this.repoPath)} rev-parse HEAD`,
      { timeoutMs: 5000 },
    );
    if (r.code !== 0) {
      throw new RemoteExecError({
        kind: 'cmd_failed',
        message: r.stderr.trim() || 'git rev-parse HEAD failed',
        stderr: r.stderr,
        exitCode: r.code,
      });
    }
    return r.stdout.trim();
  }

  /**
   * List all working-tree changes including untracked files.
   * Uses `git status --porcelain=v2 -z --untracked-files=all` for unambiguous parsing.
   */
  async listChanges(): Promise<DiffSummary> {
    const [headSha, statusResult, numstat] = await Promise.all([
      this.getHeadSha(),
      this.exec.exec(
        `git -C ${shellEscape(this.repoPath)} status --porcelain=v2 -z --untracked-files=all`,
        { timeoutMs: 15_000 },
      ),
      this.exec.exec(
        // numstat against HEAD for additions/deletions counts (tracked only)
        `git -C ${shellEscape(this.repoPath)} diff HEAD --numstat -z`,
        { timeoutMs: 15_000 },
      ),
    ]);

    if (statusResult.code !== 0) {
      throw new RemoteExecError({
        kind: 'cmd_failed',
        message: statusResult.stderr.trim() || 'git status failed',
        stderr: statusResult.stderr,
        exitCode: statusResult.code,
      });
    }

    const files = parsePorcelainV2(statusResult.stdout);
    const counts = parseNumstat(numstat.stdout);
    for (const f of files) {
      const c = counts.get(f.path);
      if (c) {
        f.additions = c.additions;
        f.deletions = c.deletions;
        f.binary = c.binary;
      }
    }

    return {
      headSha,
      files,
      hasChanges: files.length > 0,
    };
  }

  /**
   * Get the diff for a single file. For tracked files, returns the unified
   * diff against HEAD. For untracked, returns the full new content.
   */
  async getFileDiff(filePath: string, status: FileStatus): Promise<FileDiff> {
    const isLockfile = LOCK_FILES.has(basename(filePath));

    if (status === 'untracked') {
      // Untracked: read the file directly. Render as added.
      const r = await this.exec.exec(
        `cat ${shellEscape(joinPath(this.repoPath, filePath))}`,
        { timeoutMs: 15_000 },
      );
      if (r.code !== 0) {
        throw new RemoteExecError({
          kind: 'cmd_failed',
          message: r.stderr.trim() || 'cat failed',
          stderr: r.stderr,
          exitCode: r.code,
        });
      }
      const content = r.stdout;
      const binary = isProbablyBinary(content);
      return {
        path: filePath,
        status: 'untracked',
        patch: '',
        newContent: binary ? undefined : content,
        contentHash: sha1(content),
        binary,
        collapsedByDefault:
          isLockfile || content.length > LARGE_FILE_THRESHOLD,
      };
    }

    if (status === 'submodule') {
      return {
        path: filePath,
        status: 'submodule',
        patch: '',
        contentHash: sha1(filePath),
        binary: false,
        collapsedByDefault: true,
      };
    }

    // Tracked: get unified diff
    const r = await this.exec.exec(
      `git -C ${shellEscape(this.repoPath)} diff HEAD --no-color -- ${shellEscape(filePath)}`,
      { timeoutMs: 30_000 },
    );
    if (r.code !== 0) {
      throw new RemoteExecError({
        kind: 'cmd_failed',
        message: r.stderr.trim() || 'git diff failed',
        stderr: r.stderr,
        exitCode: r.code,
      });
    }

    const patch = r.stdout;
    const binary = /^Binary files .* differ$/m.test(patch);
    return {
      path: filePath,
      status,
      patch,
      contentHash: sha1(patch),
      binary,
      collapsedByDefault:
        isLockfile || patch.length > LARGE_FILE_THRESHOLD,
    };
  }

  /**
   * Get the current content of a file (for the quote-block in annotations).
   * For tracked files we use the working-tree version (what the user is reviewing).
   */
  async getFileContent(filePath: string): Promise<string> {
    const r = await this.exec.exec(
      `cat ${shellEscape(joinPath(this.repoPath, filePath))}`,
      { timeoutMs: 15_000 },
    );
    if (r.code !== 0) {
      throw new RemoteExecError({
        kind: 'cmd_failed',
        message: r.stderr.trim() || 'cat failed',
        stderr: r.stderr,
        exitCode: r.code,
      });
    }
    return r.stdout;
  }

  /**
   * Get HEAD version of a file (the "old" side of the diff).
   * Used when an annotation is created on the old side.
   */
  async getFileContentAtHead(filePath: string): Promise<string> {
    const r = await this.exec.exec(
      `git -C ${shellEscape(this.repoPath)} show HEAD:${shellEscape(filePath)}`,
      { timeoutMs: 15_000 },
    );
    if (r.code !== 0) {
      throw new RemoteExecError({
        kind: 'cmd_failed',
        message: r.stderr.trim() || 'git show failed',
        stderr: r.stderr,
        exitCode: r.code,
      });
    }
    return r.stdout;
  }
}

// ============================================================
// Parsing helpers
// ============================================================

/**
 * Parse `git status --porcelain=v2 -z --untracked-files=all` output.
 *
 * Format reference: https://git-scm.com/docs/git-status#_porcelain_format_version_2
 *
 * Records are NUL-terminated. Each record is one of:
 *   1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>            (changed)
 *   2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <X><score> <path>\0<origPath>  (renamed)
 *   u <XY> ...                                              (unmerged)
 *   ? <path>                                                (untracked)
 *   ! <path>                                                (ignored - we don't ask for these)
 */
function parsePorcelainV2(out: string): FileChange[] {
  const files: FileChange[] = [];
  // Records separated by NUL, but renamed records have an embedded NUL between
  // newPath and origPath. We have to walk byte-by-byte.
  const tokens = out.split('\0');
  for (let i = 0; i < tokens.length; i++) {
    const line = tokens[i];
    if (!line) continue;

    if (line.startsWith('1 ')) {
      // changed entry
      const parts = line.split(' ');
      const xy = parts[1] ?? '';
      const sub = parts[2] ?? '';
      const path = parts.slice(8).join(' ');
      files.push({
        path,
        status: classifyXY(xy, sub),
        additions: 0,
        deletions: 0,
        binary: false,
      });
    } else if (line.startsWith('2 ')) {
      // renamed/copied - next token is the original path
      const parts = line.split(' ');
      const xy = parts[1] ?? '';
      const sub = parts[2] ?? '';
      const path = parts.slice(9).join(' ');
      const origPath = tokens[++i] ?? '';
      files.push({
        path,
        oldPath: origPath,
        status: classifyXY(xy, sub) === 'modified' ? 'renamed' : classifyXY(xy, sub),
        additions: 0,
        deletions: 0,
        binary: false,
      });
    } else if (line.startsWith('u ')) {
      // unmerged - treat as modified
      const parts = line.split(' ');
      const path = parts.slice(10).join(' ');
      files.push({
        path,
        status: 'modified',
        additions: 0,
        deletions: 0,
        binary: false,
      });
    } else if (line.startsWith('? ')) {
      files.push({
        path: line.slice(2),
        status: 'untracked',
        additions: 0,
        deletions: 0,
        binary: false,
      });
    }
    // ignore '!' (ignored) and '#' (header)
  }
  return files;
}

/** Classify the XY status field + submodule field into our FileStatus enum. */
function classifyXY(xy: string, sub: string): FileStatus {
  // Submodules: sub starts with 'S' if it's a submodule
  if (sub.startsWith('S')) return 'submodule';
  // X is staged change, Y is unstaged. We treat any non-'.' as a change.
  const x = xy[0];
  const y = xy[1];
  if (x === 'A' || y === 'A') return 'added';
  if (x === 'D' || y === 'D') return 'deleted';
  if (x === 'R' || y === 'R') return 'renamed';
  return 'modified';
}

/** Parse `git diff HEAD --numstat -z` output. */
function parseNumstat(
  out: string,
): Map<string, { additions: number; deletions: number; binary: boolean }> {
  const map = new Map<string, { additions: number; deletions: number; binary: boolean }>();
  // -z: each record is NUL-terminated, but renamed entries have 3 tokens
  const tokens = out.split('\0').filter(Boolean);
  for (let i = 0; i < tokens.length; i++) {
    const line = tokens[i];
    // Format: "<add>\t<del>\t<path>" - note that for renames -z splits across tokens
    const parts = line.split('\t');
    if (parts.length >= 3) {
      const adds = parts[0];
      const dels = parts[1];
      const path = parts[2];
      const binary = adds === '-' && dels === '-';
      map.set(path, {
        additions: binary ? 0 : parseInt(adds, 10) || 0,
        deletions: binary ? 0 : parseInt(dels, 10) || 0,
        binary,
      });
    }
  }
  return map;
}

function basename(p: string): string {
  const idx = p.lastIndexOf('/');
  return idx === -1 ? p : p.slice(idx + 1);
}

function joinPath(a: string, b: string): string {
  if (a.endsWith('/')) return a + b;
  return a + '/' + b;
}

function sha1(s: string): string {
  return createHash('sha1').update(s).digest('hex');
}

/** Heuristic: if the first 8KB has any NUL bytes, treat as binary. */
function isProbablyBinary(s: string): boolean {
  const sample = s.slice(0, 8192);
  return sample.includes('\0');
}
