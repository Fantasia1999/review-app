/**
 * File-level "read" marks.
 *
 * Each mark is keyed by (host, repo, file, contentHash). When the file's
 * content hash changes, the mark stops matching automatically - no separate
 * invalidation step needed.
 *
 * GET    /api/read-marks?host=&repo=
 * POST   /api/read-marks   - { hostAlias, repoPath, filePath, contentHash }
 * DELETE /api/read-marks   - body same shape, removes a single mark
 */

import { Hono } from 'hono';
import { loadConfig, updateConfig } from '../config/store';
import type { ReadMark } from '@review-app/shared';

export function readMarksRoutes() {
  const r = new Hono();

  r.get('/', async (c) => {
    const host = c.req.query('host');
    const repo = c.req.query('repo');
    if (!host || !repo) return c.json({ error: 'host + repo required' }, 400);
    const cfg = await loadConfig();
    const marks = cfg.readMarks.filter(
      (m) => m.hostAlias === host && m.repoPath === repo,
    );
    return c.json({ marks });
  });

  r.post('/', async (c) => {
    const mark = (await c.req.json()) as ReadMark;
    await updateConfig((cfg) => {
      // Replace any existing mark for this (host, repo, file)
      cfg.readMarks = cfg.readMarks.filter(
        (m) =>
          !(
            m.hostAlias === mark.hostAlias &&
            m.repoPath === mark.repoPath &&
            m.filePath === mark.filePath
          ),
      );
      cfg.readMarks.push(mark);
    });
    return c.json({ ok: true });
  });

  r.delete('/', async (c) => {
    const mark = (await c.req.json()) as Pick<
      ReadMark,
      'hostAlias' | 'repoPath' | 'filePath'
    >;
    await updateConfig((cfg) => {
      cfg.readMarks = cfg.readMarks.filter(
        (m) =>
          !(
            m.hostAlias === mark.hostAlias &&
            m.repoPath === mark.repoPath &&
            m.filePath === mark.filePath
          ),
      );
    });
    return c.json({ ok: true });
  });

  return r;
}
