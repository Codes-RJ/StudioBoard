export const PUBLIC_ROUTES = ['/', '/how-it-works', '/privacy', '/terms'];
export const APP_ROUTES = ['/dashboard', '/upload', '/login', '/admin'];
export const normalizeRoute = (path = '/') => path === '/' ? '/' : path.replace(/\/+$/, '') || '/';
export const publicOrigin = (value = '') => {
  if (!value) return '';
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash
    || /^(localhost|127\.|\[::1\])/.test(url.hostname)) throw new Error('VITE_PUBLIC_SITE_URL must be a public HTTPS origin, without a path, credentials, query or fragment.');
  return url.origin;
};
export const pageMetadata = (pathname, { origin = '', siteName = 'Analytics Dashboard', description = 'Import CSV and Excel, review data quality, build dashboards and ask questions in a browser-local workspace.' } = {}) => {
  const route = normalizeRoute(pathname);
  const labels = { '/': 'CSV & Excel Analytics', '/how-it-works': 'How It Works', '/privacy': 'Privacy Policy', '/terms': 'Terms of Service', '/dashboard': 'Local Dashboard', '/upload': 'Import Data', '/login': 'Sign In', '/admin': 'Administration' };
  const publicPage = PUBLIC_ROUTES.includes(route);
  const canonical = publicPage && origin ? `${publicOrigin(origin)}${route}` : '';
  const descriptions = { '/how-it-works': 'A guide to importing files, reviewing data, building charts, asking questions, exporting reports and restoring workspace backups.', '/privacy': 'How Analytics Dashboard stores datasets, conversations and optional models locally, and handles encrypted backups and external downloads.', '/terms': 'Terms for using Analytics Dashboard, including local storage, data ownership, software licensing and optional local AI.' };
  return { route, title: `${labels[route] || 'Page Not Found'} | ${siteName}`, description: descriptions[route] || (publicPage ? description : 'Your browser-local analytics workspace.'),
    robots: canonical ? 'index,follow' : 'noindex,follow', canonical,
    image: canonical ? `${publicOrigin(origin)}/social-preview.jpg` : '',
    schema: route === '/' && canonical ? { '@context': 'https://schema.org', '@type': 'SoftwareApplication', name: siteName,
      url: canonical, description, applicationCategory: 'BusinessApplication', operatingSystem: 'Web browser',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' } } : null };
};
export const safeJson = (value) => JSON.stringify(value).replace(/</g, '\\u003c');

export const applyPageMetadata = (doc, metadata) => {
  doc.title = metadata.title;
  const meta = (attribute, name, value) => {
    const matches = [...doc.head.querySelectorAll(`meta[${attribute}="${name}"]`)];
    const element = matches.shift() || doc.createElement('meta'); matches.forEach((item) => item.remove());
    if (!value) { element.remove(); return; }
    element.setAttribute(attribute, name); element.content = value; doc.head.appendChild(element);
  };
  meta('name', 'description', metadata.description); meta('name', 'robots', metadata.robots);
  for (const [name, value] of Object.entries({ 'og:type': 'website', 'og:title': metadata.title, 'og:description': metadata.description, 'og:url': metadata.canonical, 'og:image': metadata.image })) meta('property', name, value);
  meta('name', 'twitter:card', metadata.image ? 'summary_large_image' : 'summary');
  meta('name', 'twitter:title', metadata.title); meta('name', 'twitter:description', metadata.description); meta('name', 'twitter:image', metadata.image);
  doc.head.querySelectorAll('link[rel="canonical"], script[data-site-schema]').forEach((item) => item.remove());
  if (metadata.canonical) { const link = doc.createElement('link'); link.rel = 'canonical'; link.href = metadata.canonical; doc.head.appendChild(link); }
  if (metadata.schema) { const script = doc.createElement('script'); script.type = 'application/ld+json'; script.dataset.siteSchema = ''; script.textContent = safeJson(metadata.schema); doc.head.appendChild(script); }
};
