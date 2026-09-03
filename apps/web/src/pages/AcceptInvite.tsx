import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { apiClient } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { ErrorState } from '@/components/ui';

/**
 * Redeems an invitation and signs the new user straight in.
 *
 * An invited account cannot log in until this happens, so this screen is the
 * only entry point for anyone an administrator has added.
 */
export function AcceptInvitePage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const token = params.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);

  if (user) return <Navigate to="/dashboard" replace />;

  const mismatch = confirm.length > 0 && password !== confirm;

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      // The response is a normal login, so the user lands signed in rather
      // than being bounced to a login screen straight afterwards.
      const result = await apiClient.request<{ accessToken: string; refreshToken: string; expiresIn: number }>(
        '/auth/accept-invite',
        { method: 'POST', body: { token, password }, anonymous: true },
      );
      await apiClient.adoptSession(result);
      window.location.assign('/dashboard');
    } catch (caught) {
      setError(caught);
      setSubmitting(false);
    }
  };

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
        <div className="card w-full max-w-sm p-6">
          <h1 className="text-lg font-semibold">This invitation link is incomplete</h1>
          <p className="mt-2 text-sm text-slate-500">
            It is missing its token. Ask your administrator to send a new invitation.
          </p>
          <button className="btn-secondary mt-4 w-full" onClick={() => navigate('/login')}>
            Go to sign in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <form onSubmit={onSubmit} className="card w-full max-w-sm p-6">
        <h1 className="text-xl font-semibold text-brand-700">Set your password</h1>
        <p className="mt-1 text-sm text-slate-500">
          Choose a password to activate your Finance Operations account.
        </p>

        {error ? (
          <div className="mt-4">
            <ErrorState error={error} />
          </div>
        ) : null}

        <div className="mt-5">
          <label className="label" htmlFor="password">New password</label>
          <input
            id="password"
            className="input"
            type="password"
            autoComplete="new-password"
            required
            minLength={10}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <p className="mt-1 text-xs text-slate-500">
            At least 10 characters, with an uppercase letter, a lowercase letter and a digit.
          </p>
        </div>

        <div className="mt-4">
          <label className="label" htmlFor="confirm">Confirm password</label>
          <input
            id="confirm"
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
          className="btn-primary mt-6 w-full"
          type="submit"
          disabled={submitting || mismatch || password.length < 10}
        >
          {submitting ? 'Activating…' : 'Activate account'}
        </button>
      </form>
    </div>
  );
}
