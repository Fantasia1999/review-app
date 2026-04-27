/**
 * "Copy all annotations" button.
 *
 * One-click export of every annotation for the current (host, repo) into
 * LLM-friendly markdown, ready to paste into ChatGPT/Claude/Cursor/etc.
 *
 * Use the per-card copy button (in AnnotationCard) for single-annotation copy.
 */

import { useState } from 'react';
import {
  copyToClipboard,
  formatAnnotationsForLLM,
} from '../lib/llm-export';
import type { Annotation } from '@shared/types';

export function CopyAllButton({
  hostAlias,
  repoPath,
  annotations,
}: {
  hostAlias: string;
  repoPath: string;
  annotations: Annotation[];
}) {
  const [copied, setCopied] = useState(false);

  if (annotations.length === 0) return null;

  const onClick = async () => {
    const md = formatAnnotationsForLLM(hostAlias, repoPath, annotations);
    const ok = await copyToClipboard(md);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <button
      className="copy-all-btn"
      onClick={onClick}
      title="Copy all annotations as markdown for an AI agent"
    >
      {copied ? '✓ Copied' : `📋 Copy all (${annotations.length})`}
    </button>
  );
}
