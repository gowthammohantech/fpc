import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { hasPermission, type Permission, type Principal, type RoleKey } from '@fpc/shared';
import { api, apiClient, hasStoredSession } from '@/lib/api';

interface AuthState {
  user: Principal | null;
  loading: boolean;
  login(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
  /** True when the current user holds the permission. */
  can(permission: Permission): boolean;
  canAny(...permissions: Permission[]): boolean;
  hasRole(role: RoleKey): boolean;
  /** The company the user is currently working in. */
  companyId: string | undefined;
  setCompanyId(id: string): void;
}

const AuthContext = createContext<AuthState | null>(null);
const COMPANY_KEY = 'fpc.companyId';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Principal | null>(null);
  const [loading, setLoading] = useState(hasStoredSession());
  const [companyId, setCompanyIdState] = useState<string | undefined>(
    () => localStorage.getItem(COMPANY_KEY) ?? undefined,
  );

  // Restore the session on load. Permissions come from the server rather than
  // the token, so a role change takes effect on the next page load.
  useEffect(() => {
    if (!hasStoredSession()) {
      setLoading(false);
      return;
    }
    api.auth
      .me()
      .then((principal) => {
        setUser(principal);
        setCompanyIdState((current) => current ?? principal.companyIds[0]);
      })
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const result = await apiClient.login(email, password);
    setUser(result.user);
    setCompanyIdState((current) => current ?? result.user.companyIds[0]);
  }, []);

  const logout = useCallback(async () => {
    await apiClient.logout().catch(() => undefined);
    setUser(null);
  }, []);

  const setCompanyId = useCallback((id: string) => {
    localStorage.setItem(COMPANY_KEY, id);
    setCompanyIdState(id);
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      login,
      logout,
      can: (permission) => hasPermission(user?.permissions, permission),
      canAny: (...permissions) =>
        permissions.some((entry) => hasPermission(user?.permissions, entry)),
      hasRole: (role) => !!user?.roleKeys.includes(role),
      companyId,
      setCompanyId,
    }),
    [user, loading, login, logout, companyId, setCompanyId],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}

/** Convenience for the very common single-permission check. */
export function usePermission(permission: Permission): boolean {
  return useAuth().can(permission);
}
