import { Component, type ReactNode } from 'react';
import { AlertCircle, RotateCcw } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallbackLabel?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full items-center justify-center p-8">
          <div className="flex max-w-sm flex-col items-center gap-4 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
              <AlertCircle className="h-6 w-6 text-destructive" />
            </div>
            <div>
              <h3 className="text-sm font-semibold">
                {this.props.fallbackLabel || 'Что-то пошло не так'}
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                {this.state.error?.message || 'Неизвестная ошибка'}
              </p>
            </div>
            <button
              onClick={this.handleReset}
              className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-xs font-medium hover:bg-accent/80 transition-colors"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Попробовать снова
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
