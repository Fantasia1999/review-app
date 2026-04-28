import { useState } from 'react';
import type { CreateHostInput } from '@shared/types';
import { useAddHost, useLocalKeys, useWslDistros } from '../api/hooks';
import { ApiError } from '../api/client';

export function AddHostModal({ onClose }: { onClose: () => void }) {
  const [alias, setAlias] = useState('');
  const [kind, setKind] = useState<'ssh' | 'local' | 'wsl'>('ssh');
  const [auth, setAuth] = useState<'key' | 'password'>('key');
  const [hostname, setHostname] = useState('');
  const [user, setUser] = useState('');
  const [port, setPort] = useState(22);
  const [keyPath, setKeyPath] = useState('');
  const [password, setPassword] = useState('');
  const [customKey, setCustomKey] = useState(false);
  const [distro, setDistro] = useState('');
  const keys = useLocalKeys();
  const wsl = useWslDistros();
  const addHost = useAddHost();
  const [aliasErr, setAliasErr] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const isLocal = kind === 'local';
  const isWsl = kind === 'wsl';
  const isPassword = kind === 'ssh' && auth === 'password';
  const isKey = kind === 'ssh' && auth === 'key';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAliasErr(null);
    setErr(null);
    const payload: CreateHostInput = isLocal
      ? { alias, kind: 'local' }
      : isWsl
        ? { alias, kind: 'wsl', distro }
        : isPassword
          ? {
              alias,
              kind: 'ssh',
              auth: 'password',
              hostname,
              user,
              port,
              password,
            }
          : {
              alias,
              kind: 'ssh',
              auth: 'key',
              hostname,
              user,
              port,
              keyPath,
            };
    try {
      await addHost.mutateAsync(payload);
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setAliasErr(e.info.message);
        return;
      }
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const canSave =
    !!alias &&
    (isLocal ||
      (isWsl ? !!distro : false) ||
      (!!hostname && !!user && (isPassword ? !!password : !!keyPath)));

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
              onChange={(e) => {
                setAlias(e.target.value);
                if (aliasErr) setAliasErr(null);
              }}
              required
              autoFocus
              placeholder={isLocal ? 'local' : 'dev-box'}
              aria-invalid={aliasErr ? 'true' : 'false'}
              className={aliasErr ? 'input-invalid' : undefined}
            />
            {aliasErr && <div className="field-error">{aliasErr}</div>}
          </label>

          <label>
            Connection type
            <select
              value={kind}
              onChange={(e) =>
                setKind(e.target.value as 'ssh' | 'local' | 'wsl')
              }
            >
              <option value="ssh">SSH host</option>
              <option value="local">Local machine</option>
              <option value="wsl">WSL (Windows)</option>
            </select>
          </label>

          {!isLocal && !isWsl && (
            <>
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

              <label>
                Authentication
                <select
                  value={auth}
                  onChange={(e) => setAuth(e.target.value as 'key' | 'password')}
                >
                  <option value="key">Private key</option>
                  <option value="password">Password</option>
                </select>
              </label>

              {isKey && (
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
                      placeholder="C:\\absolute\\path\\to\\private_key"
                      required
                    />
                  )}
                </fieldset>
              )}

              {isPassword && (
                <label>
                  Password
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="SSH account password"
                    required
                  />
                  <div className="hint small">
                    Held in memory for this session only. Never written to disk.
                  </div>
                </label>
              )}
            </>
          )}

          {isLocal && (
            <div className="hint">
              Opens git repositories from this machine&apos;s local disk.
            </div>
          )}

          {isWsl && (
            <>
              <label>
                Distribution
                {wsl.data && wsl.data.distros.length > 0 ? (
                  <select
                    value={distro}
                    onChange={(e) => setDistro(e.target.value)}
                    required
                  >
                    <option value="">Select a distribution…</option>
                    {wsl.data.distros.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={distro}
                    onChange={(e) => setDistro(e.target.value)}
                    placeholder="Ubuntu"
                    required
                  />
                )}
              </label>
              <div className="hint small">
                {wsl.data?.available === false
                  ? 'WSL is only available on Windows. The host will not work on this machine.'
                  : wsl.data && wsl.data.distros.length === 0
                    ? 'No WSL distributions detected. Install one with `wsl --install` first.'
                    : 'Runs git inside the chosen WSL distro via wsl.exe. Use POSIX paths like /home/me/proj.'}
              </div>
            </>
          )}

          {err && <div className="error-box">{err}</div>}
          <div className="modal-actions">
            <button type="button" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={!canSave || addHost.isPending}
            >
              {addHost.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
