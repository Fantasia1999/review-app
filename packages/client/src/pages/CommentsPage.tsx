/**
 * Comments management page.
 *
 * Lists every annotation across all hosts/repos. The "Show cleared"
 * toggle decides whether archived rows appear. Per-card actions are in
 * "manage" mode: Restore (for archived) and Hard delete.
 *
 * This is the *only* place where hard delete is exposed. The review flow
 * uses soft-clear (archive) so nothing is lost mid-review.
 */

import { useMemo, useState } from 'react';
import { useAllAnnotations } from '../api/hooks';
import { AnnotationCard } from '../components/AnnotationCard';
import { navigate } from '../routes';
import type { Annotation } from '@shared/types';

type Filter = 'active' | 'archived' | 'all';

export function CommentsPage() {
  const [filter, setFilter] = useState<Filter>('active');

  const query = useAllAnnotations({
    includeArchived: filter !== 'active',
    archivedOnly: filter === 'archived',
  });

  const groups = useMemo(() => groupByRepo(query.data?.annotations ?? []), [
    query.data,
  ]);

  return (
    <div className="page comments-page">
      <header className="page-header">
        <div>
          <button
            className="btn-link"
            onClick={() => navigate({ view: 'hosts' })}
          >
            ← Hosts
          </button>
          <h1>Comments</h1>
        </div>
        <div className="comments-filter" role="radiogroup" aria-label="Filter">
          <label>
            <input
              type="radio"
              name="filter"
              checked={filter === 'active'}
              onChange={() => setFilter('active')}
            />
            Active
          </label>
          <label>
            <input
              type="radio"
              name="filter"
              checked={filter === 'archived'}
              onChange={() => setFilter('archived')}
            />
            Cleared
          </label>
          <label>
            <input
              type="radio"
              name="filter"
              checked={filter === 'all'}
              onChange={() => setFilter('all')}
            />
            All
          </label>
        </div>
      </header>

      {query.isLoading && <div className="loading">Loading…</div>}
      {query.error && (
        <div className="error-box">{(query.error as Error).message}</div>
      )}

      {query.data && groups.length === 0 && (
        <div className="empty-state">
          <p>
            {filter === 'archived'
              ? 'No cleared comments.'
              : filter === 'active'
                ? 'No active comments.'
                : 'No comments yet.'}
          </p>
        </div>
      )}

      {groups.map((g) => (
        <section key={g.key} className="comments-group">
          <h2 className="comments-group-header">
            <span className="comments-group-host">{g.hostAlias}</span>
            <span className="comments-group-sep">·</span>
            <span className="comments-group-repo" title={g.repoPath}>
              {g.repoPath}
            </span>
            <span className="ann-count-badge">{g.items.length}</span>
          </h2>
          <div className="comments-group-list">
            {g.items.map((a) => (
              <AnnotationCard key={a.id} annotation={a} mode="manage" />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

interface Group {
  key: string;
  hostAlias: string;
  repoPath: string;
  items: Annotation[];
}

function groupByRepo(items: Annotation[]): Group[] {
  const map = new Map<string, Group>();
  for (const a of items) {
    const key = `${a.hostAlias}\u0000${a.repoPath}`;
    let g = map.get(key);
    if (!g) {
      g = { key, hostAlias: a.hostAlias, repoPath: a.repoPath, items: [] };
      map.set(key, g);
    }
    g.items.push(a);
  }
  return [...map.values()].sort((a, b) =>
    a.hostAlias === b.hostAlias
      ? a.repoPath.localeCompare(b.repoPath)
      : a.hostAlias.localeCompare(b.hostAlias),
  );
}
