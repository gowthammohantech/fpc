import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ROLE_LABELS, type RoleKey } from '@fpc/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { Card, ErrorState, PageHeader } from '@/components/ui';

/**
 * The signed-in user's own account.
 *
 * Changing a password ends every other session server-side, which is stated
 * here so it is not a surprise.
 */
export function AccountPage() {
  const { user } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');

  const change = useMutation({
    mutationFn: () => api.auth.changePassword(currentPassword, newPassword),
    onSuccess: () => {
      setCurrentPassword('');
      setNewPassword('');
      setConfirm('');
    },
  });

  const mismatch = confirm.length > 0 && newPassword !== confirm;
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    change.mutate();
  };

  return (
    <>
      <PageHeader title="Your account" />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="font-semibold">Profile</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500">Name</dt>
              <dd className="font-medium">{user?.name}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Email</dt>
              <dd>{user?.email}</dd>
            </div>
            <div className="flex justify-between gap-6">
              <dt className="text-slate-500">Roles</dt>
              <dd className="text-right">
                {user?.roleKeys.map((role) => ROLE_LABELS[role as RoleKey]).join(', ')}
              </dd>
            </div>
          </dl>
          <p className="mt-4 text-xs text-slate-500">
            Your roles determine what you can do. Ask a company administrator to change them.
          </p>
        </Card>

        <Card className="p-5">
          <h2 className="font-semibold">Change password</h2>
          <form onSubmit={onSubmit} className="mt-4 space-y-4">
            <div>
              <label className="label" htmlFor="current">
                Current password
              </label>
              <input
                id="current"
                className="input"
                type="password"
                autoComplete="current-password"
                required
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
              />
            </div>
            <div>
              <label className="label" htmlFor="new">
                New password
              </label>
              <input
                id="new"
                className="input"
                type="password"
                autoComplete="new-password"
                required
                minLength={10}
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
              />
              <p className="mt-1 text-xs text-slate-500">
                At least 10 characters, with an uppercase letter, a lowercase letter and a digit.
              </p>
            </div>
            <div>
              <label className="label" htmlFor="confirmNew">
                Confirm new password
              </label>
              <input
                id="confirmNew"
                className="input"
                type="password"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
              />
              {mismatch ? (
                <p className="mt-1 text-xs text-red-600">The two passwords do not match.</p>
              ) : null}
            </div>

            <button
              className="btn-primary"
              type="submit"
              disabled={change.isPending || mismatch || newPassword.length < 10}
            >
              {change.isPending ? 'Updating…' : 'Change password'}
            </button>

            {change.isSuccess ? (
              <p className="text-sm text-emerald-700">
                Password changed. Your other sessions have been signed out.
              </p>
            ) : null}
            {change.error ? <ErrorState error={change.error} /> : null}
          </form>
        </Card>
      </div>
    </>
  );
}
