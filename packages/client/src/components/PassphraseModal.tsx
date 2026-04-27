import { useState } from 'react';
import { useSubmitPassphrase, useSubmitPassword } from '../api/hooks';
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
  const [secret, setSecret] = useState('');
  const submitPassphrase = useSubmitPassphrase();
  const submitPassword = useSubmitPassword();
  const [err, setErr] = useState<string | null>(null);
  const isPassword = host.kind === 'ssh' && host.auth === 'password';
  const submit = isPassword ? submitPassword : submitPassphrase;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
      if (host.kind !== 'ssh') return;
      if (host.auth === 'password') {
        await submitPassword.mutateAsync({ alias: host.alias, password: secret });
      } else {
        await submitPassphrase.mutateAsync({ alias: host.alias, passphrase: secret });
      }
      onSubmitted();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <h2>{isPassword ? 'Enter SSH password' : 'Unlock private key'}</h2>
          <button className="btn-close" onClick={onClose}>×</button>
        </header>
        <form onSubmit={onSubmit}>
          <p>
            {isPassword ? (
              <>
                Enter the SSH password for <strong>{host.alias}</strong>.
              </>
            ) : (
              <>
                The key for <strong>{host.alias}</strong> is encrypted.
              </>
            )}
          </p>
          {host.kind === 'ssh' && host.auth === 'key' && (
            <p className="hint">
              <code>{host.keyPath}</code>
            </p>
          )}
          <label>
            {isPassword ? 'Password' : 'Passphrase'}
            <input
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
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
              disabled={!secret || submit.isPending}
            >
              {submit.isPending
                ? isPassword
                  ? 'Saving…'
                  : 'Unlocking…'
                : isPassword
                  ? 'Save password'
                  : 'Unlock'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
