/**
 * AnnotationCard: displays a single annotation - quote block + markdown body
 * plus actions (edit, delete, copy as LLM markdown).
 *
 * Used in both inline mode (under the diff) and sidebar mode.
 */

import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import {
  useDeleteAnnotation,
  useUpdateAnnotation,
} from '../api/hooks';
import {
  copyToClipboard,
  formatSingleAnnotationForLLM,
} from '../lib/llm-export';
import type { Annotation } from '@shared/types';

export function AnnotationCard({
  annotation,
  compact = false,
}: {
  annotation: Annotation;
  compact?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(annotation.body);
  const [copied, setCopied] = useState(false);
  const update = useUpdateAnnotation();
  const del = useDeleteAnnotation();

  const a = annotation;
  const endLine = a.quotedStartLine + 4;

  const onCopy = async () => {
    const ok = await copyToClipboard(formatSingleAnnotationForLLM(a));
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  const onSave = async () => {
    if (draft.trim() === a.body) {
      setEditing(false);
      return;
    }
    await update.mutateAsync({ id: a.id, body: draft });
    setEditing(false);
  };

  const onDelete = () => {
    if (confirm('Delete this annotation?')) {
      del.mutate(a.id);
    }
  };

  return (
    <article className={`annotation-card ${compact ? 'compact' : ''}`}>
      <header className="ann-header">
        <span className="ann-loc">
          {a.filePath}:{a.quotedStartLine}-{endLine}
          <span className={`side-tag side-${a.side}`}>{a.side}</span>
        </span>
        <span className="ann-time">
          {new Date(a.createdAt).toLocaleString()}
        </span>
        <div className="ann-actions">
          <button
            onClick={onCopy}
            title="Copy this annotation (LLM format)"
          >
            {copied ? '✓' : '📋'}
          </button>
          {!editing && (
            <button onClick={() => setEditing(true)} title="Edit">
              ✎
            </button>
          )}
          <button onClick={onDelete} title="Delete" className="btn-danger-icon">
            ×
          </button>
        </div>
      </header>

      <pre className={`quote-block lang-${a.quotedLang}`}>
        <code>{a.quotedLines}</code>
      </pre>

      {editing ? (
        <div className="ann-edit">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={4}
            autoFocus
          />
          <div className="ann-edit-actions">
            <button
              onClick={() => {
                setDraft(a.body);
                setEditing(false);
              }}
            >
              Cancel
            </button>
            <button
              className="btn-primary"
              onClick={onSave}
              disabled={update.isPending}
            >
              Save
            </button>
          </div>
        </div>
      ) : (
        <div className="ann-body">
          <ReactMarkdown>{a.body}</ReactMarkdown>
        </div>
      )}
    </article>
  );
}
