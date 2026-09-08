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
  /**
   * The vertical the user has narrowed to, if any.
   *
   * A view filter, not a permission: the server already restricts a scoped
   * user to their own verticals, and refuses one they were not granted. This
   * lets someone with several pick a lens to work through.
   */
  verticalId: string | undefined;
  setVerticalId(id: string | undefined): void;
}

const AuthContext = createContext<AuthState | null>(null);
const COMPANY_KEY = 'fpc.companyId';
const VERTICAL_KEY = 'fpc.verticalId';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Principal | null>(null);
  const [loading, setLoading] = useState(hasStoredSession());
  const [companyId, setCompanyIdState] = useState<string | undefined>(
    () => localStorage.getItem(COMPANY_KEY) ?? undefined,
  );
  const [verticalId, setVerticalIdState] = useState<string | undefined>(
    () => localStorage.getItem(VERTICAL_KEY) ?? undefined,
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
    // Verticals belong to a company, so a stale one would filter everything
    // away after a switch.
    localStorage.removeItem(VERTICAL_KEY);
    setVerticalIdState(undefined);
  }, []);

  const setVerticalId = useCallback((id: string | undefined) => {
    if (id) localStorage.setItem(VERTICAL_KEY, id);
    else localStorage.removeItem(VERTICAL_KEY);
    setVerticalIdState(id);
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
      verticalId,
      setVerticalId,
    }),
    [user, loading, login, logout, companyId, setCompanyId, verticalId, setVerticalId],
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
