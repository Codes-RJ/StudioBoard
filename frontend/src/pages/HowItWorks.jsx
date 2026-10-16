import { FiArrowRight, FiCheck, FiDownload, FiFolder, FiLock, FiMessageSquare } from 'react-icons/fi';
import { Link } from 'react-router-dom';
import EditorialIntro from '../components/common/EditorialIntro';
import EditorialMotion from '../components/common/EditorialMotion';
import WorkflowArt from '../components/illustrations/WorkflowArt';
import ChartGallery from '../components/illustrations/ChartGallery';
import BrowserImportLimits from '../components/forms/BrowserImportLimits';
import { SERVER_WORKSPACE_ENABLED } from '../config/workspace';
import { experimentalLocalLLM } from '../utils/localAI/releasePolicy';
import { useSiteSettings } from '../context/SiteSettingsContext';

const stages = [
  { id: 'import', number: '01', title: 'Start with what you have.', label: 'Import your data', art: 'import', description: 'One spreadsheet, a workbook or a whole folder. Bring it into one browser workspace.', features: [
    ['Spreadsheets and delimited files', 'Open CSV, TSV, XLSX, XLS and tabular TXT. Nonempty sheets become separate sources. Leading-zero IDs, blank columns and original files stay intact.'],
    ['Files, folders and collections', 'Choose one file, several files or a nested folder. A multiple-file picker is available when folder selection is not supported. Collections keep related sources together.'],
    ['Public HTTPS sources', 'Import a public data URL or published Google Sheet directly. The source must allow browser access. Preview, cancel and retry without an app proxy.'],
    ['Documents and samples', 'Search PDF text layers, DOCX body text, Markdown and prose TXT with page/block citations. Scans need OCR elsewhere; PDF reading order can vary. Try built-in samples first.']
  ] },
  { id: 'review', number: '02', title: 'Know what you are looking at.', label: 'Review the details', art: 'review', description: 'Understand the source, choose your cleaning steps, then approve it for analysis.', features: [
    ['Types, roles and source grain', 'Check types, measures, identifiers, ignored fields and what each row represents. Review precision, units and calendar choices before calculations.'],
    ['Quality checks and cleaning', 'Inspect missing values, duplicates, formatting and possible outliers. Review a recipe before applying it. Keep source rows and history for undo or reset; cleaning is a choice, not recovered truth.'],
    ['Reviewed relationships', 'Confirm matching keys and join grain before linking sources. Approved relationships support cross-dataset calculations. Source or relationship changes require fresh review.'],
    ['Originals and safe revisions', 'Download the unchanged original. Saved revisions and conflict recovery help prevent stale approvals and results from being applied to newer data.']
  ] },
  { id: 'explore', number: '03', title: 'Find the shape of the story.', label: 'Explore and arrange', art: 'explore', description: 'Follow a trend, compare categories and look at the rows behind the picture.', features: [
    ['Dashboards and metrics', 'Start with suggested layouts, KPIs and supported summaries. Exact tools preserve reviewed decimals and large integers; native chart axes have separate precision limits.'],
    ['40+ charts and card types', 'Choose a representation, map fields, set an aggregation and adjust titles or colors. Explore trends, distributions, correlations and regression when your fields support them.'],
    ['Tables, filters and scope', 'Sort, page and choose columns. Apply or clear filters, inspect active scope and use chart data alternatives. Empty results and unavailable calculations are explained.'],
    ['Your layout, saved', 'Add, configure, duplicate, remove, reorder and resize cards. Use keyboard or touch alternatives, undo/redo and Save/Cancel. Keep named layouts and a preferred palette.']
  ] },
  { id: 'keep', number: '04', title: 'Keep the work worth keeping.', label: 'Export and back up', art: 'backup', description: 'Take your results with you. Keep a separate copy so you can return to your work.', features: [
    ['Reports and exports', 'Create printable reports with supported summaries and chart snapshots. Export working data as CSV, Excel or JSON, or download the unchanged original.'],
    ['Portable workspace backups', 'Back up sources, original files and layouts, then restore in another browser or device. Conversations, derived indexes and downloaded models are excluded.'],
    ['Optional encrypted backups', 'Protect a downloaded backup with a passphrase. Wrong passwords or damage prevent publication on restore. Keep the passphrase: it cannot be recovered. Open workspaces and ordinary backups remain plaintext.'],
    ['Progress and recovery', 'Follow import, analysis, export and restore progress. Cancel supported operations, retry recoverable failures and resolve conflicts without silently discarding saved work.']
  ] }
];

export default function HowItWorks() {
  const { settings } = useSiteSettings();
  const canImport = settings.sections.showUpload && (settings.features.localUpload || settings.features.urlImport);
  return <EditorialMotion className="site-container guide-page">
    <div className="guide-opening">
      <div className="guide-opening-inner"><EditorialIntro eyebrow="A field guide to your workspace" title={<>Good questions.<br />Clearer answers.</>} description="From your first spreadsheet to a workspace worth keeping. Four steps, at your own pace.">
        {canImport && <Link to="/upload" className="btn-primary">Import your first dataset <FiArrowRight aria-hidden="true" /></Link>}
      </EditorialIntro><div className="guide-opening-art" data-reveal data-reveal-delay="120"><WorkflowArt kind="overview" /></div></div>
      <nav className="guide-index" aria-label="Guide sections">{stages.map((stage) => <a key={stage.id} href={`#${stage.id}`}><span>{stage.number}</span>{stage.label}<FiArrowRight aria-hidden="true" /></a>)}</nav>
    </div>
    {stages.map((stage) => <section key={stage.id} id={stage.id} className="guide-stage" aria-labelledby={`${stage.id}-heading`}>
      <div className="guide-stage-copy" data-reveal><p className="eyebrow">{stage.number} / {stage.label}</p><h2 id={`${stage.id}-heading`}>{stage.title}</h2><p className="stage-description">{stage.description}</p></div>
      <div className="guide-stage-art" data-reveal data-reveal-delay="100"><WorkflowArt kind={stage.art} /></div>
      <div className="guide-features">{stage.features.map(([title, description], index) => <div key={title} data-reveal data-reveal-delay={index % 2 * 80}><h3><FiCheck aria-hidden="true" />{title}</h3><p>{description}</p></div>)}</div>
    </section>)}
    {settings.features.dataAssistant && <section className="guide-evidence" data-reveal aria-labelledby="questions-heading">
      <FiMessageSquare className="section-icon" aria-hidden="true" /><div><p className="eyebrow">Questions, with evidence</p><h2 id="questions-heading">Ask. Check. Understand.</h2><p>Ask focused questions. Supported answers use local calculations, an inspectable plan and supporting evidence. Review suggested chart or filter actions before applying them.</p><p>Search documents and rows with lexical retrieval. Optional semantic search downloads an embedding model when you choose; indexing runs in browser workers. Conversations and evidence follow source revisions and filter scope.</p><p>Unload models, delete their caches or clear a conversation separately from source data.</p>{experimentalLocalLLM && <p>This experimental build also offers opt-in local generation. Check answers against the cited data.</p>}<div className="example-questions"><span>Try a question</span><p>“What is the total revenue?”</p><p>“Show revenue by region.”</p></div></div>
    </section>}
    <section className="guide-reference guide-chart-library" aria-labelledby="chart-library-heading"><div data-reveal><p className="eyebrow">A chart for the question</p><h2 id="chart-library-heading">40+ ways to see it.</h2><p>Choose from 40+ charts and card types. Compare categories, follow trends or explore relationships. The chooser helps you match a representation to your fields and browser capabilities.</p></div><ChartGallery /></section>
    <section className="guide-reference" aria-labelledby="storage-heading"><div data-reveal><p className="eyebrow">Good to know</p><h2 id="storage-heading">A little care.<br />A lasting workspace.</h2></div><div className="practical-details" data-reveal><p><FiLock aria-hidden="true" />Local files are analyzed on your device. The personal edition needs no account. The site, explicit URL imports and optional model downloads still make network requests.</p><p><FiFolder aria-hidden="true" />Storage belongs to this website address and browser profile. Clearing site data, private browsing, eviction or changing addresses can make work unavailable. Back up before moving.</p><p><FiDownload aria-hidden="true" />Large files and slower devices need care. Import and saved-source limits differ. Split large files by date, sheet or category when needed.</p><BrowserImportLimits variant="quiet" /><Link to="/privacy" className="text-link">Read the privacy details <FiArrowRight aria-hidden="true" /></Link></div></section>
    {SERVER_WORKSPACE_ENABLED && <section className="guide-reference" data-reveal><div><p className="eyebrow">Separate server edition</p><h2>Managed workspace.</h2></div><p>This enabled edition can offer authenticated storage, server analytics/snapshots, live updates, layouts and exports under administrator policy. Admin controls cover accounts, service status, branding and capability access. Optional remote layout suggestions require explicit consent.</p></section>}
    <div className="guide-closing" data-reveal><h2>Start with one spreadsheet.</h2><p>Review it first. Find something useful.</p>{canImport && <Link to="/upload" className="btn-primary">Import a dataset <FiArrowRight aria-hidden="true" /></Link>}</div>
  </EditorialMotion>;
}
