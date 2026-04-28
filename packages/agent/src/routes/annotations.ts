/**
 * Annotation CRUD.
 *
 * GET    /api/annotations?host=&repo=[&file=][&includeArchived=1][&archivedOnly=1]
 * GET    /api/annotations/all[?includeArchived=1][&archivedOnly=1]
 * POST   /api/annotations
 * PATCH  /api/annotations/:id            - body and/or archived flag
 * POST   /api/annotations/clear          - bulk soft-archive a whole repo
 * DELETE /api/annotations/:id            - HARD delete (only used from
 *                                          the management page)
 */

import { Hono } from 'hono';
import {
  createAnnotation,
  listAnnotations,
  listAllAnnotations,
  deleteAnnotation,
  updateAnnotationBody,
  setAnnotationArchived,
  archiveAllForRepo,
} from '../db/annotations';
import type { CreateAnnotationInput } from '@review-app/shared';

export function annotationsRoutes() {
  const r = new Hono();

  r.get('/', async (c) => {
    const host = c.req.query('host');
    const repo = c.req.query('repo');
    const file = c.req.query('file');
    if (!host || !repo) {
      return c.json({ error: 'host + repo required' }, 400);
    }
    const includeArchived = c.req.query('includeArchived') === '1';
    const archivedOnly = c.req.query('archivedOnly') === '1';
    const list = await listAnnotations(host, repo, file, {
      includeArchived,
      archivedOnly,
    });
    return c.json({ annotations: list });
  });

  r.get('/all', async (c) => {
    const includeArchived = c.req.query('includeArchived') === '1';
    const archivedOnly = c.req.query('archivedOnly') === '1';
    const list = await listAllAnnotations({ includeArchived, archivedOnly });
    return c.json({ annotations: list });
  });

  r.post('/', async (c) => {
    const body = (await c.req.json()) as CreateAnnotationInput;
    if (
      !body.hostAlias ||
      !body.repoPath ||
      !body.filePath ||
      !body.quotedLines ||
      typeof body.quotedStartLine !== 'number' ||
      !body.body ||
      !body.side
    ) {
      return c.json({ error: 'missing fields' }, 400);
    }
    const ann = await createAnnotation(body);
    return c.json({ annotation: ann });
  });

  // Bulk soft-clear: archive every comment in a repo. Defined before /:id so
  // the literal "clear" segment doesn't collide with the param route.
  r.post('/clear', async (c) => {
    const { hostAlias, repoPath } = (await c.req.json()) as {
      hostAlias?: string;
      repoPath?: string;
    };
    if (!hostAlias || !repoPath) {
      return c.json({ error: 'hostAlias + repoPath required' }, 400);
    }
    const archived = await archiveAllForRepo(hostAlias, repoPath);
    return c.json({ ok: true, archived });
  });

  r.patch('/:id', async (c) => {
    const id = c.req.param('id');
    const payload = (await c.req.json()) as {
      body?: string;
      archived?: boolean;
    };
    if (
      typeof payload.body !== 'string' &&
      typeof payload.archived !== 'boolean'
    ) {
      return c.json({ error: 'body or archived required' }, 400);
    }
    if (typeof payload.body === 'string') {
      await updateAnnotationBody(id, payload.body);
    }
    if (typeof payload.archived === 'boolean') {
      await setAnnotationArchived(id, payload.archived);
    }
    return c.json({ ok: true });
  });

  r.delete('/:id', async (c) => {
    const id = c.req.param('id');
    await deleteAnnotation(id);
    return c.json({ ok: true });
  });

  return r;
}
