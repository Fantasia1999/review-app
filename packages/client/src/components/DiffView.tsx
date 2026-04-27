/**
 * DiffView: renders a single file's diff using @pierre/diffs.
 *
 * NOTE for AI agents implementing this: the @pierre/diffs API surface used
 * here (PatchDiff, parsePatchFiles, lineAnnotations prop) is documented at
 * https://diffs.com/docs. The exact prop names may need adjustment when
 * actually testing - this is a faithful sketch, not verified against the
 * library's runtime. See DESIGN.md "Open implementation questions".
 *
 * Responsibilities:
 *   - Fetch the per-file FileDiff from /api/diff/:alias/file
 *   - Render via @pierre/diffs's React component
 *   - On line click / selection, open the annotation editor with a 5-line
 *     quote block centered on the selection
 *   - Show annotations inline (when layout=inline) as line annotations
 *   - Mark file as read when user has scrolled to bottom (or on demand)
 */

import { useEffect, useRef, useState } from 'react';
import { PatchDiff } from '@pierre/diffs/react';
import type { Annotation, FileChange } from '@shared/types';
import { useFileDiff, useFileContent } from '../api/hooks';
import { AnnotationEditor } from './AnnotationEditor';
import { AnnotationCard } from './AnnotationCard';
import { detectLang } from '../lib/lang';

interface Props {
  hostAlias: string;
  repoPath: string;
  file: FileChange;
  annotations: Annotation[];
  layout: 'inline' | 'sidebar';
  onMarkRead: (contentHash: string) => void;
}

interface PendingAnnotation {
  side: 'old' | 'new';
  startLine: number;
  quotedLines: string;
  quotedLang: string;
}

export function DiffView({
  hostAlias,
  repoPath,
  file,
  annotations,
  layout,
  onMarkRead,
}: Props) {
  const diff = useFileDiff(hostAlias, repoPath, file.path, file.status);
  const [expanded, setExpanded] = useState(false);
  const [pending, setPending] = useState<PendingAnnotation | null>(null);
  // Lazily fetch file contents only when user starts an annotation, so we
  // can resolve a 5-line quote block on either side of the diff.
  const [needContent, setNeedContent] = useState<{ side: 'old' | 'new' } | null>(null);
  const newContent = useFileContent(
    hostAlias,
    repoPath,
    file.path,
    'new',
    needContent?.side === 'new',
  );
  const oldContent = useFileContent(
    hostAlias,
    repoPath,
    file.path,
    'old',
    needContent?.side === 'old',
  );
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-mark read when scrolled to bottom of this file's diff
  useEffect(() => {
    if (!diff.data) return;
    const el = containerRef.current;
    if (!el) return;
    const handler = () => {
      const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 50;
      if (atBottom) onMarkRead(diff.data!.contentHash);
    };
    el.addEventListener('scroll', handler);
    return () => el.removeEventListener('scroll', handler);
  }, [diff.data, onMarkRead]);

  if (diff.isLoading) return <div className="loading">Loading diff…</div>;
  if (diff.error) {
    const e = diff.error as Error & { info?: { message: string; stderr?: string; kind: string } };
    return (
      <div className="error-box">
        <strong>{e.info?.kind ?? 'error'}:</strong> {e.message}
        {e.info?.stderr && <pre className="stderr">{e.info.stderr}</pre>}
      </div>
    );
  }
  if (!diff.data) return null;
  const fd = diff.data;

  // Collapsed by default (large file or lockfile)?
  if (fd.collapsedByDefault && !expanded) {
    return (
      <div className="collapsed-diff">
        <p>
          This file is large or is a lockfile. Click to expand.
        </p>
        <button onClick={() => setExpanded(true)}>Show diff</button>
        <button
          className="btn-link"
          onClick={() => onMarkRead(fd.contentHash)}
        >
          Mark as read without viewing
        </button>
      </div>
    );
  }

  if (fd.binary) {
    return (
      <div className="binary-notice">
        Binary file — diff not shown.
        <button
          className="btn-link"
          onClick={() => onMarkRead(fd.contentHash)}
        >
          Mark as read
        </button>
      </div>
    );
  }

  if (fd.status === 'submodule') {
    return (
      <div className="submodule-notice">
        Submodule changes — collapsed.
        <button
          className="btn-link"
          onClick={() => onMarkRead(fd.contentHash)}
        >
          Mark as read
        </button>
      </div>
    );
  }

  if (fd.status === 'untracked' && fd.newContent !== undefined) {
    // Render as added file - show full content
    return (
      <div ref={containerRef} className="diff-scroll-container">
        <UntrackedFileView
          path={file.path}
          content={fd.newContent}
        />
      </div>
    );
  }

  // Tracked file diff. @pierre/diffs accepts a unified-patch string.
  // The exact prop name may differ (consult diffs.com docs); see DESIGN.md.
  const lang = detectLang(file.path);

  const startAnnotation = (side: 'old' | 'new', clickedLine: number) => {
    setNeedContent({ side });
    // Wait for content (TanStack Query will populate on next render); we
    // build the quote block here optimistically using a simple state machine:
    // open editor immediately, fill quote when content arrives.
    const startLine = Math.max(1, clickedLine - 2);
    setPending({
      side,
      startLine,
      quotedLines: '', // populated when content available
      quotedLang: lang,
    });
  };

  // Populate quote when content arrives
  useEffect(() => {
    if (!pending || pending.quotedLines) return;
    const src =
      pending.side === 'new' ? newContent.data?.content : oldContent.data?.content;
    if (!src) return;
    const lines = src.split('\n');
    const start = pending.startLine;
    const slice = lines.slice(start - 1, start - 1 + 5);
    // Pad to 5 lines if file is shorter
    while (slice.length < 5) slice.push('');
    setPending({ ...pending, quotedLines: slice.join('\n') });
  }, [pending, newContent.data, oldContent.data]);

  return (
    <>
      <div ref={containerRef} className="diff-scroll-container">
        {/*
          @pierre/diffs PatchDiff component. Prop names are based on the
          public docs; verify when wiring up. The library also has
          MultiFileDiff but we render one file at a time.
        */}
        <PatchDiff
          patch={fd.patch}
          fileName={file.path}
          // line click handler - shape may need adjusting; consult docs
          onLineClick={(info: { side: 'old' | 'new'; line: number }) =>
            startAnnotation(info.side, info.line)
          }
        />

        {layout === 'inline' && annotations.length > 0 && (
          <div className="inline-annotations">
            {annotations
              .sort((a, b) => a.quotedStartLine - b.quotedStartLine)
              .map((a) => (
                <AnnotationCard key={a.id} annotation={a} />
              ))}
          </div>
        )}
      </div>

      {pending && pending.quotedLines && (
        <AnnotationEditor
          hostAlias={hostAlias}
          repoPath={repoPath}
          filePath={file.path}
          side={pending.side}
          quotedStartLine={pending.startLine}
          quotedLines={pending.quotedLines}
          quotedLang={pending.quotedLang}
          onClose={() => {
            setPending(null);
            setNeedContent(null);
          }}
        />
      )}
    </>
  );
}

function UntrackedFileView({ path, content }: { path: string; content: string }) {
  const lang = detectLang(path);
  return (
    <pre className={`untracked-file lang-${lang}`}>
      <code>{content}</code>
    </pre>
  );
}
