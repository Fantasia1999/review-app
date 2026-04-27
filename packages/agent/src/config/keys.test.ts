import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectEncrypted } from './keys';

function tmpKey(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'review-app-keys-'));
  const path = join(dir, 'id_rsa');
  writeFileSync(path, content);
  return path;
}

function buildOpensshKey(cipher: string): string {
  // openssh-key-v1\0 + 4-byte length + cipher name + (trailing junk OK for our parser)
  const header = Buffer.from('openssh-key-v1\0', 'utf8'); // 15 bytes
  const cipherBuf = Buffer.from(cipher, 'utf8');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(cipherBuf.length, 0);
  const tail = Buffer.alloc(64); // arbitrary trailing data
  const bin = Buffer.concat([header, lenBuf, cipherBuf, tail]);
  const body = bin.toString('base64');
  return (
    '-----BEGIN OPENSSH PRIVATE KEY-----\n' +
    body.match(/.{1,70}/g)!.join('\n') +
    '\n-----END OPENSSH PRIVATE KEY-----\n'
  );
}

describe('detectEncrypted', () => {
  it('returns false for missing file', async () => {
    expect(await detectEncrypted('/nonexistent/key/path')).toBe(false);
  });

  it('detects PEM-format encrypted key', async () => {
    const path = tmpKey(
      '-----BEGIN RSA PRIVATE KEY-----\n' +
        'Proc-Type: 4,ENCRYPTED\n' +
        'DEK-Info: AES-128-CBC,1234\n\n' +
        'AAAA\n-----END RSA PRIVATE KEY-----\n',
    );
    expect(await detectEncrypted(path)).toBe(true);
  });

  it('returns false for unencrypted PEM-format key', async () => {
    const path = tmpKey('-----BEGIN RSA PRIVATE KEY-----\nAAAA\n-----END RSA PRIVATE KEY-----\n');
    expect(await detectEncrypted(path)).toBe(false);
  });

  it('detects OpenSSH new-format encrypted key (cipher != "none")', async () => {
    const path = tmpKey(buildOpensshKey('aes256-ctr'));
    expect(await detectEncrypted(path)).toBe(true);
  });

  it('detects OpenSSH new-format unencrypted key (cipher = "none")', async () => {
    const path = tmpKey(buildOpensshKey('none'));
    expect(await detectEncrypted(path)).toBe(false);
  });
});
