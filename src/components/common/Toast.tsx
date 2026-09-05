import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { cn } from '../../lib/cn';

export type ToastType = 'info' | 'success' | 'warning' | 'error';

export interface ToastItem {
  id: string;
  type: ToastType;
  title: string;
  description?: string;
  duration?: number;
}

interface ToastContextValue {
  showToast: (title: string, opts?: { type?: ToastType; description?: string; duration?: number }) => void;
  info: (title: string, description?: string) => void;
  success: (title: string, description?: string) => void;
  warning: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let toastSeq = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (title: string, opts?: { type?: ToastType; description?: string; duration?: number }) => {
      const id = `toast-${++toastSeq}-${Date.now()}`;
      const type = opts?.type ?? 'info';
      const duration = opts?.duration ?? (type === 'error' ? 5000 : 3200);

      const item: ToastItem = {
        id,
        type,
        title,
        description: opts?.description,
        duration,
      };

      setToasts((prev) => [...prev.slice(-4), item]);

      if (duration > 0) {
        window.setTimeout(() => {
          removeToast(id);
        }, duration);
      }
    },
    [removeToast],
  );

  const info = useCallback((title: string, desc?: string) => showToast(title, { type: 'info', description: desc }), [showToast]);
  const success = useCallback((title: string, desc?: string) => showToast(title, { type: 'success', description: desc }), [showToast]);
  const warning = useCallback((title: string, desc?: string) => showToast(title, { type: 'warning', description: desc }), [showToast]);
  const error = useCallback((title: string, desc?: string) => showToast(title, { type: 'error', description: desc }), [showToast]);

  return (
    <ToastContext.Provider value={{ showToast, info, success, warning, error }}>
      {children}
      <div
        className="fixed bottom-9 right-4 z-50 flex flex-col gap-2 pointer-events-none max-w-sm w-full sm:w-auto"
        aria-live="polite"
      >
        {toasts.map((toast) => {
          const Icon =
            toast.type === 'success'
              ? CheckCircle2
              : toast.type === 'warning'
                ? AlertTriangle
                : toast.type === 'error'
                  ? AlertCircle
                  : Info;

          const colorClass =
            toast.type === 'success'
              ? 'border-emerald-500/30 bg-surface-raised text-emerald-300'
              : toast.type === 'warning'
                ? 'border-amber-500/30 bg-surface-raised text-amber-300'
                : toast.type === 'error'
                  ? 'border-rose-500/30 bg-surface-raised text-rose-300'
                  : 'border-sky-500/30 bg-surface-raised text-sky-300';

          return (
            <div
              key={toast.id}
              className={cn(
                'pointer-events-auto flex items-start gap-2.5 rounded-md border px-3 py-2.5 shadow-xl backdrop-blur-md font-mono text-xs toast-animate-in',
                colorClass,
              )}
            >
              <Icon size={14} className="mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0 pr-1">
                <div className="font-semibold text-zinc-100">{toast.title}</div>
                {toast.description ? (
                  <div className="mt-0.5 text-[11px] text-zinc-400 leading-4">{toast.description}</div>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => removeToast(toast.id)}
                className="text-zinc-500 hover:text-zinc-200 transition-colors p-0.5 rounded"
              >
                <X size={12} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    return {
      showToast: () => {},
      info: () => {},
      success: () => {},
      warning: () => {},
      error: () => {},
    };
  }
  return ctx;
}
