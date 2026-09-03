import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ROLE_LABELS, type Permission, type RoleKey } from '@fpc/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { GlobalSearch } from './GlobalSearch';

interface NavItem {
  to: string;
  label: string;
  /** Hidden unless the user holds one of these. */
  permissions: Permission[];
}

/**
 * Navigation groups follow PRD §39 exactly: internal modules are not exposed
 * as menu items, and every entry is gated on the same permission the API
 * enforces, so the menu can never offer an action that would be refused.
 */
const NAV_GROUPS: Array<{ title: string | null; items: NavItem[] }> = [
  {
    title: null,
    items: [{ to: '/dashboard', label: 'Dashboard', permissions: ['dashboard:read'] }],
  },
  {
    title: 'Operations',
    items: [
      { to: '/invoices', label: 'Invoices', permissions: ['invoice:read'] },
      { to: '/approvals', label: 'Approvals', permissions: ['approval:read', 'approval:read_all'] },
      { to: '/payables', label: 'Payables', permissions: ['payable:read'] },
      { to: '/payroll', label: 'Payroll', permissions: ['payroll:read'] },
    ],
  },
  {
    title: 'Treasury',
    items: [
      { to: '/payments', label: 'Payment Queue', permissions: ['obligation:read'] },
      { to: '/payments/batches', label: 'Payment Batches', permissions: ['payment_batch:read'] },
      { to: '/banking/statements', label: 'Bank Statements', permissions: ['bank_statement:read'] },
      { to: '/banking/transactions', label: 'Bank Transactions', permissions: ['bank_transaction:read'] },
      { to: '/reconciliation', label: 'Reconciliation', permissions: ['reconciliation:read'] },
    ],
  },
  {
    title: 'Insights',
    items: [
      { to: '/reports', label: 'Reports', permissions: ['report:read'] },
      { to: '/audit', label: 'Audit Trail', permissions: ['audit:read'] },
    ],
  },
  {
    title: 'Administration',
    items: [
      { to: '/settings/companies', label: 'Companies', permissions: ['company:read'] },
      { to: '/settings/locations', label: 'Locations', permissions: ['location:read'] },
      { to: '/settings/departments', label: 'Departments', permissions: ['department:read'] },
      { to: '/settings/vendors', label: 'Vendors', permissions: ['vendor:read'] },
      { to: '/settings/bank-accounts', label: 'Bank Accounts', permissions: ['bank_account:read'] },
      { to: '/settings/users', label: 'Users', permissions: ['user:read'] },
      { to: '/settings/roles', label: 'Roles', permissions: ['role:read'] },
      { to: '/settings/approvals', label: 'Approval Rules', permissions: ['approval_rule:read'] },
    ],
  },
];

export function Layout() {
  const { user, logout, canAny, companyId, setCompanyId } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  const { data: companies } = useQuery({
    queryKey: ['companies'],
    queryFn: () => api.settings.companies({ pageSize: 100 }),
    enabled: !!user,
  });

  const { data: unread } = useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: () => api.notifications.unreadCount(),
    enabled: !!user,
    refetchInterval: 60_000,
  });

  const visibleGroups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => canAny(...item.permissions)),
  })).filter((group) => group.items.length > 0);

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-slate-200 bg-white lg:flex">
        <div className="border-b border-slate-200 px-5 py-4">
          <p className="text-sm font-semibold uppercase tracking-wider text-brand-700">Finance Ops</p>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4">
          {visibleGroups.map((group) => (
            <div key={group.title ?? 'root'} className="mb-5">
              {group.title ? (
                <p className="mb-1 px-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                  {group.title}
                </p>
              ) : null}
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/payments'}
                  className={({ isActive }) =>
                    `block rounded-md px-2 py-1.5 text-sm transition ${
                      isActive
                        ? 'bg-brand-50 font-medium text-brand-700'
                        : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                    }`
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-4 border-b border-slate-200 bg-white px-4 py-3">
          <GlobalSearch />

          {companies && companies.items.length > 1 ? (
            <select
              className="input w-auto"
              value={companyId ?? ''}
              onChange={(event) => setCompanyId(event.target.value)}
              aria-label="Company"
            >
              {companies.items.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
          ) : null}

          <NavLink
            to="/notifications"
            className="relative rounded-md px-2 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
          >
            Notifications
            {unread && unread.count > 0 ? (
              <span className="absolute -right-1 -top-1 rounded-full bg-red-600 px-1.5 text-xs font-medium text-white">
                {unread.count > 99 ? '99+' : unread.count}
              </span>
            ) : null}
          </NavLink>

          <div className="relative">
            <button
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-slate-50"
              onClick={() => setMenuOpen((open) => !open)}
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700">
                {initials(user?.name)}
              </span>
              <span className="hidden text-left sm:block">
                <span className="block font-medium leading-tight">{user?.name}</span>
                <span className="block text-xs leading-tight text-slate-500">
                  {user?.roleKeys.map((role) => ROLE_LABELS[role as RoleKey]).join(', ')}
                </span>
              </span>
            </button>

            {menuOpen ? (
              <div className="absolute right-0 z-20 mt-1 w-48 rounded-md border border-slate-200 bg-white py-1 shadow-lg">
                <NavLink
                  to="/account"
                  className="block px-4 py-2 text-left text-sm hover:bg-slate-50"
                  onClick={() => setMenuOpen(false)}
                >
                  Your account
                </NavLink>
                <button
                  className="block w-full px-4 py-2 text-left text-sm hover:bg-slate-50"
                  onClick={() => {
                    setMenuOpen(false);
                    void logout().then(() => navigate('/login'));
                  }}
                >
                  Sign out
                </button>
              </div>
            ) : null}
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function initials(name: string | undefined): string {
  if (!name) return '?';
  return name
    .split(' ')
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}
