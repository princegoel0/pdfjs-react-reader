import { Component, type ReactNode, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { GlobalWorkerOptions } from 'pdfjs-dist';
import App from './App';

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, errorInfo: any) {
    console.error('ErrorBoundary caught:', error, errorInfo);
    const div = document.createElement('div');
    div.id = 'pjsr-global-error';
    div.style.cssText =
      'color:red;padding:20px;font-size:16px;z-index:99999;position:fixed;top:0;left:0;background:white;';
    div.textContent = `React Error: ${error?.message || error}\n${error?.stack || ''}\n${errorInfo?.componentStack || ''}`;
    document.body.appendChild(div);
  }
  render() {
    if (this.state.error) {
      return (
        <div id="react-error-boundary" style={{ color: 'red', padding: 20 }}>
          <h1>Rendering Error</h1>
          <pre>{this.state.error.message}</pre>
          <pre>{this.state.error.stack}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

// Consumer-side worker wiring (the documented manual pattern). The library
// also auto-detects this URL when workerSrc is omitted.
GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
