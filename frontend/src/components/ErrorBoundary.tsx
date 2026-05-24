import { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import i18n from "@/i18n";

// ErrorBoundary is a class component, so the useTranslation hook is off
// limits. Pull keys imperatively off the shared i18n instance instead.
const t = (key: string, fallback: string) =>
  i18n.t(key, { defaultValue: fallback });

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null, errorInfo: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught:", error, errorInfo);
    this.setState({ errorInfo });
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      const { error, errorInfo } = this.state;
      return (
        <div className="flex min-h-screen items-center justify-center bg-background p-6">
          <div className="w-full max-w-2xl rounded-lg border border-destructive/30 bg-destructive/5 p-6 space-y-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-6 w-6 shrink-0 text-destructive" />
              <div>
                <h1 className="text-lg font-semibold text-destructive">
                  {t("errorBoundary.title", "Something went wrong while loading this page")}
                </h1>
                <p className="text-sm text-muted-foreground mt-1">
                  {t(
                    "errorBoundary.description",
                    "An unexpected error occurred. Try reloading or go back to the home page. If the problem persists, please contact your system administrator with the message below.",
                  )}
                </p>
              </div>
            </div>

            {error && (
              <div className="rounded-md bg-background border p-3 space-y-2">
                <p className="font-mono text-xs font-semibold text-destructive">
                  {error.name}: {error.message}
                </p>
                {error.stack && (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                      Stack trace
                    </summary>
                    <pre className="mt-2 overflow-auto whitespace-pre-wrap font-mono text-[10px] text-muted-foreground">
                      {error.stack}
                    </pre>
                  </details>
                )}
                {errorInfo?.componentStack && (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                      Component stack
                    </summary>
                    <pre className="mt-2 overflow-auto whitespace-pre-wrap font-mono text-[10px] text-muted-foreground">
                      {errorInfo.componentStack}
                    </pre>
                  </details>
                )}
              </div>
            )}

            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={this.handleReset}>
                {t("errorBoundary.retry", "Try again")}
              </Button>
              <Button onClick={this.handleReload}>
                {t("errorBoundary.reload", "Reload page")}
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
