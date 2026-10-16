export const PUBLIC_ENV_NAMES = new Set(['VITE_API_BASE_URL', 'VITE_APP_NAME', 'VITE_APP_VERSION',
  'VITE_ENABLE_SERVER_WORKSPACE', 'VITE_ENABLE_EXPERIMENTAL_LOCAL_LLM', 'VITE_PUBLIC_SITE_URL', 'VITE_SOURCEMAP',
  'VITE_DEFAULT_PAGE_SIZE', 'VITE_MAX_PAGE_SIZE', 'VITE_ENABLE_NOTIFICATIONS', 'VITE_ENABLE_REAL_TIME']);
export function validatePublicEnv(...sources) {
  const names = new Set(sources.flatMap((source) => Object.keys(source || {})));
  const forbidden = [...names].filter((name) => name.startsWith('VITE_') && !PUBLIC_ENV_NAMES.has(name));
  if (forbidden.length) throw new Error(`Unreviewed public build environment names: ${forbidden.join(', ')}. VITE values are shipped to browsers; keep credentials server-side.`);
}
