/**
 * Connection pool: one RemoteExecutor per host alias, lazily created,
 * reaped after IDLE_TIMEOUT_MS of inactivity.
 *
 * The pool also holds SSH secrets in memory (passwords or key passphrases)
 * for the lifetime of the agent process. Secrets are never written to disk.
 */

import type { HostConfig, SshHostConfig, WslHostConfig } from '@review-app/shared';
import type { RemoteExecutor } from './executor';
import { SSHExecutor } from './ssh-executor';
import { LocalExecutor } from './local-executor';
import { WslExecutor } from './wsl-executor';

const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 min

interface PoolEntry {
  executor: RemoteExecutor;
  lastUsed: number;
  reaper: ReturnType<typeof setTimeout> | null;
}

export class ExecutorPool {
  private entries = new Map<string, PoolEntry>();
  private secrets = new Map<string, string>(); // hostAlias -> password or passphrase

  /** Store a passphrase in memory for this host. Persists for the agent's lifetime. */
  setPassphrase(alias: string, passphrase: string): void {
    this.secrets.set(alias, passphrase);
  }

  setPassword(alias: string, password: string): void {
    this.secrets.set(alias, password);
  }

  hasPassphrase(alias: string): boolean {
    return this.secrets.has(alias);
  }

  hasCredential(alias: string): boolean {
    return this.secrets.has(alias);
  }

  /**
   * Get or create the executor for a host. The executor is lazy - it doesn't
   * connect until you actually call exec() on it.
   */
  get(host: HostConfig): RemoteExecutor {
    const existing = this.entries.get(host.alias);
    if (existing) {
      existing.lastUsed = Date.now();
      this.scheduleReap(host.alias);
      return this.wrapForReaping(host.alias, existing.executor);
    }

    const secret = this.secrets.get(host.alias);
    const executor =
      host.kind === 'local'
        ? new LocalExecutor()
        : host.kind === 'wsl'
          ? new WslExecutor((host as WslHostConfig).distro)
          : new SSHExecutor(host as SshHostConfig, secret);
    const entry: PoolEntry = {
      executor,
      lastUsed: Date.now(),
      reaper: null,
    };
    this.entries.set(host.alias, entry);
    this.scheduleReap(host.alias);
    return this.wrapForReaping(host.alias, executor);
  }

  /** Touch a host's lastUsed when an op runs on its executor. */
  private wrapForReaping(alias: string, exec: RemoteExecutor): RemoteExecutor {
    const touch = () => {
      const e = this.entries.get(alias);
      if (e) {
        e.lastUsed = Date.now();
        this.scheduleReap(alias);
      }
    };
    return {
      isReady: () => exec.isReady(),
      async exec(cmd, opts) {
        touch();
        return exec.exec(cmd, opts);
      },
      execStream(cmd, opts) {
        touch();
        return exec.execStream(cmd, opts);
      },
      close: () => exec.close(),
    };
  }

  private scheduleReap(alias: string): void {
    const entry = this.entries.get(alias);
    if (!entry) return;
    if (entry.reaper) clearTimeout(entry.reaper);
    entry.reaper = setTimeout(() => {
      const e = this.entries.get(alias);
      if (!e) return;
      const idle = Date.now() - e.lastUsed;
      if (idle >= IDLE_TIMEOUT_MS) {
        e.executor.close().catch(() => {});
        this.entries.delete(alias);
      }
    }, IDLE_TIMEOUT_MS);
  }

  /** Disconnect a specific host. Used when user removes/edits a host config. */
  async disconnect(alias: string): Promise<void> {
    const e = this.entries.get(alias);
    if (e) {
      if (e.reaper) clearTimeout(e.reaper);
      await e.executor.close().catch(() => {});
      this.entries.delete(alias);
    }
  }

  /** Disconnect everything. Called on agent shutdown. */
  async closeAll(): Promise<void> {
    const tasks: Promise<void>[] = [];
    for (const [, e] of this.entries) {
      if (e.reaper) clearTimeout(e.reaper);
      tasks.push(e.executor.close().catch(() => {}));
    }
    await Promise.all(tasks);
    this.entries.clear();
  }

  /** Forget passphrase for a host (e.g. when user edits the host's key path). */
  clearPassphrase(alias: string): void {
    this.secrets.delete(alias);
  }

  clearCredential(alias: string): void {
    this.secrets.delete(alias);
  }
}
