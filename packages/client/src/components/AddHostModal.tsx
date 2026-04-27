import { useState } from 'react';
import { useAddHost, useLocalKeys } from '../api/hooks';

export function AddHostModal({ onClose }: { onClose: () => void }) {
  const [alias, setAlias] = useState('');
  const [hostname, setHostname] = useState('');
  const [user, setUser] = useState('');
  const [port, setPort] = useState(22);
  const [keyPath, setKeyPath] = useState('');
  const [customKey, setCustomKey] = useState(false);
  const keys = useLocalKeys();
  const addHost = useAddHost();
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
      await addHost.mutateAsync({ alias, hostname, user, port, keyPath });
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <h2>Add host</h2>
          <button className="btn-close" onClick={onClose}>
            ×
          </button>
        </header>
        <form onSubmit={submit}>
          <label>
            Alias <span className="hint">(short name shown in UI)</span>
            <input
              type="text"
              value={alias}
              onChange={(e) => setAlias(e.target.value)}
              required
              autoFocus
              placeholder="dev-box"
            />
          </label>
          <label>
            Hostname
            <input
              type="text"
              value={hostname}
              onChange={(e) => setHostname(e.target.value)}
              required
              placeholder="dev.example.com"
            />
          </label>
          <div className="row">
            <label className="grow">
              User
              <input
                type="text"
                value={user}
                onChange={(e) => setUser(e.target.value)}
                required
                placeholder="me"
              />
            </label>
            <label>
              Port
              <input
                type="number"
                value={port}
                onChange={(e) => setPort(parseInt(e.target.value, 10) || 22)}
                min={1}
                max={65535}
              />
            </label>
          </div>
          <fieldset className="key-picker">
            <legend>Private key</legend>
            {!customKey && keys.data && (
              <ul className="key-list">
                {keys.data.keys.length === 0 && (
                  <li className="hint">No keys found in ~/.ssh/</li>
                )}
                {keys.data.keys.map((k) => (
                  <li key={k.path}>
                    <label>
                      <input
                        type="radio"
                        name="key"
                        checked={keyPath === k.path}
                        onChange={() => setKeyPath(k.path)}
                      />
                      <span>{k.filename}</span>
                      {k.encrypted && <span className="badge">encrypted</span>}
                    </label>
                  </li>
                ))}
              </ul>
            )}
            <label className="custom-key-toggle">
              <input
                type="checkbox"
                checked={customKey}
                onChange={(e) => {
                  setCustomKey(e.target.checked);
                  if (!e.target.checked) setKeyPath('');
                }}
              />
              Specify custom path
            </label>
            {customKey && (
              <input
                type="text"
                value={keyPath}
                onChange={(e) => setKeyPath(e.target.value)}
                placeholder="/absolute/path/to/private_key"
                required
              />
            )}
          </fieldset>
          {err && <div className="error-box">{err}</div>}
          <div className="modal-actions">
            <button type="button" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={!alias || !hostname || !user || !keyPath || addHost.isPending}
            >
              {addHost.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
