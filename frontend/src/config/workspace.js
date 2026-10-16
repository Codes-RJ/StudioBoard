// Browser-only is the default. Legacy server operation requires a separate,
// explicitly opted-in build; browser settings cannot change this boundary.
export const SERVER_WORKSPACE_ENABLED = import.meta.env.VITE_ENABLE_SERVER_WORKSPACE === 'true';

export const requireServerWorkspace = () => {
  if (!SERVER_WORKSPACE_ENABLED) {
    const error = new Error('Server requests are disabled in this browser-only workspace.');
    error.code = 'LOCAL_ONLY_WORKSPACE';
    throw error;
  }
};
