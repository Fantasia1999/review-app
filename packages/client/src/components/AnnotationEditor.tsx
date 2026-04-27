/**
 * Annotation editor.
 *
 * Shows a read-only 5-line quote block at the top (already resolved by the
 * caller from file content), then a textarea for the markdown body. On save
 * creates the annotation via /api/annotations.
 *
 * The quote block is immutable after creation in v1 - if you want to change
 * what code an annotation refers to, delete and recreate.
 */

import { useState } from 'react';
import { useCreateAnnotation } from '../api/hooks';

interface Props {
  hostAlias: string;
  repoPath: string;
  filePath: string;
  side: 'old' | 'new';
  quotedStartLine: number;
  quotedLines: string;
  quotedLang: string;
  onClose: () => void;
}

export function AnnotationEditor({
  hostAlias,
  repoPath,
  filePath,
  side,
  quotedStartLine,
  quotedLines,
  quotedLang,
  onClose,
}: Props) {
  const [body, setBody] = useState('');
  const create = useCreateAnnotation();

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!body.trim()) return;
    await create.mutateAsync({
      hostAlias,
      repoPath,
      filePath,
      side,
      quotedStartLine,
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

  const endLine = quotedStartLine + 4; // always 5 lines

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
            {filePath}:{quotedStartLine}-{endLine} ({side})
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
