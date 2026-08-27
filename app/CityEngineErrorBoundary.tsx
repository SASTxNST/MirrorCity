"use client";

import { Component, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class CityEngineErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("[CityEngine] Render error:", error);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="engine-error">
          <div className="engine-error-inner">
            <span className="engine-error-icon" aria-hidden="true">⚠</span>
            <strong>3D engine failed to start</strong>
            <span>{this.state.error.message}</span>
            <button onClick={() => this.setState({ error: null })}>
              ↺ Retry
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
