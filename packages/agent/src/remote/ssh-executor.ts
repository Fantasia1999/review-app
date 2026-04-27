/**
 * SSH implementation of RemoteExecutor.
 *
 * One ssh2 Client per host, kept alive while in use. Channels (exec calls)
 * are multiplexed over the single TCP connection by ssh2.
 *
 * Auth: direct private key or password auth. Key passphrases and SSH
 * passwords are supplied by the local agent and held in memory only.
 * We do not consult ssh-agent or system keychain - that's intentional.
 */

import { Client } from 'ssh2';
import { readFile } from 'node:fs/promises';
import type { SshHostConfig } from '@review-app/shared';
import {
  RemoteExecutor,
  ExecResult,
  ExecOptions,
  RemoteExecError,
} from './executor';
import { shellEscape } from '../utils/shell';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_BYTES = 50 * 1024 * 1024; // 50MB - large but bounded for buffered exec

export class SSHExecutor implements RemoteExecutor {
  private conn: Client | null = null;
  private connectPromise: Promise<void> | null = null;
  private connected = false;

  constructor(
    private readonly host: SshHostConfig,
    private readonly secret: string | undefined,
  ) {}

  isReady(): boolean {
    return this.connected;
  }

  /** Lazily establish the SSH connection. Idempotent - subsequent calls share the promise. */
  private connect(): Promise<void> {
    if (this.connectPromise) return this.connectPromise;

    this.connectPromise = (async () => {
      const privateKey =
        this.host.auth === 'key'
          ? await readFile(this.host.keyPath)
          : undefined;

      if (this.host.auth === 'key' && this.host.hasPassphrase && !this.secret) {
        throw new RemoteExecError({
          kind: 'ssh_passphrase_required',
          message: 'Private key requires a passphrase',
        });
      }
      if (this.host.auth === 'password' && !this.secret) {
        throw new RemoteExecError({
          kind: 'ssh_password_required',
          message: 'SSH password required',
        });
      }

      await new Promise<void>((resolve, reject) => {
        const client = new Client();

        const onError = (err: Error & { level?: string }) => {
          // Map ssh2 errors to our typed RemoteError so UI can render properly
          const msg = err.message || String(err);
          if (/encrypted/i.test(msg) || err.level === 'client-authentication') {
            if (this.host.auth === 'password') {
              if (!this.secret) {
                reject(
                  new RemoteExecError({
                    kind: 'ssh_password_required',
                    message: 'SSH password required',
                  }),
                );
                return;
              }
              reject(
                new RemoteExecError({
                  kind: 'ssh_password_wrong',
                  message: 'Wrong SSH password',
                }),
              );
              return;
            }
            if (this.host.hasPassphrase && !this.secret) {
              reject(
                new RemoteExecError({
                  kind: 'ssh_passphrase_required',
                  message: 'Private key requires a passphrase',
                }),
              );
              return;
            }
            if (/passphrase|bad passphrase|integrity/i.test(msg)) {
              reject(
                new RemoteExecError({
                  kind: 'ssh_passphrase_wrong',
                  message: 'Wrong passphrase for private key',
                }),
              );
              return;
            }
            reject(
              new RemoteExecError({
                kind: 'ssh_auth_failed',
                message: msg,
              }),
            );
            return;
          }
          reject(
            new RemoteExecError({
              kind: 'ssh_connect_failed',
              message: msg,
            }),
          );
        };

        client.once('error', onError);
        client.once('ready', () => {
          client.removeListener('error', onError);
          // Re-attach a permanent error handler so unexpected drops don't crash
          client.on('error', (err) => {
            console.error('[ssh] connection error:', err.message);
            this.connected = false;
          });
          client.on('close', () => {
            this.connected = false;
          });
          this.conn = client;
          this.connected = true;
          resolve();
        });

        try {
          client.connect({
            host: this.host.hostname,
            port: this.host.port,
            username: this.host.user,
            privateKey,
            password: this.host.auth === 'password' ? this.secret : undefined,
            passphrase: this.host.auth === 'key' ? this.secret : undefined,
            keepaliveInterval: 30_000,
            readyTimeout: 15_000,
          });
        } catch (err) {
          onError(err as Error);
        }
      });
    })();

    return this.connectPromise;
  }

  async exec(cmd: string, opts: ExecOptions = {}): Promise<ExecResult> {
    await this.connect();
    if (!this.conn) throw new Error('not connected');

    const fullCmd = opts.cwd
      ? `cd ${shellEscape(opts.cwd)} && ${cmd}`
      : cmd;
    const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    return await new Promise<ExecResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new RemoteExecError({
            kind: 'cmd_failed',
            message: `Command timed out after ${timeoutMs}ms`,
          }),
        );
      }, timeoutMs);

      this.conn!.exec(fullCmd, (err, stream) => {
        if (err) {
          clearTimeout(timer);
          return reject(
            new RemoteExecError({
              kind: 'cmd_failed',
              message: err.message,
            }),
          );
        }
        const stdoutChunks: Buffer[] = [];
        const stderrChunks: Buffer[] = [];
        let stdoutBytes = 0;

        stream.on('data', (d: Buffer) => {
          stdoutBytes += d.length;
          if (stdoutBytes > maxBytes) {
            stream.close();
            clearTimeout(timer);
            reject(
              new RemoteExecError({
                kind: 'cmd_failed',
                message: `Output exceeded ${maxBytes} bytes (use execStream for large outputs)`,
              }),
            );
            return;
          }
          stdoutChunks.push(d);
        });
        stream.stderr.on('data', (d: Buffer) => {
          stderrChunks.push(d);
        });
        stream.on('close', (code: number) => {
          clearTimeout(timer);
          resolve({
            stdout: Buffer.concat(stdoutChunks).toString('utf8'),
            stderr: Buffer.concat(stderrChunks).toString('utf8'),
            code: code ?? 0,
          });
        });
      });
    });
  }

  async *execStream(
    cmd: string,
    opts: ExecOptions = {},
  ): AsyncIterable<Uint8Array> {
    await this.connect();
    if (!this.conn) throw new Error('not connected');

    const fullCmd = opts.cwd
      ? `cd ${shellEscape(opts.cwd)} && ${cmd}`
      : cmd;

    const stream = await new Promise<NodeJS.ReadableStream & {
      stderr: NodeJS.ReadableStream;
      on(event: 'close', cb: (code: number) => void): unknown;
    }>((resolve, reject) => {
      this.conn!.exec(fullCmd, (err, s) => (err ? reject(err) : resolve(s as never)));
    });

    let exitCode = 0;
    const stderrChunks: Buffer[] = [];
    const closePromise = new Promise<void>((resolve) => {
      stream.on('close', (code) => {
        exitCode = code ?? 0;
        resolve();
      });
    });
    stream.stderr.on('data', (d: Buffer) => stderrChunks.push(d));

    for await (const chunk of stream) {
      yield chunk as Uint8Array;
    }

    await closePromise;

    if (exitCode !== 0) {
      const stderr = Buffer.concat(stderrChunks).toString('utf8');
      throw new RemoteExecError({
        kind: 'cmd_failed',
        message: stderr.trim() || `Command exited with code ${exitCode}`,
        stderr,
        exitCode,
      });
    }
  }

  async close(): Promise<void> {
    if (this.conn) {
      this.conn.end();
      this.conn = null;
    }
    this.connected = false;
    this.connectPromise = null;
  }
}
