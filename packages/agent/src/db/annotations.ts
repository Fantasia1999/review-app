/**
 * Database setup + annotation CRUD.
 *
 * Uses bun:sqlite (built into Bun, zero deps) with Drizzle for the query layer.
 * Performance pragmas applied on first open: WAL mode, mmap, normal sync.
 */

import { Database } from 'bun:sqlite';
import { drizzle, type BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { eq, and, desc, isNull, isNotNull } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type {
  Annotation,
  CreateAnnotationInput,
} from '@review-app/shared';
import { annotations } from './schema';
import { getDbPath } from '../config/store';
import { ensureConfigDir } from '../config/store';

let db: BunSQLiteDatabase | null = null;
let dbPath: string | null = null;
let rawSqlite: Database | null = null;

/** Test-only: close DB so the file can be cleaned up. */
export function __closeDbForTests(): void {
  if (rawSqlite) {
    rawSqlite.close();
    rawSqlite = null;
  }
  db = null;
  dbPath = null;
}

export async function getDb(): Promise<BunSQLiteDatabase> {
  const path = getDbPath();
  if (db && dbPath === path) return db;
  await ensureConfigDir();
  const sqlite = new Database(path, { create: true });
  // Performance / safety pragmas
  sqlite.exec('PRAGMA journal_mode = WAL;');
  sqlite.exec('PRAGMA synchronous = NORMAL;');
  sqlite.exec('PRAGMA mmap_size = 30000000;');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  // Schema bootstrap (Drizzle migrations are overkill for a single table)
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS annotations (
      id TEXT PRIMARY KEY,
      host_alias TEXT NOT NULL,
      repo_path TEXT NOT NULL,
      file_path TEXT NOT NULL,
      side TEXT NOT NULL CHECK (side IN ('old', 'new')),
      quoted_start_line INTEGER NOT NULL,
      quoted_lines TEXT NOT NULL,
      quoted_lang TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      archived_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_ann_repo
      ON annotations (host_alias, repo_path);
    CREATE INDEX IF NOT EXISTS idx_ann_file
      ON annotations (host_alias, repo_path, file_path);
  `);
  // Migration: add archived_at to pre-existing DBs that didn't have it.
  // SQLite has no IF NOT EXISTS for ADD COLUMN, so we catch the duplicate-column error.
  try {
    sqlite.exec('ALTER TABLE annotations ADD COLUMN archived_at INTEGER');
  } catch (err) {
    const msg = (err as Error).message ?? '';
    if (!/duplicate column/i.test(msg)) throw err;
  }
  db = drizzle(sqlite);
  dbPath = path;
  rawSqlite = sqlite;
  return db;
}

export async function createAnnotation(
  input: CreateAnnotationInput,
): Promise<Annotation> {
  const d = await getDb();
  const row = {
    id: nanoid(),
    hostAlias: input.hostAlias,
    repoPath: input.repoPath,
    filePath: input.filePath,
    side: input.side,
    quotedStartLine: input.quotedStartLine,
    quotedLines: input.quotedLines,
    quotedLang: input.quotedLang,
    body: input.body,
    createdAt: Date.now(),
    archivedAt: null,
  };
  await d.insert(annotations).values(row);
  return rowToAnnotation(row);
}

export interface ListAnnotationsOptions {
  /** If true, archived rows are included alongside non-archived. */
  includeArchived?: boolean;
  /** If true, ONLY archived rows are returned. Wins over includeArchived. */
  archivedOnly?: boolean;
}

export async function listAnnotations(
  hostAlias: string,
  repoPath: string,
  filePath?: string,
  opts: ListAnnotationsOptions = {},
): Promise<Annotation[]> {
  const d = await getDb();
  const filters = [
    eq(annotations.hostAlias, hostAlias),
    eq(annotations.repoPath, repoPath),
  ];
  if (filePath) filters.push(eq(annotations.filePath, filePath));
  if (opts.archivedOnly) {
    filters.push(isNotNull(annotations.archivedAt));
  } else if (!opts.includeArchived) {
    filters.push(isNull(annotations.archivedAt));
  }
  const rows = await d
    .select()
    .from(annotations)
    .where(and(...filters))
    .orderBy(desc(annotations.createdAt));
  return rows.map(rowToAnnotation);
}

/** List annotations across all hosts/repos. Used by the management page. */
export async function listAllAnnotations(
  opts: ListAnnotationsOptions = {},
): Promise<Annotation[]> {
  const d = await getDb();
  const filters = [];
  if (opts.archivedOnly) {
    filters.push(isNotNull(annotations.archivedAt));
  } else if (!opts.includeArchived) {
    filters.push(isNull(annotations.archivedAt));
  }
  const q = d.select().from(annotations);
  const rows = filters.length
    ? await q.where(and(...filters)).orderBy(desc(annotations.createdAt))
    : await q.orderBy(desc(annotations.createdAt));
  return rows.map(rowToAnnotation);
}

export async function deleteAnnotation(id: string): Promise<void> {
  const d = await getDb();
  await d.delete(annotations).where(eq(annotations.id, id));
}

/** Soft-clear a single annotation (mark archived). Idempotent. */
export async function setAnnotationArchived(
  id: string,
  archived: boolean,
): Promise<void> {
  const d = await getDb();
  await d
    .update(annotations)
    .set({ archivedAt: archived ? Date.now() : null })
    .where(eq(annotations.id, id));
}

/**
 * Bulk soft-clear: archive every non-archived annotation belonging to
 * (hostAlias, repoPath). Returns the number of rows affected.
 */
export async function archiveAllForRepo(
  hostAlias: string,
  repoPath: string,
): Promise<number> {
  const d = await getDb();
  // Count what we're about to flip so we can return a meaningful number
  // without relying on drizzle's run() result shape across adapters.
  const pending = await d
    .select({ id: annotations.id })
    .from(annotations)
    .where(
      and(
        eq(annotations.hostAlias, hostAlias),
        eq(annotations.repoPath, repoPath),
        isNull(annotations.archivedAt),
      ),
    );
  if (pending.length === 0) return 0;
  await d
    .update(annotations)
    .set({ archivedAt: Date.now() })
    .where(
      and(
        eq(annotations.hostAlias, hostAlias),
        eq(annotations.repoPath, repoPath),
        isNull(annotations.archivedAt),
      ),
    );
  return pending.length;
}

export async function updateAnnotationBody(
  id: string,
  body: string,
): Promise<void> {
  const d = await getDb();
  await d.update(annotations).set({ body }).where(eq(annotations.id, id));
}

function rowToAnnotation(row: typeof annotations.$inferSelect): Annotation {
  return {
    id: row.id,
    hostAlias: row.hostAlias,
    repoPath: row.repoPath,
    filePath: row.filePath,
    side: row.side as 'old' | 'new',
    quotedStartLine: row.quotedStartLine,
    quotedLines: row.quotedLines,
    quotedLang: row.quotedLang,
    body: row.body,
    createdAt: row.createdAt,
    archivedAt: row.archivedAt ?? null,
  };
}
