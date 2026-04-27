/**
 * Diff endpoints.
 *
 * GET  /api/diff/:alias/changes?repo=...        - summary of all changes
 * GET  /api/diff/:alias/file?repo=...&path=...&status=...  - one file's diff
 * GET  /api/diff/:alias/content?repo=...&path=...&side=... - raw file content
 *      side=new -> working tree, side=old -> HEAD blob
 */

import { Hono } from 'hono';
import { loadConfig } from '../config/store';
import type { ExecutorPool } from '../remote/pool';
import { GitOps } from '../git/ops';
import { RemoteExecError } from '../remote/executor';
import type { FileStatus } from '@review-app/shared';

export function diffRoutes(pool: ExecutorPool) {
  const r = new Hono();

  r.get('/:alias/changes', async (c) => {
    const alias = c.req.param('alias');
    const repo = c.req.query('repo');
    if (!repo) return c.json({ error: 'repo query param required' }, 400);

    const cfg = await loadConfig();
    const host = cfg.hosts.find((h) => h.alias === alias);
    if (!host) return c.json({ error: 'host not found' }, 404);

    try {
      const exec = pool.get(host);
      const ops = new GitOps(exec, repo);
      const summary = await ops.listChanges();
      return c.json(summary);
    } catch (err) {
      return errorResponse(c, err);
    }
  });

  r.get('/:alias/file', async (c) => {
    const alias = c.req.param('alias');
    const repo = c.req.query('repo');
    const path = c.req.query('path');
    const status = (c.req.query('status') ?? 'modified') as FileStatus;
    if (!repo || !path) {
      return c.json({ error: 'repo + path required' }, 400);
    }

    const cfg = await loadConfig();
    const host = cfg.hosts.find((h) => h.alias === alias);
    if (!host) return c.json({ error: 'host not found' }, 404);

    try {
      const exec = pool.get(host);
      const ops = new GitOps(exec, repo);
      const diff = await ops.getFileDiff(path, status);
      return c.json(diff);
    } catch (err) {
      return errorResponse(c, err);
    }
  });

  r.get('/:alias/content', async (c) => {
    const alias = c.req.param('alias');
    const repo = c.req.query('repo');
    const path = c.req.query('path');
    const side = (c.req.query('side') ?? 'new') as 'old' | 'new';
    if (!repo || !path) {
      return c.json({ error: 'repo + path required' }, 400);
    }

    const cfg = await loadConfig();
    const host = cfg.hosts.find((h) => h.alias === alias);
    if (!host) return c.json({ error: 'host not found' }, 404);

    try {
      const exec = pool.get(host);
      const ops = new GitOps(exec, repo);
      const content =
        side === 'old'
          ? await ops.getFileContentAtHead(path)
          : await ops.getFileContent(path);
      return c.json({ content });
    } catch (err) {
      return errorResponse(c, err);
    }
  });

  return r;
}

function errorResponse(c: any, err: unknown) {
  if (err instanceof RemoteExecError) {
    // 4xx for user-correctable, 5xx for unexpected
    const status = err.info.kind === 'ssh_passphrase_required' ? 401 : 400;
    return c.json({ error: err.info }, status);
  }
  return c.json(
    { error: { kind: 'unknown', message: String(err) } },
    500,
  );
}
