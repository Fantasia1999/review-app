/**
 * React Query hooks - one per endpoint.
 *
 * Stale times are intentionally generous (30s+) since git status is the
 * "expensive" call and the user can hit refresh manually anyway.
 */

import {
  useQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { api, apiPost, apiPut, apiPatch, apiDelete } from './client';
import type {
  HostConfig,
  DiffSummary,
  FileDiff,
  Annotation,
  CreateAnnotationInput,
  ReadMark,
  AppConfig,
  FileStatus,
  RemoteError,
} from '@shared/types';
import type { DiscoveredKey } from '../lib/types';

// ---------- hosts ----------

export function useHosts() {
  return useQuery({
    queryKey: ['hosts'],
    queryFn: () =>
      api<{ hosts: HostConfig[]; passphraseLoaded: string[] }>('/api/hosts'),
    staleTime: 60_000,
  });
}

export function useLocalKeys() {
  return useQuery({
    queryKey: ['hosts', 'keys'],
    queryFn: () => api<{ keys: DiscoveredKey[] }>('/api/hosts/keys'),
    staleTime: 5 * 60_000,
  });
}

export function useAddHost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (host: Partial<HostConfig>) =>
      apiPost<{ host: HostConfig }>('/api/hosts', host),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hosts'] }),
  });
}

export function useDeleteHost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (alias: string) =>
      apiDelete<{ ok: true }>(`/api/hosts/${encodeURIComponent(alias)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hosts'] }),
  });
}

export function useSubmitPassphrase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ alias, passphrase }: { alias: string; passphrase: string }) =>
      apiPost<{ ok: true }>(
        `/api/hosts/${encodeURIComponent(alias)}/passphrase`,
        { passphrase },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hosts'] });
      qc.invalidateQueries({ queryKey: ['changes'] });
    },
  });
}

export function useTestHost() {
  return useMutation({
    mutationFn: (alias: string) =>
      apiPost<{
        ok: boolean;
        gitVersion?: string;
        error?: RemoteError;
      }>(`/api/hosts/${encodeURIComponent(alias)}/test`, {}),
  });
}

// ---------- repos ----------

export function useRecentRepos(alias: string | undefined) {
  return useQuery({
    queryKey: ['repos', alias, 'recent'],
    queryFn: () =>
      api<{ recent: { path: string; lastOpenedAt: number }[] }>(
        `/api/repos/${encodeURIComponent(alias!)}/recent`,
      ),
    enabled: !!alias,
  });
}

export function useValidateRepo() {
  return useMutation({
    mutationFn: ({ alias, path }: { alias: string; path: string }) =>
      apiPost<{ ok: boolean; error?: RemoteError }>(
        `/api/repos/${encodeURIComponent(alias)}/validate`,
        { path },
      ),
  });
}

export function useTouchRepo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ alias, path }: { alias: string; path: string }) =>
      apiPost<{ ok: true }>(
        `/api/repos/${encodeURIComponent(alias)}/touch`,
        { path },
      ),
    onSuccess: (_, vars) =>
      qc.invalidateQueries({ queryKey: ['repos', vars.alias, 'recent'] }),
  });
}

// ---------- diff ----------

export function useChanges(alias: string | undefined, repo: string | undefined) {
  return useQuery({
    queryKey: ['changes', alias, repo],
    queryFn: () =>
      api<DiffSummary>(
        `/api/diff/${encodeURIComponent(alias!)}/changes?repo=${encodeURIComponent(repo!)}`,
      ),
    enabled: !!alias && !!repo,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}

export function useFileDiff(
  alias: string | undefined,
  repo: string | undefined,
  path: string | undefined,
  status: FileStatus | undefined,
) {
  return useQuery({
    queryKey: ['file-diff', alias, repo, path, status],
    queryFn: () =>
      api<FileDiff>(
        `/api/diff/${encodeURIComponent(alias!)}/file?repo=${encodeURIComponent(repo!)}&path=${encodeURIComponent(path!)}&status=${status}`,
      ),
    enabled: !!alias && !!repo && !!path && !!status,
    staleTime: 30_000,
  });
}

export function useFileContent(
  alias: string | undefined,
  repo: string | undefined,
  path: string | undefined,
  side: 'old' | 'new',
  enabled: boolean,
) {
  return useQuery({
    queryKey: ['file-content', alias, repo, path, side],
    queryFn: () =>
      api<{ content: string }>(
        `/api/diff/${encodeURIComponent(alias!)}/content?repo=${encodeURIComponent(repo!)}&path=${encodeURIComponent(path!)}&side=${side}`,
      ),
    enabled: enabled && !!alias && !!repo && !!path,
  });
}

// ---------- annotations ----------

export function useAnnotations(
  hostAlias: string | undefined,
  repoPath: string | undefined,
  filePath?: string,
) {
  return useQuery({
    queryKey: ['annotations', hostAlias, repoPath, filePath],
    queryFn: () => {
      const params = new URLSearchParams({
        host: hostAlias!,
        repo: repoPath!,
      });
      if (filePath) params.set('file', filePath);
      return api<{ annotations: Annotation[] }>(`/api/annotations?${params}`);
    },
    enabled: !!hostAlias && !!repoPath,
  });
}

export function useCreateAnnotation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateAnnotationInput) =>
      apiPost<{ annotation: Annotation }>('/api/annotations', input),
    onSuccess: (_, input) =>
      qc.invalidateQueries({
        queryKey: ['annotations', input.hostAlias, input.repoPath],
      }),
  });
}

export function useUpdateAnnotation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) =>
      apiPatch<{ ok: true }>(`/api/annotations/${id}`, { body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['annotations'] }),
  });
}

export function useDeleteAnnotation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiDelete<{ ok: true }>(`/api/annotations/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['annotations'] }),
  });
}

// ---------- read marks ----------

export function useReadMarks(host: string | undefined, repo: string | undefined) {
  return useQuery({
    queryKey: ['read-marks', host, repo],
    queryFn: () =>
      api<{ marks: ReadMark[] }>(
        `/api/read-marks?host=${encodeURIComponent(host!)}&repo=${encodeURIComponent(repo!)}`,
      ),
    enabled: !!host && !!repo,
  });
}

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (mark: ReadMark) => apiPost<{ ok: true }>('/api/read-marks', mark),
    onSuccess: (_, mark) =>
      qc.invalidateQueries({
        queryKey: ['read-marks', mark.hostAlias, mark.repoPath],
      }),
  });
}

// ---------- prefs ----------

export function usePrefs() {
  return useQuery({
    queryKey: ['prefs'],
    queryFn: () => api<{ prefs: AppConfig['ui'] }>('/api/prefs'),
  });
}

export function useUpdatePrefs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<AppConfig['ui']>) =>
      apiPut<{ prefs: AppConfig['ui'] }>('/api/prefs', patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['prefs'] }),
  });
}
