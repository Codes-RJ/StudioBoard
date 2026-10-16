import { useCallback, useEffect, useState } from 'react';
import { FiActivity, FiDatabase, FiRefreshCw, FiSave, FiServer, FiSettings, FiShield, FiUsers } from 'react-icons/fi';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import { useSiteSettings } from '../context/SiteSettingsContext';
import { describeApiError } from '../utils/apiError';

const formatNumber = (value) => Number(value || 0).toLocaleString();

function Metric({ icon: Icon, label, value }) {
  return (
    <div className="border border-slate-200 bg-white p-5 shadow-xs">
      <Icon className="mb-5 text-xl text-blue-700" aria-hidden="true" />
      <p className="text-2xl font-bold text-slate-950">{formatNumber(value)}</p>
      <p className="mt-1 text-sm text-slate-600">{label}</p>
    </div>
  );
}

export default function Admin() {
  const { isAuthenticated, loading, user } = useAuth();
  const { settings, setSettings } = useSiteSettings();
  const [overview, setOverview] = useState(null);
  const [users, setUsers] = useState([]);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [draftSettings, setDraftSettings] = useState(settings);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState('');

  useEffect(() => {
    setDraftSettings(settings);
  }, [settings]);

  const loadAdminData = useCallback(async () => {
    setRefreshing(true);
    setError('');
    try {
      const [overviewResponse, usersResponse] = await Promise.all([
        api.get('/admin/overview'),
        api.get('/admin/users')
      ]);
      setOverview(overviewResponse.data);
      setUsers(usersResponse.data);
    } catch (requestError) {
      setError(describeApiError(requestError, 'Unable to load administrator data.').text);
    } finally {
      setRefreshing(false);
    }
  }, []);

  const updateSetting = (section, key, value) => {
    setDraftSettings((current) => ({
      ...current,
      [section]: { ...current[section], [key]: value }
    }));
  };

  const saveSettings = async () => {
    setSavingSettings(true);
    setSettingsMessage('');
    try {
      const { data } = await api.put('/admin/config', draftSettings);
      setSettings(data);
      setDraftSettings(data);
      setSettingsMessage('Site settings saved.');
    } catch (requestError) {
      setSettingsMessage(describeApiError(requestError, 'Unable to save site settings.').text);
    } finally {
      setSavingSettings(false);
    }
  };

  useEffect(() => {
    if (isAuthenticated && user?.role === 'ADMIN') {
      void loadAdminData();
    }
  }, [isAuthenticated, loadAdminData, user?.role]);

  if (!loading && !isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (!loading && user?.role !== 'ADMIN') {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <section className="min-h-[calc(100svh-8rem)] bg-slate-50 py-8 sm:py-10">
      <div className="mx-auto max-w-7xl px-4">
        <div className="mb-8 flex flex-col gap-4 border-b border-slate-200 pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-700">Restricted workspace</p>
            <h1 className="mt-2 text-3xl font-bold text-slate-950">Administration</h1>
            <p className="mt-2 text-sm text-slate-600">System activity, stored workspaces, and account access.</p>
          </div>
          <button type="button" onClick={() => void loadAdminData()} disabled={refreshing} className="inline-flex items-center justify-center gap-2 border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 hover:border-slate-900 disabled:cursor-not-allowed disabled:opacity-60">
            <FiRefreshCw className={refreshing ? 'animate-spin' : ''} aria-hidden="true" /> Refresh
          </button>
        </div>

        {error && <p className="mb-6 border border-rose-200 bg-rose-50 p-4 text-sm font-medium text-rose-800">{error}</p>}

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Metric icon={FiUsers} label="Accounts" value={overview?.summary?.users} />
          <Metric icon={FiDatabase} label="Server datasets" value={overview?.summary?.datasets} />
          <Metric icon={FiActivity} label="Audit events" value={overview?.summary?.auditEvents} />
          <Metric icon={FiServer} label="Requests handled" value={overview?.traffic?.totalRequests} />
        </div>

        <div className="mt-8 grid gap-8 lg:grid-cols-[1.35fr_0.65fr]">
          <section className="border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <h2 className="text-base font-semibold text-slate-950">Account directory</h2>
              <span className="text-xs font-medium text-slate-500">{users.length} account{users.length === 1 ? '' : 's'}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr><th className="px-5 py-3 font-semibold">Account</th><th className="px-5 py-3 font-semibold">Role</th><th className="px-5 py-3 font-semibold">Created</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {users.map((account) => (
                    <tr key={account.id}>
                      <td className="px-5 py-4"><p className="font-semibold text-slate-900">{account.name || 'Administrator'}</p><p className="mt-1 text-xs text-slate-500">{account.email}</p></td>
                      <td className="px-5 py-4"><span className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-800"><FiShield aria-hidden="true" /> {account.role}</span></td>
                      <td className="px-5 py-4 text-slate-600">{new Date(account.createdAt).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="border border-slate-200 bg-white p-5">
            <FiServer className="text-xl text-blue-700" aria-hidden="true" />
            <h2 className="mt-5 text-base font-semibold text-slate-950">Service status</h2>
            <dl className="mt-5 divide-y divide-slate-100 text-sm">
              <div className="flex items-center justify-between py-3"><dt className="text-slate-600">CPU usage</dt><dd className="font-semibold text-slate-950">{formatNumber(overview?.system?.cpuUsage)}%</dd></div>
              <div className="flex items-center justify-between py-3"><dt className="text-slate-600">Memory usage</dt><dd className="font-semibold text-slate-950">{formatNumber(overview?.system?.memoryUsedMb)} MB</dd></div>
              <div className="flex items-center justify-between py-3"><dt className="text-slate-600">Saved layouts</dt><dd className="font-semibold text-slate-950">{formatNumber(overview?.summary?.layouts)}</dd></div>
              <div className="flex items-center justify-between py-3"><dt className="text-slate-600">Unique visitors</dt><dd className="font-semibold text-slate-950">{formatNumber(overview?.traffic?.uniqueIps)}</dd></div>
              <div className="flex items-center justify-between py-3"><dt className="text-slate-600">Rate protection</dt><dd className="font-semibold text-slate-950">{overview?.security?.rateLimitingEnabled ? overview.security.defaultRateLimit : 'Disabled'}</dd></div>
              <div className="flex items-center justify-between py-3"><dt className="text-slate-600">CSRF checks</dt><dd className="font-semibold text-slate-950">{overview?.security?.csrfProtection ? 'Active' : 'Unavailable'}</dd></div>
            </dl>
          </section>
        </div>

        <section className="mt-8 border border-slate-200 bg-white p-5 sm:p-6">
          <div className="flex flex-col gap-3 border-b border-slate-200 pb-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <FiSettings className="text-xl text-blue-700" aria-hidden="true" />
              <h2 className="mt-3 text-base font-semibold text-slate-950">Site controls</h2>
              <p className="mt-1 text-sm text-slate-600">Branding, visible sections, local tools, and server capability access.</p>
            </div>
            <button type="button" onClick={() => void saveSettings()} disabled={savingSettings} className="inline-flex items-center justify-center gap-2 bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60">
              <FiSave aria-hidden="true" /> {savingSettings ? 'Saving' : 'Save changes'}
            </button>
          </div>

          {settingsMessage && <p className={`mt-4 border p-3 text-sm ${settingsMessage.includes('saved') ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'}`}>{settingsMessage}</p>}

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-slate-950">Brand and homepage</h3>
              <label className="block text-sm font-medium text-slate-700">Site name<input value={draftSettings.branding.siteName} onChange={(event) => updateSetting('branding', 'siteName', event.target.value)} maxLength={80} className="mt-1.5 w-full border border-slate-300 px-3 py-2 text-slate-950" /></label>
              <label className="block text-sm font-medium text-slate-700">Homepage title<input value={draftSettings.branding.homeTitle} onChange={(event) => updateSetting('branding', 'homeTitle', event.target.value)} maxLength={120} className="mt-1.5 w-full border border-slate-300 px-3 py-2 text-slate-950" /></label>
              <label className="block text-sm font-medium text-slate-700">Homepage description<textarea value={draftSettings.branding.homeDescription} onChange={(event) => updateSetting('branding', 'homeDescription', event.target.value)} maxLength={300} rows={4} className="mt-1.5 w-full border border-slate-300 px-3 py-2 text-slate-950" /></label>
              <div className="grid grid-cols-2 gap-4"><label className="block text-sm font-medium text-slate-700">Primary color<input type="color" value={draftSettings.branding.primaryColor} onChange={(event) => updateSetting('branding', 'primaryColor', event.target.value.toUpperCase())} className="mt-1.5 block h-10 w-full border border-slate-300 bg-white p-1" /></label><label className="block text-sm font-medium text-slate-700">Base template<select value={draftSettings.branding.template} onChange={(event) => updateSetting('branding', 'template', event.target.value)} className="mt-1.5 w-full border border-slate-300 bg-white px-3 py-2 text-slate-950"><option value="standard">Standard</option><option value="focused">Focused</option></select></label></div>
            </div>

            <div className="space-y-6">
              <div>
                <h3 className="text-sm font-semibold text-slate-950">Visible sections</h3>
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  {Object.entries({ showCapabilities: 'Capabilities', showDashboard: 'Dashboard', showUpload: 'Upload' }).map(([key, label]) => <label key={key} className="flex items-center gap-2 border border-slate-200 p-3 text-sm font-medium text-slate-700"><input type="checkbox" checked={draftSettings.sections[key]} onChange={(event) => updateSetting('sections', key, event.target.checked)} />{label}</label>)}
                </div>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-950">Browser tools</h3>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {Object.entries({ localUpload: 'Local file import', urlImport: 'HTTPS URL import', dataAssistant: 'Data assistant', reports: 'Printable reports', exports: 'Exports' }).map(([key, label]) => <label key={key} className="flex items-center gap-2 border border-slate-200 p-3 text-sm font-medium text-slate-700"><input type="checkbox" checked={draftSettings.features[key]} onChange={(event) => updateSetting('features', key, event.target.checked)} />{label}</label>)}
                </div>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-950">Server capability access</h3>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {Object.entries({ serverWorkspace: 'Datasets', serverAnalytics: 'Analysis', serverLayouts: 'Saved layouts', serverExports: 'Server exports', aiLayoutSuggestions: 'Optional AI dashboard suggestions' }).map(([key, label]) => <label key={key} className="block text-sm font-medium text-slate-700">{label}<select value={draftSettings.features[key]} onChange={(event) => updateSetting('features', key, event.target.value)} className="mt-1.5 w-full border border-slate-300 bg-white px-3 py-2 text-slate-950"><option value="disabled">Disabled</option><option value="authenticated">Authenticated users</option><option value="admin">Administrators only</option></select></label>)}
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </section>
  );
}
