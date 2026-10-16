import { FiArrowRight } from 'react-icons/fi';
import { Link } from 'react-router-dom';
import UploadForm from '../components/forms/UploadForm';
import EditorialIntro from '../components/common/EditorialIntro';
import ImportBloom from '../components/illustrations/ImportBloom';
import { useSiteSettings } from '../context/SiteSettingsContext';

export default function Upload() {
  const { settings } = useSiteSettings();
  if (!settings.sections.showUpload) return <section className="site-container import-page"><EditorialIntro eyebrow="Import data" title="A pause at the beginning." description="Dataset import is currently unavailable." /><Link to="/" className="text-link">Go back home <FiArrowRight aria-hidden="true" /></Link></section>;
  return <section className="site-container import-page">
    <EditorialIntro eyebrow="Import data" title="Bring your data." description="Choose a file. Review the details. Make it useful." />
    <ol className="import-progress" aria-label="Import workflow"><li aria-current="step"><span>01</span> Import</li><li><span>02</span> Review</li><li><span>03</span> Explore</li></ol>
    <div className="import-stage"><ImportBloom /><div className="import-surface"><UploadForm /></div></div>
    <div className="import-help"><Link to="/how-it-works" className="text-link">Need a hand? Read the guide <FiArrowRight aria-hidden="true" /></Link></div>
  </section>;
}
