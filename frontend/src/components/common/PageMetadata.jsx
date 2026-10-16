import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useSiteSettings } from '../../context/SiteSettingsContext';
import { applyPageMetadata, pageMetadata, publicOrigin } from '../../utils/seo.mjs';

const origin = publicOrigin(import.meta.env.VITE_PUBLIC_SITE_URL || '');
export default function PageMetadata() {
  const { pathname } = useLocation();
  const { settings } = useSiteSettings();
  useEffect(() => {
    applyPageMetadata(document, pageMetadata(pathname, { origin, siteName: settings.branding.siteName }));
  }, [pathname, settings.branding.siteName]);
  return null;
}
