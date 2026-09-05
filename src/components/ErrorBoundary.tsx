import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = {
  children: ReactNode;
  fallbackTitle?: string;
};

type State = {
  error: Error | null;
};

/** Catches render errors so a screen bug does not white-screen the IDE. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  private reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    const title = this.props.fallbackTitle ?? 'Something went wrong';
    const message = error.message || String(error);

    return (
      <div className="flex h-full min-h-[12rem] flex-col items-center justify-center gap-3 bg-background px-6 text-center text-zinc-200">
        <div className="font-mono text-sm font-semibold text-rose-300">{title}</div>
        <pre className="max-w-xl whitespace-pre-wrap break-words rounded border border-rose-500/30 bg-surface px-3 py-2 font-mono text-[11px] text-zinc-400">
          {message}
        </pre>
        <button
          type="button"
          onClick={this.reset}
          className="rounded border border-border bg-surface px-3 py-1.5 font-mono text-xs text-zinc-200 hover:bg-zinc-800"
        >
          Try again
        </button>
      </div>
    );
  }
}
