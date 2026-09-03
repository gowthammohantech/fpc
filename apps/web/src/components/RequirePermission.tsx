import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import type { Permission } from '@fpc/shared';
import { useAuth } from '@/hooks/useAuth';
import { Spinner } from './ui';

/**
 * Route guard.
 *
 * Client-side gating is a usability measure, not a security boundary — the
 * server independently enforces the same permission on every request. It
 * exists so users are not shown screens that would only return 403.
 */
export function RequirePermission({
  permissions,
  children,
}: {
  permissions: Permission[];
  children: ReactNode;
}) {
  const { user, loading, canAny } = useAuth();

  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace />;

  if (permissions.length && !canAny(...permissions)) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <h1 className="text-lg font-semibold text-slate-900">You do not have access to this page</h1>
        <p className="mt-2 text-sm text-slate-500">
          Your role does not include the permission this screen requires. If you need it, ask a
          company administrator to update your role.
        </p>
      </div>
    );
  }

  return <>{children}</>;
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}
