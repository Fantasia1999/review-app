/**
 * Database setup + annotation CRUD.
 *
 * Uses bun:sqlite (built into Bun, zero deps) with Drizzle for the query layer.
 * Performance pragmas applied on first open: WAL mode, mmap, normal sync.
 */

import { Database } from 'bun:sqlite';
import { drizzle, type BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { eq, and, desc } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type {
  Annotation,
  CreateAnnotationInput,
} from '@review-app/shared';
import { annotations } from './schema';
import { DB_PATH } from '../config/store';
import { ensureConfigDir } from '../config/store';

let db: BunSQLiteDatabase | null = null;

export async function getDb(): Promise<BunSQLiteDatabase> {
  if (db) return db;
  await ensureConfigDir();
  const sqlite = new Database(DB_PATH, { create: true });
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
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ann_repo
      ON annotations (host_alias, repo_path);
    CREATE INDEX IF NOT EXISTS idx_ann_file
      ON annotations (host_alias, repo_path, file_path);
  `);
  db = drizzle(sqlite);
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
  };
  await d.insert(annotations).values(row);
  return rowToAnnotation(row);
}

export async function listAnnotations(
  hostAlias: string,
  repoPath: string,
  filePath?: string,
): Promise<Annotation[]> {
  const d = await getDb();
  const where = filePath
    ? and(
        eq(annotations.hostAlias, hostAlias),
        eq(annotations.repoPath, repoPath),
        eq(annotations.filePath, filePath),
      )
    : and(
        eq(annotations.hostAlias, hostAlias),
        eq(annotations.repoPath, repoPath),
      );
  const rows = await d
    .select()
    .from(annotations)
    .where(where)
    .orderBy(desc(annotations.createdAt));
  return rows.map(rowToAnnotation);
}

export async function deleteAnnotation(id: string): Promise<void> {
  const d = await getDb();
  await d.delete(annotations).where(eq(annotations.id, id));
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
  };
}
