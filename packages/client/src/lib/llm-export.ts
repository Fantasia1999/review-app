/**
 * Format annotations as LLM-friendly markdown.
 *
 * The format is structured for an AI agent to read - file paths include
 * line ranges so the agent can locate the original code, quote blocks
 * use language-tagged fences for proper parsing, and the user's
 * markdown body comes after as instructions/observations.
 */

import type { Annotation } from '@shared/types';

export function formatAnnotationsForLLM(
  hostAlias: string,
  repoPath: string,
  annotations: Annotation[],
): string {
  if (annotations.length === 0) return '';

  // Group by file for readability
  const byFile = new Map<string, Annotation[]>();
  for (const a of annotations) {
    const list = byFile.get(a.filePath) ?? [];
    list.push(a);
    byFile.set(a.filePath, list);
  }

  const header = [
    '# Code review notes',
    '',
    `Repository: \`${repoPath}\` (host: \`${hostAlias}\`)`,
    `${annotations.length} annotation${annotations.length === 1 ? '' : 's'} on ${byFile.size} file${byFile.size === 1 ? '' : 's'}.`,
    '',
    '---',
    '',
  ].join('\n');

  const sections: string[] = [];
  for (const [filePath, list] of byFile) {
    // Sort by line within file
    list.sort((a, b) => a.quotedStartLine - b.quotedStartLine);
    for (const a of list) {
      const endLine = a.quotedStartLine + countLines(a.quotedLines) - 1;
      sections.push(formatOne(a, filePath, endLine));
    }
  }

  return header + sections.join('\n\n---\n\n') + '\n';
}

export function formatSingleAnnotationForLLM(a: Annotation): string {
  const endLine = a.quotedStartLine + countLines(a.quotedLines) - 1;
  return formatOne(a, a.filePath, endLine);
}

function formatOne(a: Annotation, filePath: string, endLine: number): string {
  return [
    `## ${filePath}:${a.quotedStartLine}-${endLine}`,
    '',
    '```' + (a.quotedLang || ''),
    a.quotedLines,
    '```',
    '',
    a.body,
  ].join('\n');
}

function countLines(s: string): number {
  if (!s) return 0;
  // 5-line quote blocks always have exactly 5 lines, but be defensive
  return s.split('\n').length;
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for older browsers / non-secure contexts
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}
