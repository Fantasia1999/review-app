/**
 * AnnotationCard: displays a single annotation - quote block + markdown body
 * plus actions (edit, delete, copy as LLM markdown).
 *
 * Used in both inline mode (under the diff) and sidebar mode.
 */

import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import {
  useArchiveAnnotation,
  useDeleteAnnotation,
  useUpdateAnnotation,
} from '../api/hooks';
import {
  copyToClipboard,
  formatSingleAnnotationForLLM,
} from '../lib/llm-export';
import type { Annotation } from '@shared/types';

/**
 * Per-annotation actions.
 *
 * The default "delete" affordance is a soft-clear (archive). This is what the
 * review flow wants — once a comment has been addressed, you want it out of
 * the way without losing history.
 *
 * Hard delete is intentionally only reachable from the Comments management
 * page (via mode="manage"). Same with restore.
 */
export function AnnotationCard({
  annotation,
  compact = false,
  mode = 'review',
}: {
  annotation: Annotation;
  compact?: boolean;
  /** "review" = soft archive on ×; "manage" = restore + hard-delete buttons. */
  mode?: 'review' | 'manage';
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(annotation.body);
  const [copied, setCopied] = useState(false);
  const update = useUpdateAnnotation();
  const archive = useArchiveAnnotation();
  const del = useDeleteAnnotation();

  const a = annotation;
  const endLine = a.quotedStartLine + 4;
  const isArchived = !!a.archivedAt;

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

  const onClear = () => {
    if (confirm('Clear this comment? It can be restored from Manage comments.')) {
      archive.mutate({ id: a.id, archived: true });
    }
  };

  const onRestore = () => {
    archive.mutate({ id: a.id, archived: false });
  };

  const onHardDelete = () => {
    if (confirm('Permanently delete this comment? This cannot be undone.')) {
      del.mutate(a.id);
    }
  };

  return (
    <article
      className={`annotation-card ${compact ? 'compact' : ''} ${isArchived ? 'archived' : ''}`}
    >
      <header className="ann-header">
        <span className="ann-loc">
          {a.filePath}:{a.quotedStartLine}-{endLine}
          <span className={`side-tag side-${a.side}`}>{a.side}</span>
          {isArchived && <span className="side-tag archived-tag">cleared</span>}
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
          {!editing && !isArchived && (
            <button onClick={() => setEditing(true)} title="Edit">
              ✎
            </button>
          )}
          {mode === 'manage' && isArchived && (
            <button onClick={onRestore} title="Restore">
              ↺
            </button>
          )}
          {mode === 'manage' ? (
            <button
              onClick={onHardDelete}
              title="Delete permanently"
              className="btn-danger-icon"
            >
              ×
            </button>
          ) : (
            !isArchived && (
              <button
                onClick={onClear}
                title="Clear (mark as resolved)"
                className="btn-danger-icon"
              >
                ×
              </button>
            )
          )}
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
