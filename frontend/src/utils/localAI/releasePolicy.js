// Generation has not passed the fixture quality gate. Release builds default off.
export const experimentalLocalLLM = import.meta.env.VITE_ENABLE_EXPERIMENTAL_LOCAL_LLM === 'true';
export const requireLocalLLM = () => {
  if (!experimentalLocalLLM) throw new Error('Experimental LLM generation is disabled in this build. Use deterministic calculations or evidence search.');
};
