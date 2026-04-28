import { describe, expect, it } from 'bun:test';
import { parseHash, buildHash } from './routes';

describe('parseHash', () => {
  it('parses empty / "#" / "#/" as hosts view', () => {
    expect(parseHash('').view).toBe('hosts');
    expect(parseHash('#').view).toBe('hosts');
    expect(parseHash('#/').view).toBe('hosts');
  });

  it('parses /h/<alias> as repo-picker', () => {
    expect(parseHash('#/h/dev-box')).toEqual({
      view: 'repo-picker',
      hostAlias: 'dev-box',
    });
  });

  it('parses /h/<alias>/r/<base64> as review', () => {
    const repo = '/home/me/proj';
    const hash = buildHash({ view: 'review', hostAlias: 'dev', repoPath: repo });
    const parsed = parseHash(hash);
    expect(parsed.view).toBe('review');
    expect(parsed.hostAlias).toBe('dev');
    expect(parsed.repoPath).toBe(repo);
  });

  it('round-trips file query param', () => {
    const hash = buildHash({
      view: 'review',
      hostAlias: 'dev',
      repoPath: '/r',
      filePath: 'src/foo.ts',
    });
    const parsed = parseHash(hash);
    expect(parsed.filePath).toBe('src/foo.ts');
  });

  it('handles aliases with reserved URL chars', () => {
    const hash = buildHash({ view: 'repo-picker', hostAlias: 'has space' });
    expect(parseHash(hash).hostAlias).toBe('has space');
  });

  it('handles unicode in repo path', () => {
    const repo = '/proj/中文/路径';
    const hash = buildHash({ view: 'review', hostAlias: 'h', repoPath: repo });
    expect(parseHash(hash).repoPath).toBe(repo);
  });

  it('falls back to hosts for unknown shapes', () => {
    expect(parseHash('#/garbage').view).toBe('hosts');
  });

  it('round-trips the comments view', () => {
    expect(parseHash('#/comments').view).toBe('comments');
    expect(buildHash({ view: 'comments' })).toBe('#/comments');
  });
});
