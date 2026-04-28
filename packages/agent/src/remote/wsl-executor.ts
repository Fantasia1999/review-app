/**
 * WSL implementation of RemoteExecutor.
 *
 * Spawns commands inside a WSL distribution via `wsl.exe -d <distro> -- <bin> <args>`.
 * From the rest of the codebase's point of view this looks identical to a
 * unix-like remote: paths are POSIX, `git -C <path>` works, `cat <path>` works.
 *
 * The "remote" requirement (just `git`) applies to the WSL distro itself, not
 * Windows. Windows only needs WSL installed.
 *
 * Only supports the same command shapes the app emits: `git ...` and `cat ...`.
 */

import { spawn } from 'node:child_process';
import type { ExecOptions, ExecResult, RemoteExecutor } from './executor';
import { RemoteExecError } from './executor';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;

export class WslExecutor implements RemoteExecutor {
  constructor(private readonly distro: string) {}

  isReady(): boolean {
    return process.platform === 'win32';
  }

  async exec(cmd: string, opts: ExecOptions = {}): Promise<ExecResult> {
    const args = parsePosixArgs(cmd);
    if (args.length === 0) {
      throw new RemoteExecError({ kind: 'cmd_failed', message: 'Empty command' });
    }
    if (args[0] !== 'git' && args[0] !== 'cat') {
      throw new RemoteExecError({
        kind: 'cmd_failed',
        message: `Unsupported wsl command: ${args[0]}`,
      });
    }
    return execBuffered(this.distro, args, opts);
  }

  async *execStream(cmd: string, opts: ExecOptions = {}): AsyncIterable<Uint8Array> {
    const args = parsePosixArgs(cmd);
    if (args.length === 0) {
      throw new RemoteExecError({ kind: 'cmd_failed', message: 'Empty command' });
    }
    if (args[0] !== 'git' && args[0] !== 'cat') {
      throw new RemoteExecError({
        kind: 'cmd_failed',
        message: `Unsupported wsl command: ${args[0]}`,
      });
    }

    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const child = spawn('wsl.exe', wslArgs(this.distro, args, opts.cwd), {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
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

function execBuffered(
  distro: string,
  args: string[],
  opts: ExecOptions,
): Promise<ExecResult> {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return new Promise<ExecResult>((resolve, reject) => {
    const child = spawn('wsl.exe', wslArgs(distro, args, opts.cwd), {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
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

/**
 * Build `wsl.exe` argv. We deliberately use `--exec` (or its `-e` shortcut) so
 * wsl.exe runs the binary directly rather than going through a login shell -
 * this avoids extra quoting concerns and matches LocalExecutor's spawn-without-shell
 * behavior.
 */
function wslArgs(distro: string, cmd: string[], cwd?: string): string[] {
  const out = ['-d', distro];
  if (cwd) out.push('--cd', cwd);
  out.push('-e', ...cmd);
  return out;
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

/**
 * List installed WSL distros via `wsl.exe -l -q`. Returns [] on non-Windows
 * or when wsl.exe is missing/errors. Output of `wsl.exe -l -q` is UTF-16LE.
 */
export async function listWslDistros(): Promise<string[]> {
  if (process.platform !== 'win32') return [];
  return new Promise<string[]>((resolve) => {
    let out = Buffer.alloc(0);
    let err = Buffer.alloc(0);
    let child;
    try {
      child = spawn('wsl.exe', ['-l', '-q'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch {
      resolve([]);
      return;
    }
    child.stdout.on('data', (d: Buffer) => {
      out = Buffer.concat([out, d]);
    });
    child.stderr.on('data', (d: Buffer) => {
      err = Buffer.concat([err, d]);
    });
    child.once('error', () => resolve([]));
    child.once('close', (code) => {
      if (code !== 0) {
        resolve([]);
        return;
      }
      // wsl.exe writes UTF-16LE with a BOM.
      let text = decodeUtf16le(out);
      // Strip null bytes that sometimes sneak through and trim each line.
      const lines = text
        .split(/\r?\n/)
        .map((s) => s.replace(/\u0000/g, '').trim())
        .filter(Boolean);
      resolve(lines);
    });
  });
}

function decodeUtf16le(buf: Buffer): string {
  // Strip BOM if present
  let start = 0;
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) start = 2;
  // Heuristic: if every odd byte is 0, treat as UTF-16LE; otherwise utf8.
  // wsl.exe -l -q is reliably UTF-16LE on Windows 10/11.
  if (buf.length - start >= 2 && buf[start + 1] === 0) {
    return buf.slice(start).toString('utf16le');
  }
  return buf.slice(start).toString('utf8');
}
