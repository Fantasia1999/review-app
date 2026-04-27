/**
 * Annotation CRUD.
 *
 * GET    /api/annotations?host=&repo=[&file=]
 * POST   /api/annotations
 * PATCH  /api/annotations/:id  - body only
 * DELETE /api/annotations/:id
 */

import { Hono } from 'hono';
import {
  createAnnotation,
  listAnnotations,
  deleteAnnotation,
  updateAnnotationBody,
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
    const list = await listAnnotations(host, repo, file);
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

  r.patch('/:id', async (c) => {
    const id = c.req.param('id');
    const { body } = (await c.req.json()) as { body: string };
    if (typeof body !== 'string') return c.json({ error: 'body required' }, 400);
    await updateAnnotationBody(id, body);
    return c.json({ ok: true });
  });

  r.delete('/:id', async (c) => {
    const id = c.req.param('id');
    await deleteAnnotation(id);
    return c.json({ ok: true });
  });

  return r;
}
