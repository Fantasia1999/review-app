import { useState } from 'react';
import { useSubmitPassphrase } from '../api/hooks';
import type { HostConfig } from '@shared/types';

export function PassphraseModal({
  host,
  onClose,
  onSubmitted,
}: {
  host: HostConfig;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const [passphrase, setPassphrase] = useState('');
  const submit = useSubmitPassphrase();
  const [err, setErr] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
      await submit.mutateAsync({ alias: host.alias, passphrase });
      onSubmitted();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <h2>Unlock private key</h2>
          <button className="btn-close" onClick={onClose}>×</button>
        </header>
        <form onSubmit={onSubmit}>
          <p>
            The key for <strong>{host.alias}</strong> is encrypted.
          </p>
          <p className="hint">
            <code>{host.keyPath}</code>
          </p>
          <label>
            Passphrase
            <input
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              autoFocus
              required
            />
          </label>
          <p className="hint small">
            Held in memory for this session only. Never written to disk.
          </p>
          {err && <div className="error-box">{err}</div>}
          <div className="modal-actions">
            <button type="button" onClick={onClose}>Cancel</button>
            <button
              type="submit"
              className="btn-primary"
              disabled={!passphrase || submit.isPending}
            >
              {submit.isPending ? 'Unlocking…' : 'Unlock'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
