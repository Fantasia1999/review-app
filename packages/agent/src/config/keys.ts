/**
 * Discover private SSH keys in ~/.ssh/ and detect whether each is encrypted.
 *
 * We look for files matching the conventional names id_rsa / id_ed25519 /
 * id_ecdsa / id_dsa, and skip the corresponding .pub files.
 *
 * "Encrypted" means the key has a passphrase. We detect this by reading the
 * first ~1KB and looking for the standard markers:
 *   - OpenSSH new format: "OPENSSH PRIVATE KEY" header + body marker
 *     For new format, encrypted keys have a non-"none" cipher in the binary
 *     header. We do a cheap textual heuristic: if the base64 body decoded
 *     starts with "openssh-key-v1\0" followed by a cipher name != "none".
 *     For simplicity, we instead check both: PEM-style "ENCRYPTED" marker
 *     OR the new-format binary cipher field.
 *   - PEM legacy format: "Proc-Type: 4,ENCRYPTED" header.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const SSH_DIR = join(homedir(), '.ssh');
const KEY_NAME_RE = /^id_(rsa|ed25519|ecdsa|dsa)$/;

export interface DiscoveredKey {
  path: string;
  filename: string;
  encrypted: boolean;
}

export async function scanLocalKeys(): Promise<DiscoveredKey[]> {
  let files: string[];
  try {
    files = await readdir(SSH_DIR);
  } catch {
    return [];
  }
  const out: DiscoveredKey[] = [];
  for (const f of files) {
    if (!KEY_NAME_RE.test(f)) continue;
    const path = join(SSH_DIR, f);
    try {
      const s = await stat(path);
      if (!s.isFile()) continue;
      const encrypted = await detectEncrypted(path);
      out.push({ path, filename: f, encrypted });
    } catch {
      // Skip unreadable files
    }
  }
  return out;
}

/** Detect whether a private key file is passphrase-protected. */
export async function detectEncrypted(path: string): Promise<boolean> {
  try {
    const buf = await readFile(path, 'utf8');
    // PEM legacy: explicit marker
    if (/Proc-Type:\s*4,ENCRYPTED/i.test(buf)) return true;
    // OpenSSH new format
    if (buf.includes('-----BEGIN OPENSSH PRIVATE KEY-----')) {
      // Strip headers, decode base64, look at cipher field
      const body = buf
        .replace('-----BEGIN OPENSSH PRIVATE KEY-----', '')
        .replace('-----END OPENSSH PRIVATE KEY-----', '')
        .replace(/\s+/g, '');
      try {
        const bin = Buffer.from(body, 'base64');
        // Header: "openssh-key-v1\0" (15 bytes)
        if (bin.toString('utf8', 0, 15) !== 'openssh-key-v1\0') return false;
        // Then: 4-byte length-prefixed cipher name string
        const cipherLen = bin.readUInt32BE(15);
        const cipher = bin.toString('utf8', 19, 19 + cipherLen);
        return cipher !== 'none';
      } catch {
        return false;
      }
    }
    return false;
  } catch {
    return false;
  }
}
