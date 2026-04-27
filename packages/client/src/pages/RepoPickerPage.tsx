/**
 * Repo picker page.
 *
 * Shows the host's recent repos as quick-select buttons, plus a free-form
 * input for typing a new path. On submit, validates the path is a git work
 * tree before navigating to the review page.
 */

import { useState } from 'react';
import {
  useRecentRepos,
  useValidateRepo,
  useTouchRepo,
} from '../api/hooks';
import { navigate } from '../routes';
import type { RemoteError } from '@shared/types';

export function RepoPickerPage({ hostAlias }: { hostAlias: string }) {
  const recents = useRecentRepos(hostAlias);
  const validate = useValidateRepo();
  const touch = useTouchRepo();
  const [path, setPath] = useState('');
  const [error, setError] = useState<RemoteError | null>(null);

  const enter = async (p: string) => {
    setError(null);
    const r = await validate.mutateAsync({ alias: hostAlias, path: p });
    if (r.ok) {
      await touch.mutateAsync({ alias: hostAlias, path: p });
      navigate({ view: 'review', hostAlias, repoPath: p });
    } else {
      setError(r.error ?? { kind: 'unknown', message: 'Validation failed' });
    }
  };

  return (
    <div className="page">
      <header className="page-header">
        <button className="btn-link" onClick={() => navigate({ view: 'hosts' })}>
          ← Hosts
        </button>
        <h1>{hostAlias}</h1>
      </header>

      <section className="repo-input">
        <h2>Open a repository</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (path.trim()) enter(path.trim());
          }}
        >
          <input
            type="text"
            placeholder="/absolute/path/to/repo"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            autoFocus
          />
          <button
            type="submit"
            className="btn-primary"
            disabled={!path.trim() || validate.isPending}
          >
            {validate.isPending ? 'Checking…' : 'Open'}
          </button>
        </form>
        {error && (
          <div className="error-box">
            <strong>{error.kind}:</strong> {error.message}
            {error.stderr && <pre className="stderr">{error.stderr}</pre>}
          </div>
        )}
      </section>

      {recents.data && recents.data.recent.length > 0 && (
        <section className="recent-repos">
          <h2>Recent</h2>
          <ul>
            {recents.data.recent.map((r) => (
              <li key={r.path}>
                <button onClick={() => enter(r.path)}>
                  <code>{r.path}</code>
                  <span className="recent-time">
                    {new Date(r.lastOpenedAt).toLocaleDateString()}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
