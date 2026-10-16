import { EMBEDDING_MODEL, EMBEDDING_REVISION, LLM_ASSET_BASE, LLM_LIBRARY_URL } from './models';
// Model workers cannot send POSTs, prompt-bearing URLs or requests to inference
// hosts. Browser-managed redirects from these fixed asset URLs are downloads.
const REMOTE_PREFIXES = [
  `https://huggingface.co/${EMBEDDING_MODEL}/resolve/${EMBEDDING_REVISION}/`,
  LLM_ASSET_BASE,
  LLM_LIBRARY_URL
];
export const isAllowedModelAsset = (url, { method = 'GET', body } = {}, localAssets = []) => {
  if (!['GET', 'HEAD'].includes(method.toUpperCase()) || body != null) return false;
  let parsed;
  try { parsed = new URL(url); } catch { return false; }
  if (parsed.username || parsed.password || parsed.hash || (parsed.search && parsed.search !== '?download=true')) return false;
  return localAssets.includes(parsed.href) || REMOTE_PREFIXES.some((prefix) => prefix.endsWith('.wasm') ? parsed.href === prefix : parsed.href.startsWith(prefix));
};
