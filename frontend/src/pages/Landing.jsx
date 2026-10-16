import { FiArrowRight, FiFileText } from 'react-icons/fi';
import { Link } from 'react-router-dom';
import { useSiteSettings } from '../context/SiteSettingsContext';
import DataPreview from '../components/illustrations/DataPreview';
import WorkflowArt from '../components/illustrations/WorkflowArt';
import LeafArt from '../components/illustrations/LeafArt';
import EditorialMotion from '../components/common/EditorialMotion';

export default function Landing() {
  const { settings } = useSiteSettings();
  const canImport = settings.sections.showUpload && (settings.features.localUpload || settings.features.urlImport);
  const standardTitle = settings.branding.homeTitle === 'A clearer view of your data.';
  return <EditorialMotion>
    <section className="site-container landing-hero">
      <div className="hero-copy" data-reveal>
        <p className="eyebrow hero-eyebrow">A little clarity goes a long way</p>
        <h1 className="hero-title">{standardTitle ? <><span>A clearer</span><span>view of</span><span>your data<span className="accent-dot">.</span></span></> : settings.branding.homeTitle}</h1>
        <p className="hero-description">{settings.branding.homeDescription}</p>
        <div className="hero-actions">
          {canImport && <Link to="/upload" className="btn-primary">Import a dataset <FiArrowRight aria-hidden="true" /></Link>}
          {settings.sections.showDashboard && <Link to="/dashboard?sample=saas" className="text-link">Explore sample <FiArrowRight aria-hidden="true" /></Link>}
        </div>
      </div>
      <DataPreview />
    </section>

    {settings.sections.showCapabilities && <section className="site-container home-workflow" aria-labelledby="workflow-title">
      <div className="section-heading" data-reveal><div><p className="eyebrow">How it works</p><h2 id="workflow-title">From rows to a useful answer.</h2></div><p>Open a spreadsheet, make sense of the details, and build a dashboard you can return to.</p></div>
      <div className="workflow-steps">
        <article data-reveal><div className="step-heading"><span>1</span><h3>Import</h3></div><p>Open a local CSV or Excel file, a collection of files, or a public HTTPS data source.</p><WorkflowArt kind="import" /></article>
        <article data-reveal data-reveal-delay="80"><div className="step-heading"><span>2</span><h3>Review</h3></div><p>Check columns, missing values and duplicates. Choose your cleaning steps before analysis.</p><WorkflowArt kind="review" /></article>
        <article data-reveal data-reveal-delay="160"><div className="step-heading"><span>3</span><h3>Explore</h3></div><p>Build charts, ask focused questions, and keep the layouts that help you see more clearly.</p><WorkflowArt kind="explore" /></article>
      </div>
      <Link to="/how-it-works" className="text-link workflow-more">See everything you can do <FiArrowRight aria-hidden="true" /></Link>
    </section>}

    <section className="local-callout"><div className="site-container local-callout-inner">
      <div data-reveal><p className="eyebrow">Made for your own workspace</p><h2>Your workspace. On your device.</h2><p>Work with your data in this browser. Export your results, and keep a backup of the things that matter.</p></div>
      <div className="callout-actions">{canImport && <Link to="/upload" className="btn-primary">Import a dataset <FiArrowRight aria-hidden="true" /></Link>}<Link to="/privacy" className="text-link"><FiFileText aria-hidden="true" /> Read about your data</Link></div>
      <LeafArt />
    </div></section>
  </EditorialMotion>;
}
