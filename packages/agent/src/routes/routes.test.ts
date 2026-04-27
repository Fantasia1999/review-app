/**
 * Integration tests for HTTP routes (annotations, hosts, read-marks).
 * Uses a temp config dir + DB and Hono's app.fetch.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { Hono } from 'hono';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'review-app-routes-'));
  process.env.REVIEW_APP_CONFIG_DIR = dir;
  process.env.REVIEW_APP_DB_PATH = join(dir, 'db.sqlite');
});

afterEach(async () => {
  const ann = await import('../db/annotations');
  ann.__closeDbForTests();
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
  delete process.env.REVIEW_APP_CONFIG_DIR;
  delete process.env.REVIEW_APP_DB_PATH;
});

async function buildApp() {
  const { ExecutorPool } = await import('../remote/pool');
  const { hostsRoutes } = await import('./hosts');
  const { annotationsRoutes } = await import('./annotations');
  const { readMarksRoutes } = await import('./read-marks');
  const cfg = await import('../config/store');
  cfg.__resetConfigCacheForTests();
  const pool = new ExecutorPool();
  const app = new Hono();
  app.route('/api/hosts', hostsRoutes(pool));
  app.route('/api/annotations', annotationsRoutes());
  app.route('/api/read-marks', readMarksRoutes());
  return { app, pool };
}

function jsonReq(path: string, init: RequestInit = {}) {
  return new Request('http://localhost' + path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
}

describe('hosts routes', () => {
  it('lists empty initially', async () => {
    const { app } = await buildApp();
    const res = await app.fetch(jsonReq('/api/hosts'));
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.hosts).toEqual([]);
  });

  it('rejects POST with missing fields (400)', async () => {
    const { app } = await buildApp();
    const res = await app.fetch(
      jsonReq('/api/hosts', { method: 'POST', body: JSON.stringify({ alias: 'a' }) }),
    );
    expect(res.status).toBe(400);
  });

  it('creates a host (200) and rejects duplicate alias (409)', async () => {
    const { app } = await buildApp();
    const keyPath = join(dir, 'fake-key');
    writeFileSync(keyPath, 'not-a-real-key');
    const body = JSON.stringify({
      alias: 'a',
      hostname: 'h',
      user: 'u',
      keyPath,
    });
    const r1 = await app.fetch(jsonReq('/api/hosts', { method: 'POST', body }));
    expect(r1.status).toBe(200);

    const r2 = await app.fetch(jsonReq('/api/hosts', { method: 'POST', body }));
    expect(r2.status).toBe(409);
    const dupBody = await r2.json() as any;
    expect(dupBody.error).toMatch(/already exists/);
  });

  it('PUT returns 404 for unknown alias', async () => {
    const { app } = await buildApp();
    const r = await app.fetch(
      jsonReq('/api/hosts/nope', { method: 'PUT', body: '{}' }),
    );
    expect(r.status).toBe(404);
  });

  it('DELETE removes a host', async () => {
    const { app } = await buildApp();
    const keyPath = join(dir, 'fake-key');
    writeFileSync(keyPath, 'x');
    await app.fetch(
      jsonReq('/api/hosts', {
        method: 'POST',
        body: JSON.stringify({ alias: 'b', hostname: 'h', user: 'u', keyPath }),
      }),
    );
    const r = await app.fetch(jsonReq('/api/hosts/b', { method: 'DELETE' }));
    expect(r.status).toBe(200);
    const after = await app.fetch(jsonReq('/api/hosts'));
    expect((await after.json() as any).hosts).toEqual([]);
  });

  it('passphrase endpoint stores in pool', async () => {
    const { app, pool } = await buildApp();
    const r = await app.fetch(
      jsonReq('/api/hosts/x/passphrase', {
        method: 'POST',
        body: JSON.stringify({ passphrase: 'secret' }),
      }),
    );
    expect(r.status).toBe(200);
    expect(pool.hasPassphrase('x')).toBe(true);
  });
});

describe('annotations routes', () => {
  it('rejects GET without host/repo', async () => {
    const { app } = await buildApp();
    const r = await app.fetch(jsonReq('/api/annotations'));
    expect(r.status).toBe(400);
  });

  it('full CRUD lifecycle', async () => {
    const { app } = await buildApp();
    const create = await app.fetch(
      jsonReq('/api/annotations', {
        method: 'POST',
        body: JSON.stringify({
          hostAlias: 'h',
          repoPath: '/r',
          filePath: 'f.ts',
          side: 'new',
          quotedStartLine: 1,
          quotedLines: 'a\nb\nc\nd\ne',
          quotedLang: 'ts',
          body: 'hi',
        }),
      }),
    );
    expect(create.status).toBe(200);
    const created = (await create.json() as any).annotation;
    expect(created.id).toBeTruthy();

    const list = await app.fetch(jsonReq('/api/annotations?host=h&repo=/r'));
    expect((await list.json() as any).annotations).toHaveLength(1);

    const patch = await app.fetch(
      jsonReq('/api/annotations/' + created.id, {
        method: 'PATCH',
        body: JSON.stringify({ body: 'updated' }),
      }),
    );
    expect(patch.status).toBe(200);

    const list2 = await app.fetch(jsonReq('/api/annotations?host=h&repo=/r'));
    expect((await list2.json() as any).annotations[0].body).toBe('updated');

    const del = await app.fetch(
      jsonReq('/api/annotations/' + created.id, { method: 'DELETE' }),
    );
    expect(del.status).toBe(200);

    const list3 = await app.fetch(jsonReq('/api/annotations?host=h&repo=/r'));
    expect((await list3.json() as any).annotations).toEqual([]);
  });

  it('rejects invalid create payload', async () => {
    const { app } = await buildApp();
    const r = await app.fetch(
      jsonReq('/api/annotations', {
        method: 'POST',
        body: JSON.stringify({ hostAlias: 'h' }),
      }),
    );
    expect(r.status).toBe(400);
  });
});

describe('read-marks routes', () => {
  it('add then list, then delete', async () => {
    const { app } = await buildApp();
    const mark = {
      hostAlias: 'h',
      repoPath: '/r',
      filePath: 'f.ts',
      contentHash: 'abc',
    };
    const post = await app.fetch(
      jsonReq('/api/read-marks', { method: 'POST', body: JSON.stringify(mark) }),
    );
    expect(post.status).toBe(200);

    const list = await app.fetch(jsonReq('/api/read-marks?host=h&repo=/r'));
    expect((await list.json() as any).marks).toHaveLength(1);

    // Re-add same file replaces the mark instead of duplicating
    await app.fetch(
      jsonReq('/api/read-marks', {
        method: 'POST',
        body: JSON.stringify({ ...mark, contentHash: 'def' }),
      }),
    );
    const list2 = await app.fetch(jsonReq('/api/read-marks?host=h&repo=/r'));
    const marks = (await list2.json() as any).marks;
    expect(marks).toHaveLength(1);
    expect(marks[0].contentHash).toBe('def');

    const del = await app.fetch(
      jsonReq('/api/read-marks', { method: 'DELETE', body: JSON.stringify(mark) }),
    );
    expect(del.status).toBe(200);
    const list3 = await app.fetch(jsonReq('/api/read-marks?host=h&repo=/r'));
    expect((await list3.json() as any).marks).toEqual([]);
  });
});
