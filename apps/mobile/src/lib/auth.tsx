import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { hasPermission, type Permission, type Principal } from '@fpc/shared';
import { api, apiClient, hasStoredSession, setSessionLostHandler } from './api';

interface AuthState {
  user: Principal | null;
  loading: boolean;
  login(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
  can(permission: Permission): boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Principal | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // A refresh failure signs the user out rather than leaving the app on a
    // screen whose every request will fail.
    setSessionLostHandler(() => setUser(null));

    void hasStoredSession().then(async (stored) => {
      if (!stored) {
        setLoading(false);
        return;
      }
      try {
        setUser(await api.auth.me());
      } catch {
        setUser(null);
      } finally {
        setLoading(false);
      }
    });

    return () => setSessionLostHandler(null);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const result = await apiClient.login(email, password);
    setUser(result.user);
  }, []);

  const logout = useCallback(async () => {
    await apiClient.logout().catch(() => undefined);
    setUser(null);
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      login,
      logout,
      can: (permission) => hasPermission(user?.permissions, permission),
    }),
    [user, loading, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
