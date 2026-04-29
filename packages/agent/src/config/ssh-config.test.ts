import { describe, it, expect } from 'bun:test';
import { parseSshConfig, parseSshShorthand } from './ssh-config';

describe('parseSshConfig', () => {
  it('parses Host/HostName/User/Port/IdentityFile blocks', () => {
    const text = `
Host dev
  HostName dev.example.com
  User me
  Port 2222
  IdentityFile ~/.ssh/id_ed25519

Host bastion
  HostName bastion.example.com
  User root
`;
    const out = parseSshConfig(text);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      alias: 'dev',
      hostname: 'dev.example.com',
      user: 'me',
      port: 2222,
    });
    expect(out[0].keyPath).toMatch(/[\\/]\.ssh[\\/]id_ed25519$/);
    expect(out[1]).toMatchObject({
      alias: 'bastion',
      hostname: 'bastion.example.com',
      user: 'root',
    });
    expect(out[1].port).toBeUndefined();
  });

  it('skips wildcard hosts and inline comments', () => {
    const text = `
Host *
  ServerAliveInterval 30

Host real # main dev box
  HostName real.example.com
`;
    const out = parseSshConfig(text);
    expect(out).toHaveLength(1);
    expect(out[0].alias).toBe('real');
  });

  it('defaults hostname to alias when HostName omitted', () => {
    const out = parseSshConfig(`Host shortcut\n  User me\n`);
    expect(out[0]).toMatchObject({ alias: 'shortcut', hostname: 'shortcut', user: 'me' });
  });

  it('accepts Key=value form', () => {
    const out = parseSshConfig(`Host eq\nHostName=eq.example.com\nUser=me\nPort=44\n`);
    expect(out[0]).toMatchObject({
      alias: 'eq',
      hostname: 'eq.example.com',
      user: 'me',
      port: 44,
    });
  });

  it('returns empty for empty input', () => {
    expect(parseSshConfig('')).toEqual([]);
  });
});

describe('parseSshShorthand', () => {
  it('parses user@host', () => {
    expect(parseSshShorthand('me@dev.example.com')).toEqual({
      hostname: 'dev.example.com',
      user: 'me',
    });
  });

  it('parses user@host:port', () => {
    expect(parseSshShorthand('me@dev:2222')).toEqual({
      hostname: 'dev',
      user: 'me',
      port: 2222,
    });
  });

  it('strips a leading "ssh " prefix', () => {
    expect(parseSshShorthand('ssh me@dev')).toEqual({
      hostname: 'dev',
      user: 'me',
    });
  });

  it('parses bare hostname without user', () => {
    expect(parseSshShorthand('dev.example.com')).toEqual({
      hostname: 'dev.example.com',
    });
  });

  it('rejects empty / missing host', () => {
    expect(parseSshShorthand('')).toBeNull();
    expect(parseSshShorthand('   ')).toBeNull();
    expect(parseSshShorthand('me@')).toBeNull();
  });

  it('does not eat a colon that is not a numeric port', () => {
    // IPv6-like or trailing non-numeric — keep as part of hostname.
    const out = parseSshShorthand('me@host:notaport');
    expect(out).toEqual({ hostname: 'host:notaport', user: 'me' });
  });
});
