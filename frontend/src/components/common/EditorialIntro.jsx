export default function EditorialIntro({ eyebrow, title, description, children }) {
  return <div className="editorial-intro" data-reveal>
    {eyebrow && <p className="eyebrow">{eyebrow}</p>}
    <h1>{title}</h1>
    {description && <p className="intro-description">{description}</p>}
    {children}
  </div>;
}
