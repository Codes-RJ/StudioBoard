import { renderToString } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom';
import Landing from './pages/Landing';
import Privacy from './pages/Privacy';
import Terms from './pages/Terms';
import HowItWorks from './pages/HowItWorks';
import NotFound from './pages/NotFound';
import { SiteSettingsProvider } from './context/SiteSettingsContext';
import { SiteHeader, SiteFooter } from './components/common/SiteChrome';
import PageSkeleton from './components/common/PageSkeleton';

export const renderLoadingPage = () => renderToString(<><div className="boot-header" aria-hidden="true"><span className="skeleton-block" /></div><PageSkeleton /></>);

// Public content only: no workspace provider, datasets, accounts or model loads.
export const renderPublicPage = (route) => {
  const Page = { '/': Landing, '/how-it-works': HowItWorks, '/privacy': Privacy, '/terms': Terms }[route] || NotFound;
  return renderToString(<StaticRouter location={route}><SiteSettingsProvider>
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main id="main-content" className="grow" tabIndex={-1}><Page /></main>
      <SiteFooter />
    </div>
  </SiteSettingsProvider></StaticRouter>);
};
