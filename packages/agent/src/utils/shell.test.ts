import { describe, expect, it } from 'bun:test';
import { shellEscape } from './shell';

describe('shellEscape', () => {
  it('returns "" for empty string', () => {
    expect(shellEscape('')).toBe("''");
  });

  it('passes safe identifiers through unmodified', () => {
    expect(shellEscape('foo')).toBe('foo');
    expect(shellEscape('foo-bar.txt')).toBe('foo-bar.txt');
    expect(shellEscape('a1_2-3.4/5')).toBe('a1_2-3.4/5');
    expect(shellEscape('user@host:8080')).toBe('user@host:8080');
    expect(shellEscape('PATH=/usr/bin')).toBe('PATH=/usr/bin');
  });

  it('quotes strings with spaces', () => {
    expect(shellEscape('foo bar')).toBe("'foo bar'");
  });

  it('escapes embedded single quotes', () => {
    expect(shellEscape("it's")).toBe("'it'\\''s'");
    expect(shellEscape("a'b'c")).toBe("'a'\\''b'\\''c'");
  });

  it('quotes strings with shell metacharacters', () => {
    expect(shellEscape('a;b')).toBe("'a;b'");
    expect(shellEscape('a$b')).toBe("'a$b'");
    expect(shellEscape('`whoami`')).toBe("'`whoami`'");
    expect(shellEscape('a&b|c')).toBe("'a&b|c'");
    expect(shellEscape('*?[]')).toBe("'*?[]'");
  });

  it('handles paths with spaces and quotes safely', () => {
    expect(shellEscape("/tmp/it's a path")).toBe("'/tmp/it'\\''s a path'");
  });
});
