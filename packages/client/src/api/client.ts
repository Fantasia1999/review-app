/**
 * Thin fetch wrapper for the agent API.
 *
 * The agent always returns `{ error: RemoteError }` for failures (HTTP 4xx/5xx)
 * or the success body directly. We decode that here so callers always get a
 * proper Error instance with the typed `info` field attached.
 */

import type { RemoteError } from '@shared/types';

export class ApiError extends Error {
  constructor(public readonly info: RemoteError, public readonly status: number) {
    super(info.message);
    this.name = 'ApiError';
  }
}

export async function api<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  let body: any = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    // non-JSON response
  }
  if (!res.ok) {
    const err: RemoteError = body?.error ?? {
      kind: 'unknown',
      message: text || `HTTP ${res.status}`,
    };
    throw new ApiError(err, res.status);
  }
  return body as T;
}

export const apiPost = <T>(path: string, body: unknown) =>
  api<T>(path, { method: 'POST', body: JSON.stringify(body) });

export const apiPut = <T>(path: string, body: unknown) =>
  api<T>(path, { method: 'PUT', body: JSON.stringify(body) });

export const apiPatch = <T>(path: string, body: unknown) =>
  api<T>(path, { method: 'PATCH', body: JSON.stringify(body) });

export const apiDelete = <T>(path: string, body?: unknown) =>
  api<T>(path, {
    method: 'DELETE',
    body: body ? JSON.stringify(body) : undefined,
  });
