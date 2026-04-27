/**
 * UI preferences (theme, layout, etc).
 *
 * GET  /api/prefs
 * PUT  /api/prefs - partial update of cfg.ui
 */

import { Hono } from 'hono';
import { loadConfig, updateConfig } from '../config/store';
import type { AppConfig } from '@review-app/shared';

export function prefsRoutes() {
  const r = new Hono();

  r.get('/', async (c) => {
    const cfg = await loadConfig();
    return c.json({ prefs: cfg.ui });
  });

  r.put('/', async (c) => {
    const patch = (await c.req.json()) as Partial<AppConfig['ui']>;
    const updated = await updateConfig((cfg) => {
      cfg.ui = { ...cfg.ui, ...patch };
    });
    return c.json({ prefs: updated.ui });
  });

  return r;
}
