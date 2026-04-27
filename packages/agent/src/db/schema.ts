/**
 * Annotation database schema.
 *
 * One table, deliberately. v1 has no resolved state, no edit history,
 * no drift detection - annotations are immutable quotes + markdown.
 *
 * Stored at ~/.review-app/db.sqlite alongside the config file.
 */

import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const annotations = sqliteTable('annotations', {
  id: text('id').primaryKey(),
  hostAlias: text('host_alias').notNull(),
  repoPath: text('repo_path').notNull(),
  filePath: text('file_path').notNull(),
  side: text('side', { enum: ['old', 'new'] }).notNull(),
  quotedStartLine: integer('quoted_start_line').notNull(),
  quotedLines: text('quoted_lines').notNull(),
  quotedLang: text('quoted_lang').notNull(),
  body: text('body').notNull(),
  createdAt: integer('created_at').notNull(),
});

export type AnnotationRow = typeof annotations.$inferSelect;
export type NewAnnotationRow = typeof annotations.$inferInsert;
