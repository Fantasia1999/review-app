import { useState } from 'react';
import type { CreateHostInput } from '@shared/types';
import {
  useAddHost,
  useLocalKeys,
  useWslDistros,
  useSshConfig,
} from '../api/hooks';
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
  const [shorthand, setShorthand] = useState('');
  const [shorthandErr, setShorthandErr] = useState<string | null>(null);
  const [importAlias, setImportAlias] = useState('');
  const keys = useLocalKeys();
  const wsl = useWslDistros();
  const sshConfig = useSshConfig();
  const addHost = useAddHost();
  const [aliasErr, setAliasErr] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const isLocal = kind === 'local';
  const isWsl = kind === 'wsl';
  const isPassword = kind === 'ssh' && auth === 'password';
  const isKey = kind === 'ssh' && auth === 'key';

  // Parse `[ssh ]user@host[:port]` and fill the SSH fields. Saves the user
  // 3 separate field-fills when they already know the connection string.
  const applyShorthand = () => {
    setShorthandErr(null);
    const trimmed = shorthand.trim().replace(/^ssh\s+/i, '');
    if (!trimmed) {
      setShorthandErr('Enter something like user@host or user@host:2222');
      return;
    }
    const at = trimmed.indexOf('@');
    if (at <= 0) {
      setShorthandErr('Expected user@host');
      return;
    }
    const u = trimmed.slice(0, at);
    let rest = trimmed.slice(at + 1);
    let p = 22;
    const colon = rest.lastIndexOf(':');
    if (colon > -1 && /^\d+$/.test(rest.slice(colon + 1))) {
      p = Number(rest.slice(colon + 1));
      rest = rest.slice(0, colon);
    }
    if (!rest) {
      setShorthandErr('Missing hostname');
      return;
    }
    setUser(u);
    setHostname(rest);
    setPort(p);
    if (!alias) setAlias(rest);
  };

  // Import a parsed entry from ~/.ssh/config — fills hostname/user/port/key.
  const applyImport = (target: string) => {
    setImportAlias(target);
    if (!target) return;
    const entry = sshConfig.data?.entries.find((e) => e.alias === target);
    if (!entry) return;
    setHostname(entry.hostname);
    if (entry.user) setUser(entry.user);
    if (entry.port) setPort(entry.port);
    if (entry.keyPath) {
      setCustomKey(true);
      setKeyPath(entry.keyPath);
    }
    if (!alias) setAlias(entry.alias);
  };

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
              <fieldset className="ssh-shortcuts">
                <legend>Quick fill</legend>
                <div className="row shorthand-row">
                  <input
                    type="text"
                    value={shorthand}
                    onChange={(e) => setShorthand(e.target.value)}
                    placeholder="ssh user@host:port"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        applyShorthand();
                      }
                    }}
                  />
                  <button type="button" onClick={applyShorthand}>
                    Parse
                  </button>
                </div>
                {shorthandErr && (
                  <div className="field-error">{shorthandErr}</div>
                )}
                {sshConfig.data && sshConfig.data.entries.length > 0 && (
                  <label className="import-row">
                    Import from ~/.ssh/config
                    <select
                      value={importAlias}
                      onChange={(e) => applyImport(e.target.value)}
                    >
                      <option value="">Select an entry…</option>
                      {sshConfig.data.entries.map((e) => (
                        <option key={e.alias} value={e.alias}>
                          {e.alias}
                          {e.hostname !== e.alias ? ` → ${e.hostname}` : ''}
                          {e.user ? ` (${e.user})` : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </fieldset>

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
