/**
 * Host management routes.
 *
 * GET  /api/hosts                  - list all configured hosts
 * POST /api/hosts                  - add a new host
 * PUT  /api/hosts/:alias           - edit existing host
 * DELETE /api/hosts/:alias         - remove host (also disconnects)
 * GET  /api/hosts/keys             - scan ~/.ssh/ for available private keys
 * POST /api/hosts/:alias/passphrase - submit passphrase for an encrypted key
 * POST /api/hosts/:alias/test      - test connection (lightweight `echo ok`)
 */

import { Hono } from 'hono';
import { loadConfig, updateConfig } from '../config/store';
import { detectEncrypted, scanLocalKeys } from '../config/keys';
import type { ExecutorPool } from '../remote/pool';
import { RemoteExecError } from '../remote/executor';
import type { HostConfig } from '@review-app/shared';

export function hostsRoutes(pool: ExecutorPool) {
  const r = new Hono();

  r.get('/', async (c) => {
    const cfg = await loadConfig();
    return c.json({
      hosts: cfg.hosts,
      // Tell client which hosts already have an in-memory passphrase
      passphraseLoaded: cfg.hosts
        .filter((h) => h.hasPassphrase && pool.hasPassphrase(h.alias))
        .map((h) => h.alias),
    });
  });

  r.get('/keys', async (c) => {
    const keys = await scanLocalKeys();
    return c.json({ keys });
  });

  r.post('/', async (c) => {
    const body = (await c.req.json()) as Partial<HostConfig>;
    if (!body.alias || !body.hostname || !body.user || !body.keyPath) {
      return c.json({ error: 'alias, hostname, user, keyPath are required' }, 400);
    }
    // Auto-detect whether the key is encrypted - the client doesn't need to know.
    const encrypted = await detectEncrypted(body.keyPath);
    const newHost: HostConfig = {
      alias: body.alias,
      hostname: body.hostname,
      user: body.user,
      port: body.port ?? 22,
      keyPath: body.keyPath,
      hasPassphrase: encrypted,
    };
    const existing = await loadConfig();
    if (existing.hosts.find((h) => h.alias === newHost.alias)) {
      return c.json(
        { error: `Host alias "${newHost.alias}" already exists` },
        409,
      );
    }
    const updated = await updateConfig((cfg) => {
      cfg.hosts.push(newHost);
    });
    return c.json({ host: newHost, hosts: updated.hosts });
  });

  r.put('/:alias', async (c) => {
    const alias = c.req.param('alias');
    const body = (await c.req.json()) as Partial<HostConfig>;
    const cfgPre = await loadConfig();
    if (!cfgPre.hosts.find((h) => h.alias === alias)) {
      return c.json({ error: 'host not found' }, 404);
    }
    let resolved: HostConfig | null = null;
    await updateConfig(async (cfg) => {
      const idx = cfg.hosts.findIndex((h) => h.alias === alias);
      if (idx === -1) return;
      const existing = cfg.hosts[idx];
      const merged: HostConfig = {
        ...existing,
        ...body,
        alias: existing.alias, // alias is immutable
      };
      // Re-detect passphrase if key changed
      if (body.keyPath && body.keyPath !== existing.keyPath) {
        merged.hasPassphrase = await detectEncrypted(body.keyPath);
        pool.clearPassphrase(alias);
      }
      cfg.hosts[idx] = merged;
      resolved = merged;
    });
    // Drop any active connection so the new config takes effect on next use
    await pool.disconnect(alias);
    return c.json({ host: resolved });
  });

  r.delete('/:alias', async (c) => {
    const alias = c.req.param('alias');
    await pool.disconnect(alias);
    pool.clearPassphrase(alias);
    await updateConfig((cfg) => {
      cfg.hosts = cfg.hosts.filter((h) => h.alias !== alias);
      delete cfg.recentRepos[alias];
      cfg.readMarks = cfg.readMarks.filter((m) => m.hostAlias !== alias);
    });
    return c.json({ ok: true });
  });

  r.post('/:alias/passphrase', async (c) => {
    const alias = c.req.param('alias');
    const { passphrase } = (await c.req.json()) as { passphrase: string };
    if (!passphrase) return c.json({ error: 'passphrase required' }, 400);
    pool.setPassphrase(alias, passphrase);
    // Also drop any old connection so the new passphrase is used
    await pool.disconnect(alias);
    return c.json({ ok: true });
  });

  r.post('/:alias/test', async (c) => {
    const alias = c.req.param('alias');
    const cfg = await loadConfig();
    const host = cfg.hosts.find((h) => h.alias === alias);
    if (!host) return c.json({ error: 'host not found' }, 404);
    try {
      const exec = pool.get(host);
      const r = await exec.exec('echo ok && git --version', { timeoutMs: 10_000 });
      return c.json({
        ok: true,
        gitVersion: r.stdout.split('\n')[1] ?? '',
      });
    } catch (err) {
      if (err instanceof RemoteExecError) {
        return c.json({ ok: false, error: err.info }, 200);
      }
      return c.json(
        { ok: false, error: { kind: 'unknown', message: String(err) } },
        200,
      );
    }
  });

  return r;
}
