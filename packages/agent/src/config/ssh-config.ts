/**
 * Minimal ~/.ssh/config reader.
 *
 * Per DESIGN.md §4.1 we don't *use* ssh_config to actually connect — we
 * still ask ssh2 to dial with explicit hostname/user/port/key. But surfacing
 * existing aliases as a one-click import in the AddHostModal removes a huge
 * usability papercut for users who already have ssh_config set up.
 *
 * We intentionally only parse the five fields review-app cares about:
 *   Host, HostName, User, Port, IdentityFile
 *
 * Everything else (ProxyJump, ControlMaster, custom directives) is ignored.
 * Wildcard hosts ("Host *") are skipped — there's nothing to navigate to.
 */

import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface SshConfigEntry {
  /** The Host alias as written in ssh_config */
  alias: string;
  hostname: string;
  user?: string;
  port?: number;
  keyPath?: string;
}

const SSH_CONFIG_PATH = join(homedir(), '.ssh', 'config');

function expandTilde(p: string): string {
  if (p.startsWith('~/') || p === '~') {
    return join(homedir(), p.slice(1));
  }
  return p;
}

export async function readSshConfig(): Promise<SshConfigEntry[]> {
  let text: string;
  try {
    text = await readFile(SSH_CONFIG_PATH, 'utf8');
  } catch {
    return [];
  }
  return parseSshConfig(text);
}

export function parseSshConfig(text: string): SshConfigEntry[] {
  const out: SshConfigEntry[] = [];
  let current: SshConfigEntry | null = null;

  const flush = () => {
    if (current && !current.alias.includes('*') && !current.alias.includes('?')) {
      // Default hostname to the alias if not set
      if (!current.hostname) current.hostname = current.alias;
      out.push(current);
    }
    current = null;
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    // Match "Key value" or "Key=value"
    const m = /^([A-Za-z]+)\s*[=\s]\s*(.+)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim().replace(/^"(.*)"$/, '$1');

    if (key === 'host') {
      flush();
      // Host can list multiple aliases; take only the first single token.
      const aliases = value.split(/\s+/);
      const first = aliases[0];
      current = { alias: first, hostname: '' };
      continue;
    }
    if (!current) continue;
    switch (key) {
      case 'hostname':
        current.hostname = value;
        break;
      case 'user':
        current.user = value;
        break;
      case 'port': {
        const n = Number(value);
        if (Number.isFinite(n) && n > 0) current.port = n;
        break;
      }
      case 'identityfile':
        current.keyPath = expandTilde(value);
        break;
    }
  }
  flush();
  return out;
}

/**
 * Parse an ssh shorthand like `user@host[:port]` or `host`.
 * Returns null if it doesn't look like a valid spec.
 */
export function parseSshShorthand(input: string): {
  hostname: string;
  user?: string;
  port?: number;
} | null {
  const trimmed = input.trim().replace(/^ssh\s+/i, '');
  if (!trimmed) return null;
  let user: string | undefined;
  let rest = trimmed;
  const at = trimmed.indexOf('@');
  if (at > 0) {
    user = trimmed.slice(0, at);
    rest = trimmed.slice(at + 1);
  }
  let port: number | undefined;
  const colon = rest.lastIndexOf(':');
  if (colon > -1 && /^\d+$/.test(rest.slice(colon + 1))) {
    port = Number(rest.slice(colon + 1));
    rest = rest.slice(0, colon);
  }
  if (!rest) return null;
  return { hostname: rest, user, port };
}
