/**
 * Persistent app config: ~/.review-app/config.json
 *
 * Holds host configs, recent repos per host, file-level read marks,
 * and UI preferences. NEVER holds passphrases or any secret.
 *
 * The version field exists for migrations - bump it and add a migration
 * function when the shape changes.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_CONFIG,
  type AppConfig,
} from '@review-app/shared';

function configDir(): string {
  return process.env.REVIEW_APP_CONFIG_DIR ?? join(homedir(), '.review-app');
}
function configPath(): string {
  return join(configDir(), 'config.json');
}
export function getDbPath(): string {
  return process.env.REVIEW_APP_DB_PATH ?? join(configDir(), 'db.sqlite');
}
/** @deprecated import-time constant kept for backwards compat; prefer getDbPath() */
export const DB_PATH = getDbPath();

let cached: AppConfig | null = null;
let writeLock: Promise<void> = Promise.resolve();

/** Test-only: clear in-memory cache so next load re-reads disk. */
export function __resetConfigCacheForTests(): void {
  cached = null;
  writeLock = Promise.resolve();
}

export async function ensureConfigDir(): Promise<void> {
  await mkdir(configDir(), { recursive: true });
}

export async function loadConfig(): Promise<AppConfig> {
  if (cached) return cached;
  await ensureConfigDir();
  try {
    const raw = await readFile(configPath(), 'utf8');
    const parsed = JSON.parse(raw) as AppConfig;
    cached = migrate(parsed);
    return cached;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      cached = structuredClone(DEFAULT_CONFIG);
      await persist(cached);
      return cached;
    }
    throw err;
  }
}

export async function saveConfig(next: AppConfig): Promise<void> {
  cached = next;
  await persist(next);
}

/** Atomic-ish update helper - reads, mutates, writes under a lock. */
export async function updateConfig(
  mutator: (c: AppConfig) => AppConfig | void | Promise<AppConfig | void>,
): Promise<AppConfig> {
  // Serialize updates so concurrent route handlers don't clobber each other.
  let release!: () => void;
  const ticket = new Promise<void>((r) => (release = r));
  const prevLock = writeLock;
  writeLock = ticket;
  try {
    await prevLock;
    const current = await loadConfig();
    const out = (await mutator(current)) ?? current;
    await persist(out);
    cached = out;
    return out;
  } finally {
    release();
  }
}

async function persist(c: AppConfig): Promise<void> {
  await ensureConfigDir();
  // Write to a temp file then rename for atomicity
  const target = configPath();
  const tmp = target + '.tmp';
  await writeFile(tmp, JSON.stringify(c, null, 2), 'utf8');
  // On Windows, rename will fail if target exists; remove first if needed.
  // Bun.file API would be neater but we want plain Node fs for ssh2 compat.
  try {
    const { rename, unlink } = await import('node:fs/promises');
    try {
      await rename(tmp, target);
    } catch {
      await unlink(target).catch(() => {});
      await rename(tmp, target);
    }
  } catch (err) {
    throw err;
  }
}

/** Apply migrations from older config versions. Exported for tests. */
export function migrate(raw: AppConfig & { version?: number }): AppConfig {
  const v = raw.version ?? 0;
  // v1 is current. Add cases here as schema evolves.
  if (v === 1) return raw;
  // Unknown future version - just trust it (forward compat)
  if (v > 1) return raw;
  // Pre-v1: shouldn't happen unless someone manually edited the file
  return { ...DEFAULT_CONFIG, ...raw, version: 1 };
}
