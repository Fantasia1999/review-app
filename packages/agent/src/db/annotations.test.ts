import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'review-app-db-'));
  process.env.REVIEW_APP_CONFIG_DIR = dir;
  process.env.REVIEW_APP_DB_PATH = join(dir, 'db.sqlite');
});

afterEach(async () => {
  const ann = await import('./annotations');
  ann.__closeDbForTests();
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
  delete process.env.REVIEW_APP_CONFIG_DIR;
  delete process.env.REVIEW_APP_DB_PATH;
});

describe('annotations db', () => {
  it('creates, lists, updates, and deletes annotations', async () => {
    // Re-import after env vars are set so DB_PATH binds to the temp dir.
    // Bun caches modules across tests - to avoid that, we use a fresh DB
    // path each test and lean on `getDb`'s lazy init by calling once.
    const annotations = await import('./annotations');
    const cfg = await import('../config/store');
    cfg.__resetConfigCacheForTests();

    const a1 = await annotations.createAnnotation({
      hostAlias: 'h',
      repoPath: '/r',
      filePath: 'a.ts',
      side: 'new',
      quotedStartLine: 10,
      quotedLines: 'line1\nline2\nline3\nline4\nline5',
      quotedLang: 'ts',
      body: 'note 1',
    });
    expect(a1.id).toBeTruthy();
    expect(a1.body).toBe('note 1');

    const a2 = await annotations.createAnnotation({
      hostAlias: 'h',
      repoPath: '/r',
      filePath: 'b.ts',
      side: 'old',
      quotedStartLine: 1,
      quotedLines: '1\n2\n3\n4\n5',
      quotedLang: 'ts',
      body: 'note 2',
    });

    const all = await annotations.listAnnotations('h', '/r');
    expect(all.length).toBeGreaterThanOrEqual(2);

    const filtered = await annotations.listAnnotations('h', '/r', 'a.ts');
    expect(filtered.every((x) => x.filePath === 'a.ts')).toBe(true);

    await annotations.updateAnnotationBody(a1.id, 'edited');
    const after = await annotations.listAnnotations('h', '/r', 'a.ts');
    expect(after.find((x) => x.id === a1.id)?.body).toBe('edited');

    await annotations.deleteAnnotation(a2.id);
    const afterDel = await annotations.listAnnotations('h', '/r');
    expect(afterDel.find((x) => x.id === a2.id)).toBeUndefined();
  });
});
