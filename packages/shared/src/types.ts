/**
 * Shared types between agent and client.
 * This is the API contract - changes here ripple to both sides.
 */

// ============================================================
// Host config (local or SSH connection)
// ============================================================

export interface BaseHostConfig {
  /** UI display name + lookup key */
  alias: string;
  kind: 'local' | 'ssh' | 'wsl';
}

export interface LocalHostConfig extends BaseHostConfig {
  kind: 'local';
}

/**
 * A directory inside a WSL distro on Windows. Commands run via `wsl.exe -d <distro>`,
 * so the remote requirement (just `git`) applies to the WSL distro, not Windows itself.
 * Paths are POSIX, evaluated inside the distro.
 */
export interface WslHostConfig extends BaseHostConfig {
  kind: 'wsl';
  /** WSL distribution name, e.g. "Ubuntu" or "Debian". */
  distro: string;
}

export interface SshHostConfigBase extends BaseHostConfig {
  kind: 'ssh';
  hostname: string;
  user: string;
  port: number;
  auth: 'key' | 'password';
}

export interface SshKeyHostConfig extends SshHostConfigBase {
  auth: 'key';
  /** Absolute path to private key file on local disk */
  keyPath: string;
  /** True if private key is encrypted (detected on save) */
  hasPassphrase: boolean;
}

export interface SshPasswordHostConfig extends SshHostConfigBase {
  auth: 'password';
}

export type SshHostConfig = SshKeyHostConfig | SshPasswordHostConfig;
export type HostConfig = LocalHostConfig | SshHostConfig | WslHostConfig;

export interface CreateLocalHostInput {
  alias: string;
  kind: 'local';
}

export interface CreateWslHostInput {
  alias: string;
  kind: 'wsl';
  distro: string;
}

export interface CreateSshKeyHostInput {
  alias: string;
  kind: 'ssh';
  hostname: string;
  user: string;
  port?: number;
  auth: 'key';
  keyPath: string;
}

export interface CreateSshPasswordHostInput {
  alias: string;
  kind: 'ssh';
  hostname: string;
  user: string;
  port?: number;
  auth: 'password';
  /** Memory-only; never persisted to config. */
  password?: string;
}

export type CreateHostInput =
  | CreateLocalHostInput
  | CreateSshKeyHostInput
  | CreateSshPasswordHostInput
  | CreateWslHostInput;

export interface HostStatus {
  alias: string;
  state: 'disconnected' | 'connecting' | 'connected' | 'error';
  error?: string;
}

// ============================================================
// Repo + recents
// ============================================================

export interface RepoEntry {
  /** Absolute path on remote host */
  path: string;
  /** Last opened (epoch ms) */
  lastOpenedAt: number;
}

// ============================================================
// Diff + changes
// ============================================================

export type FileStatus =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'untracked'
  | 'submodule';

export interface FileChange {
  path: string;
  /** Set when status === 'renamed' */
  oldPath?: string;
  status: FileStatus;
  /** Lines added (best-effort, may be 0 for binary) */
  additions: number;
  deletions: number;
  /** True if file is binary (will not have a text diff) */
  binary: boolean;
}

export interface DiffSummary {
  /** HEAD commit sha at the time of fetch (used for read-mark invalidation) */
  headSha: string;
  files: FileChange[];
  /** Whether there's a dirty working tree at all */
  hasChanges: boolean;
}

/** Per-file unified diff (raw git diff output for that one file) */
export interface FileDiff {
  path: string;
  status: FileStatus;
  /** Unified diff text (may be empty for binary/untracked) */
  patch: string;
  /** For untracked files: full new content */
  newContent?: string;
  /** SHA1 of new content - used as cache key for read marks */
  contentHash: string;
  binary: boolean;
  /** True if this file was force-collapsed (size or lockfile heuristic) */
  collapsedByDefault: boolean;
}

// ============================================================
// Annotations
// ============================================================

export interface Annotation {
  id: string;
  hostAlias: string;
  /** Repo absolute path on remote */
  repoPath: string;
  filePath: string;
  /** Side of diff this was created on */
  side: 'old' | 'new';
  /** First line of the quoted block (1-based, in the file at creation time) */
  quotedStartLine: number;
  /** Always 5 lines, joined with \n */
  quotedLines: string;
  /** Detected language for syntax highlighting in the quote */
  quotedLang: string;
  /** Markdown */
  body: string;
  createdAt: number;
}

export interface CreateAnnotationInput {
  hostAlias: string;
  repoPath: string;
  filePath: string;
  side: 'old' | 'new';
  quotedStartLine: number;
  quotedLines: string;
  quotedLang: string;
  body: string;
}

// ============================================================
// Errors (returned to client with stderr preserved)
// ============================================================

export interface RemoteError {
  kind:
    | 'ssh_connect_failed'
    | 'ssh_auth_failed'
    | 'ssh_password_required'
    | 'ssh_password_wrong'
    | 'ssh_passphrase_required'
    | 'ssh_passphrase_wrong'
    | 'cmd_failed'
    | 'not_a_repo'
    | 'path_not_found'
    | 'unknown';
  message: string;
  /** Original stderr from the remote command, unmodified */
  stderr?: string;
  /** Exit code if applicable */
  exitCode?: number;
}

// ============================================================
// Read marks (file-level)
// ============================================================

export interface ReadMark {
  hostAlias: string;
  repoPath: string;
  filePath: string;
  /** sha1(content) at time of marking - mark is valid only if this matches */
  contentHash: string;
}

// ============================================================
// Config file shape
// ============================================================

export interface AppConfig {
  version: 3;
  hosts: HostConfig[];
  recentRepos: Record<string, RepoEntry[]>; // hostAlias -> recent repos
  readMarks: ReadMark[];
  ui: {
    theme: 'light' | 'dark' | 'auto';
    annotationLayout: 'inline' | 'sidebar';
    fileTreeMode: 'auto' | 'flat' | 'tree';
  };
}

export const DEFAULT_CONFIG: AppConfig = {
  version: 3,
  hosts: [],
  recentRepos: {},
  readMarks: [],
  ui: {
    theme: 'auto',
    annotationLayout: 'inline',
    fileTreeMode: 'auto',
  },
};
