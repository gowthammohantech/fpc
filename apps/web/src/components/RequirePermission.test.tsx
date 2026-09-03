import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import type { Permission, Principal } from '@fpc/shared';
import { renderWithProviders } from '../test/render';
import { RequirePermission } from './RequirePermission';

/**
 * Route gating is a usability boundary, not a security one — the server
 * enforces the same permissions independently. What these assert is that a
 * user is never shown a screen that would only return 403, and that the
 * refusal explains itself rather than looking like a failure.
 */
const authState = vi.hoisted(() => ({ current: null as unknown }));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => authState.current,
}));

function signedInAs(permissions: Permission[]) {
  authState.current = {
    user: { permissions } as Principal,
    loading: false,
    canAny: (...required: Permission[]) => required.some((entry) => permissions.includes(entry)),
  };
}

beforeEach(() => {
  authState.current = null;
});

describe('RequirePermission', () => {
  it('renders the page when the user holds the permission', () => {
    signedInAs(['invoice:read']);
    renderWithProviders(
      <RequirePermission permissions={['invoice:read']}>
        <p>Invoice register</p>
      </RequirePermission>,
    );
    expect(screen.getByText('Invoice register')).toBeInTheDocument();
  });

  it('accepts any one of several permissions', () => {
    signedInAs(['approval:read_all']);
    renderWithProviders(
      <RequirePermission permissions={['approval:read', 'approval:read_all']}>
        <p>Approvals</p>
      </RequirePermission>,
    );
    expect(screen.getByText('Approvals')).toBeInTheDocument();
  });

  it('withholds the page and explains why when the permission is missing', () => {
    // A finance executive reaching /payroll: the PRD requires salary data to
    // be invisible to them.
    signedInAs(['invoice:read']);
    renderWithProviders(
      <RequirePermission permissions={['payroll:read']}>
        <p>Salary register</p>
      </RequirePermission>,
    );

    expect(screen.queryByText('Salary register')).not.toBeInTheDocument();
    expect(screen.getByText(/do not have access/i)).toBeInTheDocument();
    expect(screen.getByText(/company administrator/i)).toBeInTheDocument();
  });

  it('shows a loading state instead of a refusal while the session resolves', () => {
    // Rendering the refusal first would flash "no access" at a user who has it.
    authState.current = { user: null, loading: true, canAny: () => false };
    renderWithProviders(
      <RequirePermission permissions={['invoice:read']}>
        <p>Invoice register</p>
      </RequirePermission>,
    );

    expect(screen.queryByText(/do not have access/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Invoice register')).not.toBeInTheDocument();
  });

  it('renders a page that requires no particular permission', () => {
    signedInAs([]);
    renderWithProviders(
      <RequirePermission permissions={[]}>
        <p>Open page</p>
      </RequirePermission>,
    );
    expect(screen.getByText('Open page')).toBeInTheDocument();
  });
});
