import { Component, type ErrorInfo, type ReactNode } from "react";
import { useLocation } from "react-router-dom";

interface State {
  failed: boolean;
}

/** Catches render errors so a bug shows a recovery screen instead of a blank page. */
export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Unhandled render error", error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <section role="alert" className="mx-auto flex max-w-md flex-col items-start gap-3 pt-16">
        <h1 className="text-headline font-semibold">Something went wrong</h1>
        <p className="text-body text-muted">An unexpected error stopped this page from loading. Reloading usually fixes it.</p>
        <button
          type="button"
          onClick={() => location.reload()}
          className="inline-flex items-center rounded-lg bg-accent px-4 py-1.5 text-body font-semibold text-white hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Reload
        </button>
      </section>
    );
  }
}

/** ErrorBoundary that resets on navigation, so the sidebar can lead away from an error screen. */
export function RouteErrorBoundary({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return <ErrorBoundary key={pathname}>{children}</ErrorBoundary>;
}
