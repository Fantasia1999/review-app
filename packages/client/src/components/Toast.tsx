/**
 * Tiny toast system.
 *
 * Why not a library? We have one global error path (api/client.ts) and a
 * single screen that needs success toasts. A 60-line context provider is
 * smaller than installing react-hot-toast and pulling its CSS in.
 *
 * Use:
 *   - <ToastProvider>...</ToastProvider> at the app root
 *   - const toast = useToast(); toast.show({ kind: 'error', message: '…' })
 *
 * api/client.ts also dispatches a `review-app:api-error` window event when
 * an ApiError is thrown, which the provider listens for so unhandled errors
 * still surface even if no callsite caught them.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';

export type ToastKind = 'info' | 'success' | 'error';
export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastApi {
  show: (t: { kind?: ToastKind; message: string }) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const TOAST_TTL_MS = 4000;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);

  const show = useCallback<ToastApi['show']>(({ kind = 'info', message }) => {
    if (!message) return;
    const id = ++idRef.current;
    setToasts((prev) => [...prev, { id, kind, message }].slice(-3));
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, TOAST_TTL_MS);
  }, []);

  // Listen for API errors dispatched from the fetch wrapper.
  useEffect(() => {
    const onErr = (e: Event) => {
      const detail = (e as CustomEvent<{ message: string }>).detail;
      show({ kind: 'error', message: detail?.message ?? 'Request failed' });
    };
    window.addEventListener('review-app:api-error', onErr);
    return () => window.removeEventListener('review-app:api-error', onErr);
  }, [show]);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Soft-fallback so components don't blow up in unit tests without a
    // provider. Discards the message but keeps types honest.
    return { show: () => {} };
  }
  return ctx;
}
