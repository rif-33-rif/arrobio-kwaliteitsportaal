import { createContext, useContext, useState, useCallback } from 'react';
import { api } from '../api/client.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const raw = localStorage.getItem('arro_user');
    return raw ? JSON.parse(raw) : null;
  });

  // Retourneert { mfaRequired: true, mfaToken } als een tweede stap nodig is,
  // anders wordt de gebruiker meteen ingelogd.
  const login = useCallback(async (email, password) => {
    const data = await api.post('/auth/login', { email, password });
    if (data.mfaRequired) return data;
    localStorage.setItem('arro_token', data.token);
    localStorage.setItem('arro_user', JSON.stringify(data.user));
    setUser(data.user);
    return data;
  }, []);

  const verifyMfa = useCallback(async (mfaToken, code) => {
    const data = await api.post('/auth/mfa/verify', { mfaToken, code });
    localStorage.setItem('arro_token', data.token);
    localStorage.setItem('arro_user', JSON.stringify(data.user));
    setUser(data.user);
    return data;
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('arro_token');
    localStorage.removeItem('arro_user');
    setUser(null);
  }, []);

  return <AuthContext.Provider value={{ user, login, verifyMfa, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
