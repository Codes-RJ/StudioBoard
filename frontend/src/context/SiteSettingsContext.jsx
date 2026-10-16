import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import api from '../services/api';
import { reportExpectedDegradation } from '../utils/apiError';
import { SERVER_WORKSPACE_ENABLED } from '../config/workspace';

export const DEFAULT_SITE_SETTINGS = {
  branding: {
    siteName: 'Analytics Dashboard',
    homeTitle: 'A clearer view of your data.',
    homeDescription: 'Open a spreadsheet. Review the data. Build a dashboard you can actually use.',
    primaryColor: '#173F35',
    template: 'standard'
  },
  sections: {
    showCapabilities: true,
    showDashboard: true,
    showUpload: true
  },
  features: {
    localUpload: true,
    urlImport: true,
    dataAssistant: true,
    reports: true,
    exports: true,
    serverWorkspace: SERVER_WORKSPACE_ENABLED ? 'admin' : 'disabled',
    serverAnalytics: SERVER_WORKSPACE_ENABLED ? 'admin' : 'disabled',
    serverLayouts: SERVER_WORKSPACE_ENABLED ? 'admin' : 'disabled',
    serverExports: SERVER_WORKSPACE_ENABLED ? 'admin' : 'disabled',
    aiLayoutSuggestions: 'disabled'
  }
};

const SiteSettingsContext = createContext();

export const useSiteSettings = () => {
  const context = useContext(SiteSettingsContext);
  if (!context) {
    throw new Error('useSiteSettings must be used within SiteSettingsProvider');
  }
  return context;
};

export function SiteSettingsProvider({ children }) {
  const [settings, setSettings] = useState(DEFAULT_SITE_SETTINGS);
  const [loading, setLoading] = useState(true);

  const refreshSettings = useCallback(async () => {
    if (!SERVER_WORKSPACE_ENABLED) {
      setSettings(DEFAULT_SITE_SETTINGS);
      setLoading(false);
      return DEFAULT_SITE_SETTINGS;
    }
    try {
      const { data } = await api.get('/config');
      setSettings(data);
      return data;
    } catch (error) {
      reportExpectedDegradation('Public site settings are unavailable; defaults are active.', error);
      return DEFAULT_SITE_SETTINGS;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshSettings();
  }, [refreshSettings]);

  useEffect(() => {
    document.documentElement.style.setProperty('--site-primary', settings.branding.primaryColor);
    document.documentElement.dataset.siteTemplate = settings.branding.template;
  }, [settings]);

  const value = useMemo(() => ({ settings, loading, setSettings, refreshSettings }), [loading, refreshSettings, settings]);
  return <SiteSettingsContext.Provider value={value}>{children}</SiteSettingsContext.Provider>;
}
