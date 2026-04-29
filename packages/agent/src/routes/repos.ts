/**
 * Repo discovery & history.
 *
 * GET  /api/repos/recent-all       - cross-host recents (landing page)
 * GET  /api/repos/:alias/recent    - recent repos for one host
 * POST /api/repos/:alias/validate  - check if a path is a git work tree
 * POST /api/repos/:alias/touch     - bump a repo to top of recent list
 */

import { Hono } from 'hono';
import { loadConfig, updateConfig } from '../config/store';
import type { ExecutorPool } from '../remote/pool';
import { GitOps } from '../git/ops';
import { RemoteExecError } from '../remote/executor';

export function reposRoutes(pool: ExecutorPool) {
  const r = new Hono();

  r.get('/recent-all', async (c) => {
    // Cross-host listing for the landing page — flattened and sorted by
    // most-recently opened. Registered before `/:alias/recent` so the
    // literal "recent-all" segment doesn't get matched as an alias.
    const cfg = await loadConfig();
    const flat: { hostAlias: string; path: string; lastOpenedAt: number }[] = [];
    for (const [hostAlias, list] of Object.entries(cfg.recentRepos)) {
      if (!cfg.hosts.find((h) => h.alias === hostAlias)) continue;
      for (const e of list) flat.push({ hostAlias, path: e.path, lastOpenedAt: e.lastOpenedAt });
    }
    flat.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
    return c.json({ recent: flat.slice(0, 20) });
  });

  r.get('/:alias/recent', async (c) => {
    const alias = c.req.param('alias');
    const cfg = await loadConfig();
    return c.json({ recent: cfg.recentRepos[alias] ?? [] });
  });

  r.post('/:alias/validate', async (c) => {
    const alias = c.req.param('alias');
    const { path } = (await c.req.json()) as { path: string };
    if (!path) return c.json({ ok: false, error: 'path required' }, 400);

    const cfg = await loadConfig();
    const host = cfg.hosts.find((h) => h.alias === alias);
    if (!host) return c.json({ ok: false, error: 'host not found' }, 404);

    try {
      const exec = pool.get(host);
      const ops = new GitOps(exec, path);
      await ops.validateRepo();
      return c.json({ ok: true });
    } catch (err) {
      if (err instanceof RemoteExecError) {
        return c.json({ ok: false, error: err.info });
      }
      return c.json({ ok: false, error: { kind: 'unknown', message: String(err) } });
    }
  });

  r.post('/:alias/touch', async (c) => {
    const alias = c.req.param('alias');
    const { path } = (await c.req.json()) as { path: string };
    await updateConfig((cfg) => {
      const list = cfg.recentRepos[alias] ?? [];
      const filtered = list.filter((e) => e.path !== path);
      filtered.unshift({ path, lastOpenedAt: Date.now() });
      cfg.recentRepos[alias] = filtered.slice(0, 20); // keep top 20
    });
    return c.json({ ok: true });
  });

  return r;
}
