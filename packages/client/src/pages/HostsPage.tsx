/**
 * Hosts page - landing page.
 *
 * Lists configured SSH hosts. Each card shows alias / user@host:port and
 * has actions to enter the host (-> repo picker), test connection, and
 * delete. An "Add host" button opens a modal.
 *
 * If the host's key needs a passphrase and it's not yet loaded for this
 * agent session, clicking "open" prompts for the passphrase first.
 */

import { useState } from 'react';
import { useHosts, useDeleteHost, useTestHost } from '../api/hooks';
import { navigate } from '../routes';
import { AddHostModal } from '../components/AddHostModal';
import { PassphraseModal } from '../components/PassphraseModal';
import type { HostConfig } from '@shared/types';

export function HostsPage() {
  const { data, isLoading } = useHosts();
  const [showAdd, setShowAdd] = useState(false);
  const [passphraseFor, setPassphraseFor] = useState<HostConfig | null>(null);
  const deleteHost = useDeleteHost();

  if (isLoading) return <div className="page loading">Loading...</div>;

  const hosts = data?.hosts ?? [];
  const passphraseLoaded = new Set(data?.passphraseLoaded ?? []);

  const open = (host: HostConfig) => {
    if (host.hasPassphrase && !passphraseLoaded.has(host.alias)) {
      setPassphraseFor(host);
      return;
    }
    navigate({ view: 'repo-picker', hostAlias: host.alias });
  };

  return (
    <div className="page">
      <header className="page-header">
        <h1>Hosts</h1>
        <button className="btn-primary" onClick={() => setShowAdd(true)}>
          Add host
        </button>
      </header>

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

      {showAdd && <AddHostModal onClose={() => setShowAdd(false)} />}
      {passphraseFor && (
        <PassphraseModal
          host={passphraseFor}
          onClose={() => setPassphraseFor(null)}
          onSubmitted={() => {
            const h = passphraseFor;
            setPassphraseFor(null);
            navigate({ view: 'repo-picker', hostAlias: h.alias });
          }}
        />
      )}
    </div>
  );
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
          {host.user}@{host.hostname}:{host.port}
        </div>
        <div className="host-key">
          {host.keyPath} {host.hasPassphrase && <span className="badge">encrypted</span>}
        </div>
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
