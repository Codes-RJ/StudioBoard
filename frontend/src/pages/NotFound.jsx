import { FiArrowRight } from 'react-icons/fi';
import { Link } from 'react-router-dom';
import EditorialIntro from '../components/common/EditorialIntro';
import EditorialMotion from '../components/common/EditorialMotion';
import { useSiteSettings } from '../context/SiteSettingsContext';
import DocumentArt from '../components/illustrations/DocumentArt';

export default function NotFound() {
  const { settings } = useSiteSettings();
  return <EditorialMotion as="section" className="site-container not-found">
    <div data-reveal><DocumentArt kind="missing" /></div>
    <EditorialIntro eyebrow="A small detour" title="Page Not Found" description="This page may have moved, or the address may be incomplete. Your next useful view is just a click away.">
      <div className="not-found-actions"><Link to="/" className="btn-primary">Go back home <FiArrowRight aria-hidden="true" /></Link>{settings.sections.showDashboard && <Link to="/dashboard" className="text-link">Open dashboard</Link>}</div>
    </EditorialIntro>
  </EditorialMotion>;
}
