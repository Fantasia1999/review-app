/**
 * Hosts page - landing page.
 *
 * Lists configured hosts. Each card shows either local-machine or SSH
 * connection details and has actions to enter, test, and delete.
 *
 * If the host needs an in-memory credential (password or key passphrase)
 * and it's not yet loaded for this agent session, clicking "open" prompts.
 */

import { useState } from 'react';
import {
  useHosts,
  useDeleteHost,
  useTestHost,
  useRecentReposAll,
} from '../api/hooks';
import { navigate } from '../routes';
import { AddHostModal } from '../components/AddHostModal';
import { PassphraseModal } from '../components/PassphraseModal';
import type { HostConfig } from '@shared/types';

export function HostsPage() {
  const { data, isLoading } = useHosts();
  const recentAll = useRecentReposAll();
  const [showAdd, setShowAdd] = useState(false);
  const [passphraseFor, setPassphraseFor] = useState<HostConfig | null>(null);
  // When set, after the passphrase modal succeeds we navigate straight to
  // this repo's review page instead of dropping the user on the repo picker.
  const [pendingRepoPath, setPendingRepoPath] = useState<string | null>(null);
  const deleteHost = useDeleteHost();

  if (isLoading) return <div className="page loading">Loading...</div>;

  const hosts = data?.hosts ?? [];
  const credentialLoaded = new Set(
    data?.credentialLoaded ?? data?.passphraseLoaded ?? [],
  );

  const open = (host: HostConfig) => {
    if (needsCredential(host) && !credentialLoaded.has(host.alias)) {
      setPendingRepoPath(null);
      setPassphraseFor(host);
      return;
    }
    navigate({ view: 'repo-picker', hostAlias: host.alias });
  };

  const openRecent = (hostAlias: string, repoPath: string) => {
    const host = hosts.find((h) => h.alias === hostAlias);
    if (!host) return;
    if (needsCredential(host) && !credentialLoaded.has(host.alias)) {
      // Remember the target so we can resume the user's intent after they
      // unlock the host instead of dumping them on the repo picker.
      setPendingRepoPath(repoPath);
      setPassphraseFor(host);
      return;
    }
    navigate({ view: 'review', hostAlias, repoPath });
  };

  const recents = recentAll.data?.recent ?? [];

  return (
    <div className="page">
      <header className="page-header">
        <h1>review-app</h1>
        <div className="page-header-actions">
          <button
            className="btn-link"
            onClick={() => navigate({ view: 'comments' })}
          >
            Manage comments
          </button>
          <button className="btn-primary" onClick={() => setShowAdd(true)}>
            Add host
          </button>
        </div>
      </header>

      {recents.length > 0 && (
        <section className="recent-repos recent-repos-global">
          <h2>Recent repositories</h2>
          <ul>
            {recents.map((r) => (
              <li key={`${r.hostAlias}::${r.path}`}>
                <button onClick={() => openRecent(r.hostAlias, r.path)}>
                  <code>{r.path}</code>
                  <span className="recent-host">{r.hostAlias}</span>
                  <span className="recent-time">
                    {new Date(r.lastOpenedAt).toLocaleDateString()}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="hosts-section">
        <h2>Hosts</h2>
        {hosts.length === 0 ? (
          <div className="empty-state">
            <p>No hosts configured yet.</p>
            <button className="btn-primary" onClick={() => setShowAdd(true)}>
              Add your first host
            </button>
          </div>
        ) : (
          <ul className="host-list">
            {hosts.map((h) => (
              <HostCard
                key={h.alias}
                host={h}
                onOpen={() => open(h)}
                onDelete={() => {
                  if (confirm(`Delete host "${h.alias}"?`)) {
                    deleteHost.mutate(h.alias);
                  }
                }}
              />
            ))}
          </ul>
        )}
      </section>

      {showAdd && <AddHostModal onClose={() => setShowAdd(false)} />}
      {passphraseFor && (
        <PassphraseModal
          host={passphraseFor}
          onClose={() => {
            setPassphraseFor(null);
            setPendingRepoPath(null);
          }}
          onSubmitted={() => {
            const h = passphraseFor;
            const repo = pendingRepoPath;
            setPassphraseFor(null);
            setPendingRepoPath(null);
            if (repo) {
              navigate({ view: 'review', hostAlias: h.alias, repoPath: repo });
            } else {
              navigate({ view: 'repo-picker', hostAlias: h.alias });
            }
          }}
        />
      )}
    </div>
  );
}

function needsCredential(host: HostConfig): boolean {
  return host.kind === 'ssh' && (host.auth === 'password' || host.hasPassphrase);
}

function HostCard({
  host,
  onOpen,
  onDelete,
}: {
  host: HostConfig;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const test = useTestHost();
  return (
    <li className="host-card">
      <div className="host-card-main" onClick={onOpen}>
        <div className="host-alias">{host.alias}</div>
        <div className="host-conn">
          {host.kind === 'local'
            ? 'Local machine'
            : host.kind === 'wsl'
              ? `WSL · ${host.distro}`
              : `${host.user}@${host.hostname}:${host.port}`}
        </div>
        {host.kind === 'ssh' && host.auth === 'key' && (
          <div className="host-key">
            {host.keyPath} {host.hasPassphrase && <span className="badge">encrypted</span>}
          </div>
        )}
        {host.kind === 'ssh' && host.auth === 'password' && (
          <div className="host-key">
            Password auth <span className="badge">memory-only</span>
          </div>
        )}
      </div>
      <div className="host-card-actions">
        <button
          onClick={() => test.mutate(host.alias)}
          disabled={test.isPending}
        >
          {test.isPending ? 'Testing…' : 'Test'}
        </button>
        <button onClick={onDelete} className="btn-danger">
          Delete
        </button>
      </div>
      {test.data && (
        <div className={`host-test-result ${test.data.ok ? 'ok' : 'fail'}`}>
          {test.data.ok ? (
            <span>OK · {test.data.gitVersion}</span>
          ) : (
            <span>{test.data.error?.message ?? 'failed'}</span>
          )}
        </div>
      )}
    </li>
  );
}
