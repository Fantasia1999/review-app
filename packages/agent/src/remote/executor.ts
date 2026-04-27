/**
 * RemoteExecutor: the abstraction that lets us run commands on a remote host.
 *
 * Current implementation: SSHExecutor (one ssh2 connection per host, multiplexed channels).
 * Future implementation: DaemonExecutor (talks to a small process running on the remote
 * over a unix socket forwarded through SSH, for stateful ops + file watching).
 *
 * The boundary is deliberately small - only exec/execStream/close. Anything more
 * (file watching, push notifications, cached state) belongs in the daemon-only layer.
 */

import type { RemoteError } from '@review-app/shared';

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

export interface ExecOptions {
  /** Working directory on remote (gets passed via `cd` since exec runs in fresh shell) */
  cwd?: string;
  /** Max bytes to buffer in stdout. Anything bigger should use execStream. */
  maxBytes?: number;
  /** Timeout in ms */
  timeoutMs?: number;
}

export interface RemoteExecutor {
  /** Buffered exec - returns full stdout/stderr as strings. Use for small outputs. */
  exec(cmd: string, opts?: ExecOptions): Promise<ExecResult>;

  /**
   * Streaming exec - yields stdout chunks. stderr is collected and thrown if exit != 0.
   * Use for large diffs / file contents.
   */
  execStream(cmd: string, opts?: ExecOptions): AsyncIterable<Uint8Array>;

  /** Drop the connection. Idempotent. */
  close(): Promise<void>;

  /** True if currently connected and ready */
  isReady(): boolean;
}

/** Standard error class - carries enough info for UI to render properly */
export class RemoteExecError extends Error {
  constructor(public readonly info: RemoteError) {
    super(info.message);
    this.name = 'RemoteExecError';
  }
}
