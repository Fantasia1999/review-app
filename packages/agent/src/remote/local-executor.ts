/**
 * Local implementation of RemoteExecutor.
 *
 * This avoids going through a platform shell so it works on Windows too.
 * We only support the command shapes our app emits today: `git ...` and `cat ...`.
 */

import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ExecOptions, ExecResult, RemoteExecutor } from './executor';
import { RemoteExecError } from './executor';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;

export class LocalExecutor implements RemoteExecutor {
  isReady(): boolean {
    return true;
  }

  async exec(cmd: string, opts: ExecOptions = {}): Promise<ExecResult> {
    const args = parsePosixArgs(cmd);
    if (args.length === 0) {
      throw new RemoteExecError({ kind: 'cmd_failed', message: 'Empty command' });
    }

    if (args[0] === 'cat') {
      if (args.length !== 2) {
        throw new RemoteExecError({
          kind: 'cmd_failed',
          message: `Unsupported local cat invocation: ${cmd}`,
        });
      }
      try {
        const stdout = await readFile(resolvePath(args[1], opts.cwd), 'utf8');
        return { stdout, stderr: '', code: 0 };
      } catch (err) {
        return {
          stdout: '',
          stderr: err instanceof Error ? err.message : String(err),
          code: 1,
        };
      }
    }

    if (args[0] !== 'git') {
      throw new RemoteExecError({
        kind: 'cmd_failed',
        message: `Unsupported local command: ${args[0]}`,
      });
    }

    return await execGit(args.slice(1), opts);
  }

  async *execStream(cmd: string, opts: ExecOptions = {}): AsyncIterable<Uint8Array> {
    const args = parsePosixArgs(cmd);
    if (args.length === 0) {
      throw new RemoteExecError({ kind: 'cmd_failed', message: 'Empty command' });
    }

    if (args[0] === 'cat') {
      if (args.length !== 2) {
        throw new RemoteExecError({
          kind: 'cmd_failed',
          message: `Unsupported local cat invocation: ${cmd}`,
        });
      }
      const stdout = await readFile(resolvePath(args[1], opts.cwd));
      yield stdout;
      return;
    }

    if (args[0] !== 'git') {
      throw new RemoteExecError({
        kind: 'cmd_failed',
        message: `Unsupported local command: ${args[0]}`,
      });
    }

    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const child = spawn('git', args.slice(1), {
      cwd: opts.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stderrChunks: Buffer[] = [];
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.stderr.on('data', (d: Buffer) => stderrChunks.push(d));

    try {
      for await (const chunk of child.stdout) {
        yield chunk as Uint8Array;
      }
    } catch (err) {
      clearTimeout(timer);
      throw toCmdError(err);
    }

    const code = await new Promise<number>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (exitCode) => resolve(exitCode ?? 0));
    }).catch((err) => {
      throw toCmdError(err);
    });
    clearTimeout(timer);

    if (timedOut) {
      throw new RemoteExecError({
        kind: 'cmd_failed',
        message: `Command timed out after ${timeoutMs}ms`,
      });
    }
    if (code !== 0) {
      const stderr = Buffer.concat(stderrChunks).toString('utf8');
      throw new RemoteExecError({
        kind: 'cmd_failed',
        message: stderr.trim() || `Command exited with code ${code}`,
        stderr,
        exitCode: code,
      });
    }
  }

  async close(): Promise<void> {}
}

async function execGit(args: string[], opts: ExecOptions): Promise<ExecResult> {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return await new Promise<ExecResult>((resolve, reject) => {
    const child = spawn('git', args, {
      cwd: opts.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let timedOut = false;
    let tooLarge = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    child.once('error', (err) => {
      clearTimeout(timer);
      reject(toCmdError(err));
    });
    child.stdout.on('data', (d: Buffer) => {
      stdoutBytes += d.length;
      if (stdoutBytes > maxBytes) {
        tooLarge = true;
        child.kill();
        return;
      }
      stdoutChunks.push(d);
    });
    child.stderr.on('data', (d: Buffer) => stderrChunks.push(d));
    child.once('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(
          new RemoteExecError({
            kind: 'cmd_failed',
            message: `Command timed out after ${timeoutMs}ms`,
          }),
        );
        return;
      }
      if (tooLarge) {
        reject(
          new RemoteExecError({
            kind: 'cmd_failed',
            message: `Output exceeded ${maxBytes} bytes (use execStream for large outputs)`,
          }),
        );
        return;
      }
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        code: code ?? 0,
      });
    });
  });
}

function resolvePath(path: string, cwd?: string): string {
  return cwd ? resolve(cwd, path) : path;
}

function toCmdError(err: unknown): RemoteExecError {
  return new RemoteExecError({
    kind: 'cmd_failed',
    message: err instanceof Error ? err.message : String(err),
  });
}

function parsePosixArgs(command: string): string[] {
  const args: string[] = [];
  let current = '';
  let inSingle = false;
  let escaped = false;

  for (const ch of command) {
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (inSingle) {
      if (ch === "'") {
        inSingle = false;
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) {
        args.push(current);
        current = '';
      }
      continue;
    }
    current += ch;
  }

  if (escaped) current += '\\';
  if (inSingle) {
    throw new RemoteExecError({
      kind: 'cmd_failed',
      message: `Unterminated quote in command: ${command}`,
    });
  }
  if (current) args.push(current);
  return args;
}
