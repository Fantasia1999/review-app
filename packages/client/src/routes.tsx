/**
 * Tiny router. Parses location.hash into { view, params } and renders the
 * right page component.
 *
 * Why hash routing? Bun-served SPA without server-side fallback needs hash
 * routing to make refresh/back/forward work. URLs look like:
 *   #/                              -> hosts list
 *   #/h/dev-box                      -> repo picker for dev-box
 *   #/h/dev-box/r/{base64-of-path}   -> review screen
 *   #/h/dev-box/r/{base64}?file=...  -> with selected file
 *
 * Repo path is base64'd to avoid escaping headaches with slashes.
 *
 * If you outgrow this, swap in @tanstack/react-router (already a dep) -
 * but keep the URL shape stable.
 */

import { useEffect, useState } from 'react';
import { HostsPage } from './pages/HostsPage';
import { RepoPickerPage } from './pages/RepoPickerPage';
import { ReviewPage } from './pages/ReviewPage';
import { CommentsPage } from './pages/CommentsPage';

export interface RouteState {
  view: 'hosts' | 'repo-picker' | 'review' | 'comments';
  hostAlias?: string;
  repoPath?: string;
  filePath?: string;
}

export function parseHash(hash: string): RouteState {
  // Strip leading '#'
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const [path, search] = raw.split('?');
  const params = new URLSearchParams(search ?? '');
  const filePath = params.get('file') ?? undefined;
  const segs = path.split('/').filter(Boolean);

  if (segs.length === 0) {
    return { view: 'hosts' };
  }
  if (segs[0] === 'comments') {
    return { view: 'comments' };
  }
  if (segs[0] === 'h' && segs.length === 2) {
    return { view: 'repo-picker', hostAlias: decodeURIComponent(segs[1]) };
  }
  if (segs[0] === 'h' && segs[2] === 'r' && segs.length >= 4) {
    return {
      view: 'review',
      hostAlias: decodeURIComponent(segs[1]),
      repoPath: decodeBase64(segs[3]),
      filePath,
    };
  }
  return { view: 'hosts' };
}

export function buildHash(state: RouteState): string {
  switch (state.view) {
    case 'hosts':
      return '#/';
    case 'comments':
      return '#/comments';
    case 'repo-picker':
      return `#/h/${encodeURIComponent(state.hostAlias!)}`;
    case 'review': {
      const base = `#/h/${encodeURIComponent(state.hostAlias!)}/r/${encodeBase64(state.repoPath!)}`;
      return state.filePath
        ? `${base}?file=${encodeURIComponent(state.filePath)}`
        : base;
    }
  }
}

export function navigate(state: RouteState): void {
  window.location.hash = buildHash(state);
}

export function Routes() {
  const [route, setRoute] = useState<RouteState>(() =>
    parseHash(window.location.hash),
  );

  useEffect(() => {
    const onHashChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  switch (route.view) {
    case 'hosts':
      return <HostsPage />;
    case 'comments':
      return <CommentsPage />;
    case 'repo-picker':
      return <RepoPickerPage hostAlias={route.hostAlias!} />;
    case 'review':
      return (
        <ReviewPage
          hostAlias={route.hostAlias!}
          repoPath={route.repoPath!}
          filePath={route.filePath}
        />
      );
  }
}

function encodeBase64(s: string): string {
  return btoa(unescape(encodeURIComponent(s))).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function decodeBase64(s: string): string {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  return decodeURIComponent(escape(atob(padded)));
}
