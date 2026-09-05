import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ToastProvider, useToast } from './components/common/Toast';
import './index.css';

/** Surface uncaught errors / rejections once (deduped) via toast + console. */
function GlobalRuntimeGuards() {
  const toast = useToast();

  useEffect(() => {
    const seen = new Set<string>();
    const report = (title: string, detail: string) => {
      const key = `${title}|${detail.slice(0, 160)}`;
      if (seen.has(key)) return;
      seen.add(key);
      if (seen.size > 40) {
        const first = seen.values().next().value as string | undefined;
        if (first) seen.delete(first);
      }
      console.error(`[runtime] ${title}:`, detail);
      toast.error(title, detail.slice(0, 240));
    };

    const onError = (ev: ErrorEvent) => {
      const detail = ev.error instanceof Error ? ev.error.message : ev.message || 'Unknown error';
      report('Unhandled error', detail);
    };
    const onRejection = (ev: PromiseRejectionEvent) => {
      const reason = ev.reason;
      let detail: string;
      if (reason instanceof Error) detail = reason.message;
      else if (typeof reason === 'string') detail = reason;
      else {
        try {
          detail = JSON.stringify(reason);
        } catch {
          detail = String(reason);
        }
      }
      report('Unhandled promise rejection', detail || 'Unknown rejection');
    };

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, [toast]);

  return null;
}

const el = document.getElementById('root');
if (!el) throw new Error('Missing #root');
createRoot(el).render(
  <StrictMode>
    <ErrorBoundary fallbackTitle="Abliterated IDE crashed">
      <ToastProvider>
        <GlobalRuntimeGuards />
        <ErrorBoundary fallbackTitle="App render error">
          <App />
        </ErrorBoundary>
      </ToastProvider>
    </ErrorBoundary>
  </StrictMode>,
);
