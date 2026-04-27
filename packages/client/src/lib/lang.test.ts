import { describe, expect, it } from 'bun:test';
import { detectLang } from './lang';

describe('detectLang', () => {
  it('detects common extensions', () => {
    expect(detectLang('a.ts')).toBe('ts');
    expect(detectLang('a.tsx')).toBe('tsx');
    expect(detectLang('a.py')).toBe('python');
    expect(detectLang('a.go')).toBe('go');
    expect(detectLang('a.rs')).toBe('rust');
    expect(detectLang('a.md')).toBe('markdown');
    expect(detectLang('a.yml')).toBe('yaml');
    expect(detectLang('a.yaml')).toBe('yaml');
  });

  it('handles dotted basenames', () => {
    expect(detectLang('foo.bar.ts')).toBe('ts');
  });

  it('returns "" for unknown extensions', () => {
    expect(detectLang('a.unknownxyz')).toBe('');
    expect(detectLang('noext')).toBe('');
  });

  it('detects Dockerfile and Makefile by name', () => {
    expect(detectLang('Dockerfile')).toBe('dockerfile');
    expect(detectLang('path/to/Dockerfile')).toBe('dockerfile');
    expect(detectLang('Makefile')).toBe('makefile');
    expect(detectLang('src/Makefile')).toBe('makefile');
  });

  it('is case-insensitive on extension', () => {
    expect(detectLang('FOO.TS')).toBe('ts');
  });
});
