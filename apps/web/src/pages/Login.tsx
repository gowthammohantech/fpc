import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { AuthLayout } from '@/components/AuthLayout';
import { Spinner } from '@/components/ui';

export function LoginPage() {
  const { user, loading, login } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (loading) return <Spinner />;
  if (user) return <Navigate to={params.get('next') ?? '/dashboard'} replace />;

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      navigate(params.get('next') ?? '/dashboard', { replace: true });
    } catch (caught) {
      setError((caught as Error).message || 'Could not sign in');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout
      illustration="sign-in"
      headline="Every rupee out, accounted for."
      blurb="Invoices, approvals, payroll and reconciliation in one place."
    >
      <form onSubmit={onSubmit}>
        <img
          src="/elixir-mark.png"
          alt="Elixir Finance Ops"
          width={44}
          height={44}
          className="h-11 w-11 lg:hidden"
        />
        <h1 className="mt-4 text-2xl font-semibold tracking-tight text-ink-900 lg:mt-0">Sign in</h1>
        <p className="mt-1 text-sm text-ink-500">Continue to Elixir Finance Ops.</p>

        {error ? <div className="notice-danger mt-5">{error}</div> : null}

        <div className="mt-6">
          <label className="label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            className="input"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>

        <div className="mt-4">
          <label className="label" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            className="input"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>

        <button className="btn-primary mt-6 w-full" type="submit" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </AuthLayout>
  );
}
