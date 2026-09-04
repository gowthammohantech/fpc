import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Permission } from '@fpc/shared';
import { renderWithProviders } from '../../test/render';
import { RolesPage } from './Roles';

/**
 * The role editor is where a permission is granted, so what matters is that
 * the checkboxes always describe the role actually selected — a stale grid
 * would have an administrator saving one role's grants onto another.
 */
const authState = vi.hoisted(() => ({ permissions: [] as string[] }));
const roles = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    can: (permission: Permission) => authState.permissions.includes(permission),
  }),
}));

vi.mock('@/lib/api', () => ({
  api: {
    settings: {
      roles: () => roles.list(),
      createRole: (body: unknown) => roles.create(body),
      updateRole: (id: string, body: unknown) => roles.update(id, body),
      deleteRole: (id: string) => roles.remove(id),
    },
  },
}));

const CFO = {
  key: 'CFO',
  label: 'CFO',
  permissions: ['payroll:read', 'invoice:approve'],
  permissionCount: 2,
  system: true,
  active: true,
  userCount: 1,
};

const CLERK = {
  id: 'role-1',
  key: 'INVOICE_CLERK',
  label: 'Invoice Clerk',
  description: 'Files invoices',
  permissions: ['invoice:read'],
  permissionCount: 1,
  system: false,
  active: true,
  userCount: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  authState.permissions = ['role:read', 'role:create', 'role:update', 'role:delete'];
  roles.list.mockResolvedValue({ items: [CFO, CLERK] });
});

describe('RolesPage', () => {
  it('shows the selected role’s grants as checkboxes and swaps them when another is picked', async () => {
    renderWithProviders(<RolesPage />);

    // The first role in the catalogue is selected on arrival.
    await waitFor(() => expect(screen.getByLabelText('payroll:read')).toBeChecked());
    expect(screen.getByLabelText('invoice:approve')).toBeChecked();
    expect(screen.getByLabelText('invoice:read')).not.toBeChecked();

    await userEvent.click(screen.getByRole('button', { name: /Invoice Clerk/ }));

    await waitFor(() => expect(screen.getByLabelText('invoice:read')).toBeChecked());
    expect(screen.getByLabelText('payroll:read')).not.toBeChecked();
    expect(screen.getByLabelText('invoice:approve')).not.toBeChecked();
  });

  it('keeps a built-in role read-only', async () => {
    renderWithProviders(<RolesPage />);

    await waitFor(() => expect(screen.getByLabelText('payroll:read')).toBeDisabled());
    expect(screen.getByText(/Built-in roles cannot be changed/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
  });

  it('saves the ticked permissions for a custom role', async () => {
    roles.update.mockResolvedValue({ ...CLERK, permissions: ['invoice:read', 'invoice:create'] });
    renderWithProviders(<RolesPage />);

    await userEvent.click(await screen.findByRole('button', { name: /Invoice Clerk/ }));
    await userEvent.click(screen.getByLabelText('invoice:create'));
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(roles.update).toHaveBeenCalledWith('role-1', {
        label: 'Invoice Clerk',
        description: 'Files invoices',
        permissions: ['invoice:read', 'invoice:create'],
      }),
    );
  });

  it('creates a role from a name and a set of ticked permissions', async () => {
    roles.create.mockResolvedValue({ ...CLERK, id: 'role-2', key: 'PAYMENTS_CLERK' });
    renderWithProviders(<RolesPage />);

    await userEvent.click(await screen.findByRole('button', { name: 'Create role' }));

    // Scoped to the modal: the role detail behind it renders the same grid.
    const dialog = within(screen.getByRole('dialog', { name: 'Create role' }));
    await userEvent.type(dialog.getByLabelText(/Name/), 'Payments Clerk');
    await userEvent.click(dialog.getByLabelText('payment_batch:create'));
    await userEvent.click(dialog.getByRole('button', { name: 'Create role' }));

    await waitFor(() =>
      expect(roles.create).toHaveBeenCalledWith({
        label: 'Payments Clerk',
        permissions: ['payment_batch:create'],
      }),
    );
  });

  it('will not offer creation to someone without the permission', async () => {
    authState.permissions = ['role:read'];
    renderWithProviders(<RolesPage />);

    await screen.findByText('Invoice Clerk');
    expect(screen.queryByRole('button', { name: 'Create role' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('payroll:read')).toBeDisabled();
  });
});
