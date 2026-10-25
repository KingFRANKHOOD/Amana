"use client";

import {
  Component,
  type ReactNode,
  type ErrorInfo,
} from "react";
import { trackFailure } from "@/lib/analytics";
import { ErrorState } from "./ErrorState";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  onReset?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    trackFailure("render_error", {
      componentStack: errorInfo.componentStack ?? "unknown",
    });
    if (process.env.NODE_ENV !== "production") {
      console.error("[ErrorBoundary] Render error", error, errorInfo);
    }
    this.props.onError?.(error, errorInfo);
  }

  override render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <ErrorState
          className="min-h-[60vh]"
          variant="card"
          title="We could not load this page"
          message="The service may be temporarily unavailable. Your data is safe; retry the request in a moment."
          onRetry={() => {
            this.setState({ hasError: false, error: null });
            this.props.onReset?.();
          }}
        />
      );
    }

    return this.props.children;
  }
}
