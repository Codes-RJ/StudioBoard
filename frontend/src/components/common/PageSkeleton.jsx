// CSS is in the HTML shell so this is visible even before the app bundle loads.
export default function PageSkeleton() {
  return <div className="page-skeleton" role="status" aria-label="Loading page" aria-live="polite">
    <span className="loading-label">Preparing your workspace…</span>
    <div className="skeleton-layout" aria-hidden="true">
      <div className="skeleton-copy"><div className="skeleton-block skeleton-kicker" /><div className="skeleton-block skeleton-title" /><div className="skeleton-block skeleton-title short" /><div className="skeleton-block skeleton-line" /><div className="skeleton-block skeleton-line short" /><div className="skeleton-block skeleton-button" /></div>
      <div className="skeleton-panel"><div className="skeleton-block skeleton-line short" /><div className="skeleton-chart">{[35, 65, 48, 82, 70, 94].map((height, index) => <span className="skeleton-block" key={index} style={{ height: `${height}%` }} />)}</div><div className="skeleton-block skeleton-line" /><div className="skeleton-block skeleton-line" /></div>
    </div>
  </div>;
}
