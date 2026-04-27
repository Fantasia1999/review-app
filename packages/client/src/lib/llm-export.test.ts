import { describe, expect, it } from 'bun:test';
import { formatAnnotationsForLLM, formatSingleAnnotationForLLM } from './llm-export';
import type { Annotation } from '@shared/types';

const ann = (over: Partial<Annotation> = {}): Annotation => ({
  id: 'id',
  hostAlias: 'h',
  repoPath: '/r',
  filePath: 'a.ts',
  side: 'new',
  quotedStartLine: 10,
  quotedLines: 'l1\nl2\nl3\nl4\nl5',
  quotedLang: 'ts',
  body: 'comment',
  createdAt: 0,
  ...over,
});

describe('formatAnnotationsForLLM', () => {
  it('returns empty string for no annotations', () => {
    expect(formatAnnotationsForLLM('h', '/r', [])).toBe('');
  });

  it('includes host, repo and counts in the header', () => {
    const out = formatAnnotationsForLLM('myhost', '/proj', [ann()]);
    expect(out).toContain('Code review notes');
    expect(out).toContain('`/proj`');
    expect(out).toContain('`myhost`');
    expect(out).toContain('1 annotation');
    expect(out).toContain('1 file');
  });

  it('uses plural forms', () => {
    const out = formatAnnotationsForLLM('h', '/r', [
      ann({ id: '1', filePath: 'a.ts' }),
      ann({ id: '2', filePath: 'b.ts' }),
    ]);
    expect(out).toContain('2 annotations');
    expect(out).toContain('2 files');
  });

  it('emits language-tagged code fence with line range', () => {
    const out = formatSingleAnnotationForLLM(ann({ quotedStartLine: 7 }));
    expect(out).toContain('## a.ts:7-11');
    expect(out).toMatch(/```ts\nl1\nl2\nl3\nl4\nl5\n```/);
    expect(out).toContain('comment');
  });

  it('groups by file and sorts by start line within a file', () => {
    const out = formatAnnotationsForLLM('h', '/r', [
      ann({ id: '1', filePath: 'a.ts', quotedStartLine: 50, body: 'second' }),
      ann({ id: '2', filePath: 'a.ts', quotedStartLine: 5, body: 'first' }),
    ]);
    expect(out.indexOf('first')).toBeLessThan(out.indexOf('second'));
  });

  it('handles annotations missing language', () => {
    const out = formatSingleAnnotationForLLM(ann({ quotedLang: '' }));
    expect(out).toContain('```\nl1');
  });
});
