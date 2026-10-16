import React from 'react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    console.error('Error caught by boundary:', error, errorInfo);
  }

  handleReset = async () => {
    try {
      localStorage.removeItem('local_dashboard_layout');
      localStorage.removeItem('guest_dashboard_layouts');
      localStorage.removeItem('dashboard-default-layout-id');
      localStorage.removeItem('dashboard-chart-palette');
    } catch (e) {}
    window.location.reload();
  };

  handleClearLocalData = async () => {
    if (!window.confirm('Delete all locally imported datasets and layouts stored in this browser? This cannot be undone.')) return;
    try {
      const { clearLocalDatasetCatalog } = await import('../../utils/localDatasetStore');
      await clearLocalDatasetCatalog();
      localStorage.removeItem('local_datasets_catalog');
    } catch (error) {
      this.setState({ resetError: 'Local data could not be cleared. Please try again.' });
      return;
    }
    await this.handleReset();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-primary-bg text-primary-text p-6">
          <div className="max-w-2xl w-full bg-white border border-slate-200 rounded-lg p-8 space-y-6">
            <div>
              <span className="rounded-full bg-rose-500/20 text-rose-700 px-3 py-1 text-xs font-bold uppercase tracking-wider">
                Workspace interrupted
              </span>
              <h1 className="text-3xl font-serif mt-3 text-slate-900">Let’s get you back to your data.</h1>
              <p className="text-sm text-slate-600 mt-1">
                This view could not finish loading. Try again, or reset the layout if the problem continues.
              </p>
              <p className="text-sm text-slate-600 mt-2">
                Resetting the layout keeps your locally imported datasets. Deleting local data permanently removes them from this browser.
              </p>
              {this.state.resetError && <p role="alert" className="mt-2 text-sm text-rose-800">{this.state.resetError}</p>}
            </div>

            {this.state.error && (
              <div className="rounded-lg bg-slate-50 p-4 border border-slate-200 text-xs font-mono text-rose-800 overflow-auto max-h-60 space-y-2">
                <p className="font-bold text-rose-700">{this.state.error.toString()}</p>
                {this.state.errorInfo && (
                  <pre className="text-[11px] text-slate-600 whitespace-pre-wrap">{this.state.errorInfo.componentStack}</pre>
                )}
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <button
                type="button"
                onClick={() => this.setState({ hasError: false, error: null, errorInfo: null })}
                className="btn-primary flex-1 py-3 text-center justify-center font-bold"
              >
                Try Again
              </button>
              <button
                type="button"
                onClick={this.handleReset}
                className="btn-secondary flex-1 py-3 text-center justify-center font-bold bg-rose-600 hover:bg-rose-700 text-white border-none"
              >
                Reset Layout & Reload
              </button>
            </div>
            <button
              type="button"
              onClick={this.handleClearLocalData}
              className="text-xs font-semibold text-rose-800 underline underline-offset-2 hover:text-rose-200"
            >
              Delete Local Datasets & Reload
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
