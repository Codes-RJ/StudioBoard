import EditorialIntro from './EditorialIntro';
import EditorialMotion from './EditorialMotion';
import DocumentArt from '../illustrations/DocumentArt';

export default function ReadingLayout({ title, description, illustration = 'privacy', sections, children }) {
  return <EditorialMotion as="article" className="site-container reading-page">
    <div className="document-heading"><EditorialIntro eyebrow="The details, in plain view" title={title} description={description} /><div className="document-heading-art" data-reveal data-reveal-delay="120"><DocumentArt kind={illustration} /></div></div>
    <div className="reading-layout">
      <nav className="reading-index" aria-label={`${title} sections`}><p>On this page</p>{sections.map((label, index) => <a href={`#document-section-${index + 1}`} key={label}>{label}</a>)}</nav>
      <div className="reading-content">{children}</div>
    </div>
  </EditorialMotion>;
}
