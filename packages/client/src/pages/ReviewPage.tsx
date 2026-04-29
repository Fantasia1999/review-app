/**
 * Review page - the heart of the app.
 *
 * Layout: left sidebar with file tree, main area with the selected file's
 * diff plus annotations. Top bar has refresh, layout toggle, copy-all.
 *
 * Refresh strategy: manual button + automatic on window focus (TanStack Query
 * default). No polling.
 *
 * Keyboard:
 *   r     - refresh
 *   j/k   - next/prev file
 *   c     - create annotation on currently selected lines (handled in DiffView)
 */

import { useEffect, useMemo, useState } from 'react';
import {
  useChanges,
  useAnnotations,
  useReadMarks,
  useMarkRead,
  usePrefs,
  useUpdatePrefs,
  useClearRepoAnnotations,
  useDisconnectHost,
} from '../api/hooks';
import { navigate } from '../routes';
import { FileTree } from '../components/FileTree';
import { DiffView } from '../components/DiffView';
import { AnnotationSidebar } from '../components/AnnotationSidebar';
import { CopyAllButton } from '../components/CopyAllButton';
import { HelpOverlay } from '../components/HelpOverlay';
import { useToast } from '../components/Toast';
import type { FileChange } from '@shared/types';

export function ReviewPage({
  hostAlias,
  repoPath,
  filePath,
}: {
  hostAlias: string;
  repoPath: string;
  filePath?: string;
}) {
  const changes = useChanges(hostAlias, repoPath);
  const annotations = useAnnotations(hostAlias, repoPath);
  const readMarks = useReadMarks(hostAlias, repoPath);
  const prefs = usePrefs();
  const updatePrefs = useUpdatePrefs();
  const markRead = useMarkRead();
  const clearAll = useClearRepoAnnotations();

  const layout = prefs.data?.prefs.annotationLayout ?? 'inline';
  const disconnect = useDisconnectHost();
  const toast = useToast();
  const [showHelp, setShowHelp] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // Tick once a second to keep "last refreshed Ns ago" current.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Default-select first file if none specified
  const selectedFile = useMemo<FileChange | undefined>(() => {
    if (!changes.data) return undefined;
    if (filePath) {
      return changes.data.files.find((f) => f.path === filePath);
    }
    return changes.data.files[0];
  }, [changes.data, filePath]);

  // Sync URL when first file auto-selected
  useEffect(() => {
    if (changes.data && !filePath && changes.data.files[0]) {
      navigate({
        view: 'review',
        hostAlias,
        repoPath,
        filePath: changes.data.files[0].path,
      });
    }
  }, [changes.data, filePath, hostAlias, repoPath]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ignore when typing in inputs
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return;

      if (e.key === '?') {
        e.preventDefault();
        setShowHelp((s) => !s);
        return;
      }
      if (showHelp) return; // pause other shortcuts while help is up

      if (e.key === 'r') {
        changes.refetch();
      } else if (e.key === 'j' || e.key === 'k') {
        if (!changes.data || !selectedFile) return;
        const idx = changes.data.files.findIndex((f) => f.path === selectedFile.path);
        const next = e.key === 'j' ? idx + 1 : idx - 1;
        const target = changes.data.files[next];
        if (target) {
          navigate({ view: 'review', hostAlias, repoPath, filePath: target.path });
        }
      } else if (e.key === 'c') {
        // Trigger annotation on current file. DiffView listens for this event.
        if (selectedFile) {
          window.dispatchEvent(
            new CustomEvent('review-app:annotate-current', {
              detail: { filePath: selectedFile.path },
            }),
          );
        }
      } else if (e.key === 'y') {
        window.dispatchEvent(new CustomEvent('review-app:copy-all'));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [changes, selectedFile, hostAlias, repoPath, showHelp]);

  if (changes.isLoading) {
    return <div className="page loading">Loading changes…</div>;
  }
  if (changes.error) {
    const err = changes.error as Error & { info?: { message: string; stderr?: string; kind: string } };
    const isSsh = (err.info?.kind ?? '').startsWith('ssh_');
    return (
      <div className="page">
        <header className="page-header">
          <button className="btn-link" onClick={() => navigate({ view: 'repo-picker', hostAlias })}>
            ← Back
          </button>
        </header>
        <div className="error-box">
          <strong>{err.info?.kind ?? 'error'}:</strong> {err.message}
          {err.info?.stderr && <pre className="stderr">{err.info.stderr}</pre>}
          <div className="error-actions">
            <button onClick={() => changes.refetch()}>Retry</button>
            {isSsh && (
              <button
                onClick={async () => {
                  try {
                    await disconnect.mutateAsync(hostAlias);
                    toast.show({ kind: 'info', message: 'Reconnecting…' });
                    changes.refetch();
                  } catch {
                    /* toast handled globally */
                  }
                }}
              >
                Reconnect
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (!changes.data) return null;
  const summary = changes.data;

  return (
    <div className="review-layout">
      <aside className="review-sidebar">
        <header className="review-sidebar-header">
          <button
            className="btn-link"
            onClick={() => navigate({ view: 'repo-picker', hostAlias })}
            title="Back to repo picker"
          >
            ←
          </button>
          <div className="repo-label" title={repoPath}>
            <div className="repo-host">{hostAlias}</div>
            <div className="repo-path">{repoPath}</div>
          </div>
        </header>
        <div className="review-actions">
          <button onClick={() => changes.refetch()} disabled={changes.isFetching}>
            {changes.isFetching ? 'Refreshing…' : 'Refresh (r)'}
          </button>
          <div className="freshness" title="Time since last successful fetch">
            {changes.dataUpdatedAt
              ? `Updated ${formatAgo(now - changes.dataUpdatedAt)}`
              : ''}
          </div>
        </div>
        {summary.files.length === 0 ? (
          <div className="empty-state-small">No changes in working tree</div>
        ) : (
          <FileTree
            files={summary.files}
            selected={selectedFile?.path}
            readMarks={readMarks.data?.marks ?? []}
            mode={prefs.data?.prefs.fileTreeMode ?? 'auto'}
            annotationCounts={countAnnotationsByFile(annotations.data?.annotations ?? [])}
            onSelect={(path) =>
              navigate({ view: 'review', hostAlias, repoPath, filePath: path })
            }
          />
        )}
      </aside>

      <main className="review-main">
        <header className="review-main-header">
          <div className="review-main-title">
            {selectedFile ? selectedFile.path : 'Select a file'}
          </div>
          <div className="review-main-actions">
            <button
              className="btn-link"
              onClick={() => navigate({ view: 'comments' })}
              title="Manage comments across repos"
            >
              Manage comments
            </button>
            <button
              className="btn-link"
              onClick={() => setShowHelp(true)}
              title="Keyboard shortcuts (?)"
            >
              ?
            </button>
            <button
              onClick={() =>
                updatePrefs.mutate({
                  annotationLayout: layout === 'inline' ? 'sidebar' : 'inline',
                })
              }
              title="Toggle annotation layout"
            >
              {layout === 'inline' ? '☰ Sidebar' : '⤺ Inline'}
            </button>
            <CopyAllButton
              hostAlias={hostAlias}
              repoPath={repoPath}
              annotations={annotations.data?.annotations ?? []}
            />
            <button
              onClick={() => {
                const n = annotations.data?.annotations.length ?? 0;
                if (n === 0) return;
                if (
                  confirm(
                    `Clear all ${n} comments for this repo? They'll be archived (recoverable from Manage comments on the home page).`,
                  )
                ) {
                  clearAll.mutate({ hostAlias, repoPath });
                }
              }}
              disabled={
                clearAll.isPending ||
                (annotations.data?.annotations.length ?? 0) === 0
              }
              title="Archive every comment for this repo"
            >
              {clearAll.isPending ? 'Clearing…' : 'Clear all'}
            </button>
          </div>
        </header>

        <div className="review-content">
          {selectedFile ? (
            <DiffView
              hostAlias={hostAlias}
              repoPath={repoPath}
              file={selectedFile}
              annotations={(annotations.data?.annotations ?? []).filter(
                (a) => a.filePath === selectedFile.path,
              )}
              layout={layout}
              onMarkRead={(contentHash) =>
                markRead.mutate({
                  hostAlias,
                  repoPath,
                  filePath: selectedFile.path,
                  contentHash,
                })
              }
            />
          ) : (
            <div className="empty-state">Select a file from the sidebar.</div>
          )}
        </div>

        {layout === 'sidebar' && selectedFile && (
          <AnnotationSidebar
            hostAlias={hostAlias}
            repoPath={repoPath}
            filePath={selectedFile.path}
            annotations={(annotations.data?.annotations ?? []).filter(
              (a) => a.filePath === selectedFile.path,
            )}
          />
        )}
      </main>
      {showHelp && <HelpOverlay onClose={() => setShowHelp(false)} />}
    </div>
  );
}

function formatAgo(ms: number): string {
  if (ms < 0 || !Number.isFinite(ms)) return 'just now';
  const s = Math.round(ms / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return `${h}h ago`;
}

function countAnnotationsByFile(
  annotations: { filePath: string }[],
): Map<string, number> {
  const map = new Map<string, number>();
  for (const a of annotations) {
    map.set(a.filePath, (map.get(a.filePath) ?? 0) + 1);
  }
  return map;
}
