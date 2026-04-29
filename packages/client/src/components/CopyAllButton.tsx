/**
 * "Copy all annotations" button.
 *
 * One-click export of every annotation for the current (host, repo) into
 * LLM-friendly markdown, ready to paste into ChatGPT/Claude/Cursor/etc.
 *
 * Use the per-card copy button (in AnnotationCard) for single-annotation copy.
 */

import { useEffect, useState } from 'react';
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

  // The `y` shortcut on ReviewPage dispatches this event. Re-register on
  // every change to the inputs so the closed-over data is fresh.
  useEffect(() => {
    const handler = () => {
      if (annotations.length === 0) return;
      void copyAndFlash();
    };
    window.addEventListener('review-app:copy-all', handler);
    return () => window.removeEventListener('review-app:copy-all', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostAlias, repoPath, annotations]);

  async function copyAndFlash() {
    const md = formatAnnotationsForLLM(hostAlias, repoPath, annotations);
    const ok = await copyToClipboard(md);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }

  if (annotations.length === 0) return null;

  return (
    <button
      className="copy-all-btn"
      onClick={() => copyAndFlash()}
      title="Copy all annotations as markdown for an AI agent"
    >
      {copied ? '✓ Copied' : `📋 Copy all (${annotations.length})`}
    </button>
  );
}
