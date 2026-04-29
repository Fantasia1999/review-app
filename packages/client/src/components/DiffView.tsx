/**
 * DiffView: renders a single file's diff using @pierre/diffs.
 *
 * Click any line in the diff to start an annotation on a 5-line quote
 * block centered on that line. The library's onLineClick is wired via
 * the `options` prop (see @pierre/diffs InteractionManagerBaseOptions).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
}

interface HoveredDiffLine {
  lineNumber: number;
  side: 'additions' | 'deletions';
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
  // can resolve the quote block on either side of the diff.
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

  const lang = useMemo(() => detectLang(file.path), [file.path]);
  const contentHash = diff.data?.contentHash;

  // Auto-mark read when scrolled to bottom of this file's diff
  useEffect(() => {
    if (!contentHash) return;
    const el = containerRef.current;
    if (!el) return;
    const handler = () => {
      const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 50;
      if (atBottom) onMarkRead(contentHash);
    };
    el.addEventListener('scroll', handler);
    return () => el.removeEventListener('scroll', handler);
  }, [contentHash, onMarkRead]);

  const startAnnotation = useCallback((side: 'old' | 'new', clickedLine: number) => {
    setNeedContent({ side });
    const startLine = Math.max(1, clickedLine - 2);
    setPending({ side, startLine });
  }, []);

  // PatchDiff options must be referentially stable across renders so the
  // library doesn't tear down the InteractionManager.
  const options = useMemo(
    () => ({
      overflow: 'wrap' as const,
      enableGutterUtility: true,
      onLineClick: (props: {
        annotationSide: 'deletions' | 'additions';
        lineNumber: number;
      }) => {
        const side: 'old' | 'new' =
          props.annotationSide === 'additions' ? 'new' : 'old';
        startAnnotation(side, props.lineNumber);
      },
    }),
    [startAnnotation],
  );

  const renderGutterUtility = useCallback(
    (getHoveredLine: () => HoveredDiffLine | undefined) => {
      const hovered = getHoveredLine();
      if (!hovered) return null;
      return (
        <button
          type="button"
          className="diff-add-annotation-btn"
          title={`Add annotation at line ${hovered.lineNumber}`}
          aria-label={`Add annotation at line ${hovered.lineNumber}`}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            startAnnotation(
              hovered.side === 'additions' ? 'new' : 'old',
              hovered.lineNumber,
            );
          }}
        >
          +
        </button>
      );
    },
    [startAnnotation],
  );

  // Bail out of the editor if file-content fetch fails — the global toast
  // already surfaced the error; without this the loading overlay would
  // be stuck forever.
  useEffect(() => {
    if (!pending) return;
    const fetcher = pending.side === 'new' ? newContent : oldContent;
    if (fetcher.error) {
      setPending(null);
      setNeedContent(null);
    }
  }, [pending, newContent.error, oldContent.error]);

  // The `c` shortcut on ReviewPage dispatches this to open the editor on the
  // first changed line of the current file (defaulting to the new side).
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ filePath: string }>).detail;
      if (detail?.filePath !== file.path) return;
      // Pick the first hunk's starting line if we have a parsed patch; fall
      // back to line 1 otherwise. We don't parse the patch here, so 1 is fine.
      const side: 'old' | 'new' = file.status === 'deleted' ? 'old' : 'new';
      startAnnotation(side, 1);
    };
    window.addEventListener('review-app:annotate-current', handler);
    return () => window.removeEventListener('review-app:annotate-current', handler);
  }, [file.path, file.status]);

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

  if (fd.collapsedByDefault && !expanded) {
    return (
      <div className="collapsed-diff">
        <p>This file is large or is a lockfile. Click to expand.</p>
        <button onClick={() => setExpanded(true)}>Show diff</button>
        <button className="btn-link" onClick={() => onMarkRead(fd.contentHash)}>
          Mark as read without viewing
        </button>
      </div>
    );
  }

  if (fd.binary) {
    return (
      <div className="binary-notice">
        Binary file — diff not shown.
        <button className="btn-link" onClick={() => onMarkRead(fd.contentHash)}>
          Mark as read
        </button>
      </div>
    );
  }

  if (fd.status === 'submodule') {
    return (
      <div className="submodule-notice">
        Submodule changes — collapsed.
        <button className="btn-link" onClick={() => onMarkRead(fd.contentHash)}>
          Mark as read
        </button>
      </div>
    );
  }

  if (fd.status === 'untracked' && fd.newContent !== undefined) {
    return (
      <div ref={containerRef} className="diff-scroll-container">
        <UntrackedFileView path={file.path} content={fd.newContent} />
      </div>
    );
  }

  return (
    <>
      <div ref={containerRef} className="diff-scroll-container">
        <PatchDiff
          patch={fd.patch}
          options={options as never}
          renderHeaderPrefix={() => file.path}
          renderGutterUtility={renderGutterUtility}
        />

        {layout === 'inline' && annotations.length > 0 && (
          <div className="inline-annotations">
            {annotations
              .slice()
              .sort((a, b) => a.quotedStartLine - b.quotedStartLine)
              .map((a) => (
                <AnnotationCard key={a.id} annotation={a} />
              ))}
          </div>
        )}
      </div>

      {pending && (() => {
        const fetcher = pending.side === 'new' ? newContent : oldContent;
        if (fetcher.error) return null; // effect above will clear pending
        const src = fetcher.data?.content;
        if (src === undefined) {
          return <div className="loading-overlay">Loading file…</div>;
        }
        const sourceLines = src.split('\n');
        return (
          <AnnotationEditor
            hostAlias={hostAlias}
            repoPath={repoPath}
            filePath={file.path}
            side={pending.side}
            initialStartLine={pending.startLine}
            sourceLines={sourceLines}
            quotedLang={lang}
            onClose={() => {
              setPending(null);
              setNeedContent(null);
            }}
          />
        );
      })()}
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
