import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[AudioVault ErrorBoundary] Uncaught React rendering error:', error, errorInfo);
    this.setState({ errorInfo });
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            padding: '2.5rem',
            background: '#070a12',
            color: '#f87171',
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            boxSizing: 'border-box',
          }}
        >
          <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>⚠️</div>
          <h2 style={{ color: '#fff', margin: '0 0 0.5rem 0', fontSize: '1.25rem' }}>
            AudioVault Encountered a Display Error
          </h2>
          <p style={{ color: '#94a3b8', fontSize: '0.9rem', maxWidth: '540px', textAlign: 'center', lineHeight: 1.5, margin: '0 0 1.5rem 0' }}>
            A rendering exception occurred, but your audio takes, transcripts, and vault data remain safe on disk.
          </p>
          <pre
            style={{
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(248, 113, 113, 0.25)',
              padding: '1rem',
              borderRadius: '6px',
              color: '#fca5a5',
              maxWidth: '650px',
              width: '100%',
              overflow: 'auto',
              fontSize: '0.8rem',
              lineHeight: 1.4,
              maxHeight: '200px',
            }}
          >
            {this.state.error?.message || 'Unknown error'}
            {'\n'}
            {this.state.error?.stack}
          </pre>
          <div style={{ marginTop: '1.5rem', display: 'flex', gap: '0.75rem' }}>
            <button
              onClick={() => {
                this.setState({ hasError: false, error: null, errorInfo: null });
                window.location.reload();
              }}
              style={{
                padding: '0.55rem 1.25rem',
                background: '#00e5ff',
                color: '#070a12',
                fontWeight: 600,
                border: 'none',
                borderRadius: '5px',
                cursor: 'pointer',
                fontSize: '0.88rem',
              }}
            >
              Reload AudioVault
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
