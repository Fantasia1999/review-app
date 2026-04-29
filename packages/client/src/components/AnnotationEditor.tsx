/**
 * Annotation editor.
 *
 * Shows a quote block at the top (sliced from `sourceLines` at runtime so the
 * user can grow/shrink the quote with the ± buttons before saving) and a
 * textarea for the markdown body. On save creates the annotation via
 * /api/annotations.
 *
 * The chosen quote range is captured at save time. After saving, annotations
 * are immutable - delete and recreate to change what code is referenced.
 */

import { useMemo, useState } from 'react';
import { useCreateAnnotation } from '../api/hooks';

const MIN_LINES = 1;
const MAX_LINES = 20;
const DEFAULT_LINES = 5;

interface Props {
  hostAlias: string;
  repoPath: string;
  filePath: string;
  side: 'old' | 'new';
  /** Initial start line (1-based) — user can shift it with the ± buttons. */
  initialStartLine: number;
  /** Full source as an array of lines (no trailing newline split). */
  sourceLines: string[];
  quotedLang: string;
  onClose: () => void;
}

export function AnnotationEditor({
  hostAlias,
  repoPath,
  filePath,
  side,
  initialStartLine,
  sourceLines,
  quotedLang,
  onClose,
}: Props) {
  const [body, setBody] = useState('');
  const [startLine, setStartLine] = useState(() =>
    Math.max(1, Math.min(initialStartLine, sourceLines.length || 1)),
  );
  const [lineCount, setLineCount] = useState(() =>
    Math.min(DEFAULT_LINES, Math.max(MIN_LINES, sourceLines.length || 1)),
  );
  const create = useCreateAnnotation();

  const quotedLines = useMemo(() => {
    const slice = sourceLines.slice(startLine - 1, startLine - 1 + lineCount);
    while (slice.length < lineCount) slice.push('');
    return slice.join('\n');
  }, [sourceLines, startLine, lineCount]);

  const endLine = startLine + lineCount - 1;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!body.trim()) return;
    await create.mutateAsync({
      hostAlias,
      repoPath,
      filePath,
      side,
      quotedStartLine: startLine,
      quotedLines,
      quotedLang,
      body,
    });
    onClose();
  };

  // Cmd/Ctrl+Enter to submit
  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      onSubmit(e as unknown as React.FormEvent);
    }
    if (e.key === 'Escape') onClose();
  };

  const adjustStart = (delta: number) => {
    setStartLine((s) =>
      Math.max(
        1,
        Math.min((sourceLines.length || 1) - lineCount + 1, s + delta),
      ),
    );
  };
  const adjustCount = (delta: number) => {
    setLineCount((c) => {
      const next = Math.max(MIN_LINES, Math.min(MAX_LINES, c + delta));
      // Keep the slice within source bounds.
      const maxStart = Math.max(1, (sourceLines.length || 1) - next + 1);
      if (startLine > maxStart) setStartLine(maxStart);
      return next;
    });
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal modal-wide"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <header className="modal-header">
          <h2>New annotation</h2>
          <button className="btn-close" onClick={onClose}>×</button>
        </header>
        <div className="annotation-editor">
          <div className="quote-block-label">
            <span>
              {filePath}:{startLine}-{endLine} ({side})
            </span>
            <div className="quote-range-controls" role="group" aria-label="Adjust quote range">
              <span className="hint">Start</span>
              <button type="button" onClick={() => adjustStart(-1)} title="Move start up">−</button>
              <button type="button" onClick={() => adjustStart(1)} title="Move start down">+</button>
              <span className="hint">Lines {lineCount}</span>
              <button
                type="button"
                onClick={() => adjustCount(-1)}
                disabled={lineCount <= MIN_LINES}
                title="Fewer lines"
              >
                −
              </button>
              <button
                type="button"
                onClick={() => adjustCount(1)}
                disabled={lineCount >= MAX_LINES}
                title="More lines"
              >
                +
              </button>
            </div>
          </div>
          <pre className={`quote-block lang-${quotedLang}`}>
            <code>{quotedLines}</code>
          </pre>
          <form onSubmit={onSubmit}>
            <label>
              Note <span className="hint">(markdown supported)</span>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={6}
                autoFocus
                placeholder="Write your note. ⌘/Ctrl+Enter to save."
              />
            </label>
            <div className="modal-actions">
              <button type="button" onClick={onClose}>
                Cancel
              </button>
              <button
                type="submit"
                className="btn-primary"
                disabled={!body.trim() || create.isPending}
              >
                {create.isPending ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
