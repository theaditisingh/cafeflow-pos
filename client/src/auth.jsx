import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, getToken, setToken, setUnauthorizedHandler } from './api.js';

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

export const NAV_ACCESS = {
  dashboard: ['OWNER', 'MANAGER'],
  pos: ['OWNER', 'MANAGER', 'CASHIER'],
  tables: ['OWNER', 'MANAGER', 'CASHIER'],
  orders: ['OWNER', 'MANAGER', 'CASHIER'],
  kitchen: ['OWNER', 'MANAGER', 'CASHIER', 'KITCHEN'],
  menu: ['OWNER', 'MANAGER'],
  inventory: ['OWNER', 'MANAGER'],
  customers: ['OWNER', 'MANAGER', 'CASHIER'],
  reports: ['OWNER', 'MANAGER'],
  settings: ['OWNER', 'MANAGER'],
};
export const homeFor = (role) => (role === 'KITCHEN' ? '/kitchen' : role === 'CASHIER' ? '/pos' : '/dashboard');

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(!!getToken());

  const logout = useCallback(() => { setToken(null); setUser(null); setSettings(null); }, []);
  const loadSettings = useCallback(() => api.get('/settings').then(setSettings).catch(() => {}), []);

  useEffect(() => {
    setUnauthorizedHandler(logout);
    if (!getToken()) return;
    api.get('/auth/me').then((u) => { setUser(u); loadSettings(); }).catch(logout).finally(() => setLoading(false));
  }, [logout, loadSettings]);

  const login = async (email, password) => {
    const r = await api.post('/auth/login', { email, password });
    setToken(r.token); setUser(r.user); loadSettings();
    return r.user;
  };
  return <AuthCtx.Provider value={{ user, settings, loading, login, logout, reloadSettings: loadSettings, can: (page) => NAV_ACCESS[page]?.includes(user?.role) }}>{children}</AuthCtx.Provider>;
}
