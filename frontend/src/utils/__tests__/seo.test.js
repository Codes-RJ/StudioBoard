import { describe, it, expect } from 'vitest';
import { pageMetadata, publicOrigin, applyPageMetadata } from '../seo.mjs';

describe('public SEO and workspace indexing boundary', () => {
  it('uses production canonical URLs and keeps workspaces, unknown routes and previews out of search', () => {
    const options = { origin: 'https://analytics.example' };
    expect(pageMetadata('/privacy/', options)).toMatchObject({ canonical: 'https://analytics.example/privacy', robots: 'index,follow' });
    expect(pageMetadata('/how-it-works/', options)).toMatchObject({ canonical: 'https://analytics.example/how-it-works', robots: 'index,follow', title: 'How It Works | Analytics Dashboard' });
    for (const route of ['/dashboard', '/upload', '/login', '/admin', '/unknown']) expect(pageMetadata(route, options)).toMatchObject({ canonical: '', robots: 'noindex,follow', schema: null });
    expect(pageMetadata('/')).toMatchObject({ canonical: '', robots: 'noindex,follow' });
    for (const url of ['http://analytics.example', 'https://localhost', 'https://analytics.example/path', 'https://user:secret@analytics.example', 'https://analytics.example?private=1']) expect(() => publicOrigin(url)).toThrow();
  });
  it('updates public navigation and removes stale schema and duplicate metadata without using private URLs', () => {
    document.head.innerHTML = '<meta name="description"><meta name="description">';
    applyPageMetadata(document, pageMetadata('/', { origin: 'https://analytics.example', siteName: '</script><script>private()</script>' }));
    const schema = document.querySelector('script[data-site-schema]');
    expect(JSON.parse(schema.textContent).name).toContain('private()');
    expect(schema.textContent).not.toContain('</script>');
    applyPageMetadata(document, pageMetadata('/terms', { origin: 'https://analytics.example' }));
    expect(document.title).toContain('Terms of Service');
    expect(document.querySelectorAll('meta[name="description"]')).toHaveLength(1);
    expect(document.querySelectorAll('link[rel="canonical"]')).toHaveLength(1);
    expect(document.querySelector('script[data-site-schema]')).toBeNull();
    applyPageMetadata(document, pageMetadata('/dashboard', { origin: 'https://analytics.example' }));
    expect(document.querySelector('link[rel="canonical"]')).toBeNull();
    expect(document.querySelector('meta[property="og:url"]')).toBeNull();
    expect(document.querySelector('meta[name="robots"]').content).toBe('noindex,follow');
  });
});
