import { useState } from 'react';
import { FiArrowUpRight, FiBarChart2, FiMenu, FiX } from 'react-icons/fi';
import { Link, useLocation } from 'react-router-dom';
import { useSiteSettings } from '../../context/SiteSettingsContext';
import { PORTFOLIO_URL } from '../../config/portfolio';

export function Brand({ name = 'Analytics Dashboard', onClick }) {
  return <Link to="/" onClick={onClick} className="site-brand" aria-label={`${name} home`}>
    <span className="brand-mark"><FiBarChart2 aria-hidden="true" /></span>
    <span>{name}</span>
  </Link>;
}

// Shared by the interactive application and the public HTML prerender.
export function SiteHeader({ onNavigate, accountLinks }) {
  const { settings } = useSiteSettings();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const follow = (event, destination) => {
    onNavigate?.(event, destination);
    if (!event.defaultPrevented) setOpen(false);
  };
  const links = <>
    <Link to="/how-it-works" aria-current={pathname === '/how-it-works' ? 'page' : undefined} onClick={(event) => follow(event, '/how-it-works')} className="nav-link">How it works</Link>
    {settings.sections.showDashboard && <Link to="/dashboard" aria-current={pathname === '/dashboard' ? 'page' : undefined} onClick={(event) => follow(event, '/dashboard')} className="nav-link">Dashboard</Link>}
    {accountLinks}
    {settings.sections.showUpload && (settings.features.localUpload || settings.features.urlImport) && <Link to="/upload" onClick={(event) => follow(event, '/upload')} className="btn-primary nav-import">Import data <FiArrowUpRight aria-hidden="true" /></Link>}
  </>;
  return <header className="site-header">
    <a href="#main-content" className="skip-link">Skip to content</a>
    <nav className="site-container header-inner" aria-label="Main navigation">
      <Brand name={settings.branding.siteName} onClick={(event) => follow(event, '/')} />
      <div className="desktop-navigation">{links}</div>
      <button type="button" className="mobile-menu-toggle" aria-label={open ? 'Close navigation' : 'Open navigation'} aria-expanded={open} aria-controls="mobile-navigation" onClick={() => setOpen(!open)}>{open ? <FiX aria-hidden="true" /> : <FiMenu aria-hidden="true" />}</button>
      {open && <div id="mobile-navigation" className="mobile-navigation">{links}</div>}
    </nav>
  </header>;
}

export function SiteFooter({ onNavigate, accountLinks }) {
  const { settings } = useSiteSettings();
  const portfolioDestination = PORTFOLIO_URL || '/';
  const externalPortfolio = /^https?:\/\//i.test(portfolioDestination);
  return <footer className="site-footer">
    <div className="site-container footer-inner">
      <Brand name={settings.branding.siteName} onClick={(event) => onNavigate?.(event, '/')} />
      <nav aria-label="Footer navigation">
        <Link to="/how-it-works" onClick={(event) => onNavigate?.(event, '/how-it-works')}>How it works</Link>
        <Link to="/privacy" onClick={(event) => onNavigate?.(event, '/privacy')}>Privacy</Link>
        <Link to="/terms" onClick={(event) => onNavigate?.(event, '/terms')}>Terms</Link>
        {externalPortfolio ? <a className="portfolio-link" href={portfolioDestination} target="_blank" rel="noopener noreferrer" onClick={(event) => onNavigate?.(event, portfolioDestination)}>Visit me <FiArrowUpRight aria-hidden="true" /><span className="sr-only"> (opens in a new tab)</span></a> : <Link className="portfolio-link" to={portfolioDestination} onClick={(event) => onNavigate?.(event, portfolioDestination)}>Visit me <FiArrowUpRight aria-hidden="true" /></Link>}
        {accountLinks}
      </nav>
    </div>
  </footer>;
}
