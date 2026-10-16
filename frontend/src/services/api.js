import axios from 'axios';
import { requireServerWorkspace } from '../config/workspace';

const getCookie = (name) => document.cookie
  .split('; ')
  .find((entry) => entry.startsWith(`${name}=`))
  ?.split('=')
  .slice(1)
  .join('=');

export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ||
  (import.meta.env.DEV ? 'http://localhost:5000/api' : '/api');

export const resolveApiUrl = (path = '') => {
  requireServerWorkspace();
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return new URL(`${API_BASE_URL.replace(/\/$/, '')}${normalizedPath}`, window.location.origin).toString();
};

const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor
api.interceptors.request.use(
  (config) => {
    // Reject before the transport receives a URL or payload, including GETs.
    requireServerWorkspace();
    const method = (config.method || 'get').toLowerCase();
    if (!['get', 'head', 'options'].includes(method)) {
      const csrfToken = getCookie('csrf_token');
      if (csrfToken) {
        config.headers['X-CSRF-Token'] = csrfToken;
      }
    }
    return config;
  },
  (error) => Promise.reject(error)
);

export default api;
