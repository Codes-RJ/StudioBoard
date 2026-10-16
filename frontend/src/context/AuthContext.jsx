import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import api from '../services/api';
import { SERVER_WORKSPACE_ENABLED, requireServerWorkspace } from '../config/workspace';

const AuthContext = createContext();

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authChecked, setAuthChecked] = useState(false);

  const refreshSession = useCallback(async () => {
    if (!SERVER_WORKSPACE_ENABLED) {
      setUser(null);
      setLoading(false);
      setAuthChecked(true);
      return null;
    }
    try {
      const { data } = await api.get('/auth/me');
      setUser(data);
      return data;
    } catch (error) {
      setUser(null);
      return null;
    } finally {
      setLoading(false);
      setAuthChecked(true);
    }
  }, []);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  const login = useCallback(async ({ email, password }) => {
    requireServerWorkspace();
    const { data } = await api.post('/auth/login', { email, password });
    setUser(data);
    setAuthChecked(true);
    return data;
  }, []);

  const logout = useCallback(async () => {
    if (SERVER_WORKSPACE_ENABLED) await api.post('/auth/logout');
    setUser(null);
    setAuthChecked(true);
  }, []);

  const value = useMemo(() => ({
    user,
    loading,
    authChecked,
    isAuthenticated: Boolean(user),
    login,
    logout,
    refreshSession
  }), [authChecked, loading, login, logout, refreshSession, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export default AuthContext;
