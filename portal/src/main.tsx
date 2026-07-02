import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { applyTheme, watchSystemTheme } from "./theme";
import "./index.css";

// Apply the saved (or system) theme before the first paint to avoid a flash, then keep it in sync
// with the OS setting while in system mode.
applyTheme();
watchSystemTheme();

// Last line of defense: a render error in one screen must not blank the whole console. The screen
// that threw is replaced by a message with a way back; everything else keeps working after a retry.
class AppErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="app">
          <div className="card">
            <h2>Something went wrong</h2>
            <div className="error">{this.state.error.message}</div>
            <button className="primary" onClick={() => this.setState({ error: null })}>
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>,
);
