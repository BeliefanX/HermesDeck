'use client';
import { Component, type ReactNode } from 'react';

interface Props {
  /** Plain text fallback shown when render throws. Receives the error message. */
  fallback?: (err: Error) => ReactNode;
  /** Default fallback renders the original text content (raw, escaped). */
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Light-weight error boundary used to wrap the markdown / math / mermaid
 * pipeline so a malformed message can't take down the whole chat view.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.warn('[ErrorBoundary] caught render error:', error);
  }

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback(this.state.error);
      return (
        <div
          role="alert"
          style={{
            padding: 12,
            border: '1px dashed var(--line)',
            borderRadius: 8,
            background: 'var(--panel-2)',
            color: 'var(--muted)',
            fontSize: 12,
          }}
        >
          渲染失败 / Render failed: {this.state.error.message}
        </div>
      );
    }
    return this.props.children;
  }
}
