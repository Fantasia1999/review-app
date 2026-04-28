import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'review-app-cfg-'));
  process.env.REVIEW_APP_CONFIG_DIR = dir;
  process.env.REVIEW_APP_DB_PATH = join(dir, 'db.sqlite');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.REVIEW_APP_CONFIG_DIR;
  delete process.env.REVIEW_APP_DB_PATH;
});

async function freshStore() {
  const mod = await import('./store?t=' + Math.random());
  // Bun caches modules; the query string trick doesn't help. Use the reset hook.
  const real = await import('./store');
  real.__resetConfigCacheForTests();
  return real;
}

describe('config store', () => {
  it('creates a default config when file is missing', async () => {
    const store = await freshStore();
    const cfg = await store.loadConfig();
    expect(cfg.version).toBe(3);
    expect(cfg.hosts).toEqual([]);
    expect(cfg.ui.annotationLayout).toBe('inline');
  });

  it('persists changes via updateConfig', async () => {
    const store = await freshStore();
    await store.updateConfig((c) => {
      c.hosts.push({
        alias: 'a',
        kind: 'ssh',
        auth: 'key',
        hostname: 'h',
        user: 'u',
        port: 22,
        keyPath: '/k',
        hasPassphrase: false,
      });
    });
    store.__resetConfigCacheForTests();
    const reloaded = await store.loadConfig();
    expect(reloaded.hosts).toHaveLength(1);
    expect(reloaded.hosts[0].alias).toBe('a');
  });

  it('supports async mutators', async () => {
    const store = await freshStore();
    const updated = await store.updateConfig(async (c) => {
      await new Promise((r) => setTimeout(r, 5));
      c.hosts.push({
        alias: 'async',
        kind: 'ssh',
        auth: 'key',
        hostname: 'h',
        user: 'u',
        port: 22,
        keyPath: '/k',
        hasPassphrase: false,
      });
    });
    expect(updated.hosts[0].alias).toBe('async');
    // Verify the persisted file is JSON, not "[object Promise]"
    store.__resetConfigCacheForTests();
    const reloaded = await store.loadConfig();
    expect(reloaded.hosts[0].alias).toBe('async');
  });

  it('serializes concurrent updates without losing writes', async () => {
    const store = await freshStore();
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        store.updateConfig((c) => {
          c.hosts.push({
            alias: `h${i}`,
            kind: 'ssh',
            auth: 'key',
            hostname: 'x',
            user: 'u',
            port: 22,
            keyPath: '/k',
            hasPassphrase: false,
          });
        }),
      ),
    );
    store.__resetConfigCacheForTests();
    const cfg = await store.loadConfig();
    expect(cfg.hosts).toHaveLength(10);
    expect(new Set(cfg.hosts.map((h) => h.alias)).size).toBe(10);
  });
});

describe('migrate', () => {
  it('upgrades a missing version to v3 with defaults', async () => {
    const store = await freshStore();
    const out = store.migrate({ hosts: [] } as any);
    expect(out.version).toBe(3);
    expect(out.ui).toBeDefined();
    expect(out.recentRepos).toEqual({});
  });

  it('migrates v1 SSH key hosts to v3', async () => {
    const store = await freshStore();
    const cfg = {
      version: 1 as const,
      hosts: [{ alias: 'pre', hostname: 'h', user: 'u', port: 22, keyPath: '/k', hasPassphrase: false }],
      recentRepos: {},
      readMarks: [],
      ui: { theme: 'dark' as const, annotationLayout: 'sidebar' as const, fileTreeMode: 'tree' as const },
    };
    const out = store.migrate(cfg);
    expect(out.version).toBe(3);
    expect(out.hosts[0]).toEqual({
      alias: 'pre',
      kind: 'ssh',
      auth: 'key',
      hostname: 'h',
      user: 'u',
      port: 22,
      keyPath: '/k',
      hasPassphrase: false,
    });
  });

  it('passes through v3 unchanged', async () => {
    const store = await freshStore();
    const cfg = {
      version: 3 as const,
      hosts: [
        { alias: 'local', kind: 'local' as const },
        { alias: 'wsl-ub', kind: 'wsl' as const, distro: 'Ubuntu' },
      ],
      recentRepos: {},
      readMarks: [],
      ui: { theme: 'dark' as const, annotationLayout: 'sidebar' as const, fileTreeMode: 'tree' as const },
    };
    const out = store.migrate(cfg);
    expect(out).toEqual(cfg);
  });

  it('reads pre-existing config file', async () => {
    writeFileSync(
      join(dir, 'config.json'),
      JSON.stringify({
        version: 1,
        hosts: [{ alias: 'pre', hostname: 'h', user: 'u', port: 22, keyPath: '/k', hasPassphrase: false }],
        recentRepos: {},
        readMarks: [],
        ui: { theme: 'auto', annotationLayout: 'inline', fileTreeMode: 'auto' },
      }),
    );
    const store = await freshStore();
    const cfg = await store.loadConfig();
    expect(cfg.hosts[0].alias).toBe('pre');
    expect(cfg.hosts[0]).toMatchObject({ kind: 'ssh', auth: 'key' });
  });
});
