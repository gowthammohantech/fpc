import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeftRight,
  Bell,
  Building2,
  ChartColumn,
  ChevronDown,
  CircleCheck,
  CreditCard,
  FileText,
  GitBranch,
  Landmark,
  Layers,
  LayoutDashboard,
  LogOut,
  MapPin,
  Menu,
  Network,
  Plus,
  RefreshCcw,
  ScrollText,
  SendHorizontal,
  ShieldCheck,
  Store,
  Upload,
  UserCog,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { ROLE_LABELS, type Permission, type RoleKey } from '@fpc/shared';
import { api } from '@/lib/api';
import { formatCompactINR } from '@/lib/format';
import { useAuth } from '@/hooks/useAuth';
import { GlobalSearch } from './GlobalSearch';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
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
    items: [
      {
        to: '/dashboard',
        label: 'Dashboard',
        icon: LayoutDashboard,
        permissions: ['dashboard:read'],
      },
    ],
  },
  {
    title: 'Operations',
    items: [
      { to: '/invoices', label: 'Invoices', icon: FileText, permissions: ['invoice:read'] },
      {
        to: '/approvals',
        label: 'Approvals',
        icon: CircleCheck,
        permissions: ['approval:read', 'approval:read_all'],
      },
      { to: '/payables', label: 'Payables', icon: Wallet, permissions: ['payable:read'] },
      { to: '/payroll', label: 'Payroll', icon: Users, permissions: ['payroll:read'] },
    ],
  },
  {
    title: 'Treasury',
    items: [
      {
        to: '/payments',
        label: 'Payment Queue',
        icon: SendHorizontal,
        permissions: ['obligation:read'],
      },
      {
        to: '/payments/batches',
        label: 'Payment Batches',
        icon: Layers,
        permissions: ['payment_batch:read'],
      },
      {
        to: '/banking/statements',
        label: 'Bank Statements',
        icon: Landmark,
        permissions: ['bank_statement:read'],
      },
      {
        to: '/banking/transactions',
        label: 'Bank Transactions',
        icon: ArrowLeftRight,
        permissions: ['bank_transaction:read'],
      },
      {
        to: '/reconciliation',
        label: 'Reconciliation',
        icon: RefreshCcw,
        permissions: ['reconciliation:read'],
      },
    ],
  },
  {
    title: 'Insights',
    items: [
      { to: '/reports', label: 'Reports', icon: ChartColumn, permissions: ['report:read'] },
      { to: '/audit', label: 'Audit Trail', icon: ScrollText, permissions: ['audit:read'] },
    ],
  },
  {
    title: 'Administration',
    items: [
      {
        to: '/settings/companies',
        label: 'Companies',
        icon: Building2,
        permissions: ['company:read'],
      },
      {
        to: '/settings/locations',
        label: 'Locations',
        icon: MapPin,
        permissions: ['location:read'],
      },
      {
        to: '/settings/departments',
        label: 'Departments',
        icon: Network,
        permissions: ['department:read'],
      },
      { to: '/settings/vendors', label: 'Vendors', icon: Store, permissions: ['vendor:read'] },
      {
        to: '/settings/bank-accounts',
        label: 'Bank Accounts',
        icon: CreditCard,
        permissions: ['bank_account:read'],
      },
      { to: '/settings/users', label: 'Users', icon: UserCog, permissions: ['user:read'] },
      { to: '/settings/roles', label: 'Roles', icon: ShieldCheck, permissions: ['role:read'] },
      {
        to: '/settings/approvals',
        label: 'Approval Rules',
        icon: GitBranch,
        permissions: ['approval_rule:read'],
      },
    ],
  },
];

/** Shortcuts to the things a role actually does, not to every screen it can see. */
const QUICK_ACTIONS: Array<{
  to: string;
  label: string;
  icon: LucideIcon;
  permissions: Permission[];
}> = [
  {
    to: '/invoices?upload=1',
    label: 'Upload invoice',
    icon: Upload,
    permissions: ['invoice:create'],
  },
  {
    to: '/banking/statements',
    label: 'Import statement',
    icon: Landmark,
    permissions: ['bank_statement:create'],
  },
  { to: '/payroll/import', label: 'Import payroll', icon: Users, permissions: ['payroll:create'] },
  {
    to: '/reconciliation',
    label: 'Reconcile',
    icon: RefreshCcw,
    permissions: ['reconciliation:read'],
  },
];

export function Layout() {
  const { user, logout, can, canAny, companyId, setCompanyId } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

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

  // The same key the dashboard uses, so on /dashboard this costs no request at
  // all and elsewhere it is one cheap summary shared by every screen.
  const { data: summary } = useQuery({
    queryKey: ['dashboard', companyId],
    queryFn: () => api.dashboard.summary({ companyId }),
    enabled: !!user && can('dashboard:read'),
  });

  // A drawer that survived navigation would cover the page it just opened.
  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setNavOpen(false);
      setMenuOpen(false);
    };
    const onClick = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, []);

  const visibleGroups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => canAny(...item.permissions)),
  })).filter((group) => group.items.length > 0);

  const quickActions = QUICK_ACTIONS.filter((action) => canAny(...action.permissions)).slice(0, 4);

  const sidebar = (
    <>
      <div className="flex items-center gap-3 px-5 py-5">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-700">
          <Wallet className="h-5 w-5 text-peridot-400" aria-hidden="true" />
        </span>
        <span className="min-w-0">
          <span className="block truncate font-semibold leading-tight text-ink-900">
            Finance Ops
          </span>
          <span className="block truncate text-xs leading-tight text-ink-500">
            Money-out operations
          </span>
        </span>
      </div>

      {summary ? (
        <div className="border-b border-ink-100 px-5 pb-5">
          <p className="nav-group-title px-0">Quick stats</p>
          <div className="space-y-3 pt-1">
            <Meter
              label="Awaiting approval"
              amount={summary.invoices.pendingApprovalAmount}
              total={summary.totalPayables}
              className="bg-brand-600"
            />
            <Meter
              label="Ready to pay"
              amount={summary.payments.readyForPayment}
              total={summary.totalPayables}
              className="bg-peridot-500"
            />
            <Meter
              label="Overdue"
              amount={summary.invoices.overdueAmount}
              total={summary.totalPayables}
              className="bg-amber-500"
            />
          </div>
          {summary.payrollHidden ? (
            <p className="mt-2 text-[11px] text-ink-400">Excludes payroll.</p>
          ) : null}
        </div>
      ) : null}

      <nav className="flex-1 overflow-y-auto px-3 pb-4">
        {visibleGroups.map((group) => (
          <div key={group.title ?? 'root'} className="mb-5">
            {group.title ? <p className="nav-group-title">{group.title}</p> : null}
            {group.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/payments'}
                className={({ isActive }) => `nav-item ${isActive ? 'nav-item-active' : ''}`}
              >
                <item.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                {item.label}
              </NavLink>
            ))}
          </div>
        ))}

        {quickActions.length ? (
          <div className="border-t border-ink-100 pt-4">
            <p className="nav-group-title">Quick actions</p>
            {quickActions.map((action) => (
              <NavLink key={action.to} to={action.to} className="nav-item">
                <span className="chip-neutral h-7 w-7 rounded-lg">
                  <action.icon className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
                {action.label}
              </NavLink>
            ))}
          </div>
        ) : null}
      </nav>
    </>
  );

  return (
    <div className="flex min-h-screen bg-ink-50">
      <aside className="hidden w-72 shrink-0 flex-col border-r border-ink-200 bg-white lg:flex">
        {sidebar}
      </aside>

      {/* Below `lg` the sidebar is the only navigation there is, so it becomes a drawer. */}
      {navOpen ? (
        <div
          className="scrim z-40 lg:hidden"
          onClick={() => setNavOpen(false)}
          aria-hidden="true"
        />
      ) : null}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
        aria-hidden={!navOpen}
        className={`fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-ink-200 bg-white transition-transform duration-200 lg:hidden ${
          navOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {sidebar}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center gap-3 border-b border-ink-200 bg-white px-4 py-3 sm:px-6">
          <button
            className="btn-icon lg:hidden"
            onClick={() => setNavOpen(true)}
            aria-label="Open navigation"
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </button>

          <div className="mr-auto hidden min-w-0 md:block">
            <p className="truncate text-base font-semibold text-ink-900">
              Welcome back, {firstName(user?.name)}
            </p>
            <p className="truncate text-xs text-ink-500">Here is where the money stands today.</p>
          </div>

          <GlobalSearch />

          {companies && companies.items.length > 1 ? (
            <div className="relative hidden sm:block">
              <select
                className="input w-auto appearance-none rounded-full pr-9"
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
              <ChevronDown
                className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400"
                aria-hidden="true"
              />
            </div>
          ) : null}

          <NavLink
            to="/notifications"
            className="btn-icon"
            aria-label={
              unread && unread.count > 0 ? `Notifications, ${unread.count} unread` : 'Notifications'
            }
          >
            <Bell className="h-5 w-5" aria-hidden="true" />
            {unread && unread.count > 0 ? (
              <span className="absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-red-600 px-1 text-[10px] font-semibold leading-[18px] text-white ring-2 ring-white">
                {unread.count > 99 ? '99+' : unread.count}
              </span>
            ) : null}
          </NavLink>

          {can('invoice:create') ? (
            <NavLink to="/invoices?upload=1" className="btn-primary hidden sm:inline-flex">
              <Plus className="h-4 w-4" aria-hidden="true" />
              Upload invoice
            </NavLink>
          ) : null}

          <div className="relative" ref={menuRef}>
            <button
              className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2 text-sm transition-colors hover:bg-ink-50"
              onClick={() => setMenuOpen((open) => !open)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-800">
                {initials(user?.name)}
              </span>
              <span className="hidden text-left xl:block">
                <span className="block font-medium leading-tight text-ink-900">{user?.name}</span>
                <span className="block text-xs leading-tight text-ink-500">
                  {user?.roleKeys.map((role) => ROLE_LABELS[role as RoleKey]).join(', ')}
                </span>
              </span>
            </button>

            {menuOpen ? (
              <div className="menu absolute right-0 z-20 mt-1 w-48">
                <NavLink to="/account" className="menu-item" onClick={() => setMenuOpen(false)}>
                  Your account
                </NavLink>
                <button
                  className="menu-item flex items-center gap-2"
                  onClick={() => {
                    setMenuOpen(false);
                    void logout().then(() => navigate('/login'));
                  }}
                >
                  <LogOut className="h-4 w-4" aria-hidden="true" />
                  Sign out
                </button>
              </div>
            ) : null}
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

/**
 * One quick-stat bar.
 *
 * Every bar shares `totalPayables` as its denominator so the three are honestly
 * comparable; with nothing outstanding there is no proportion to draw.
 */
function Meter({
  label,
  amount,
  total,
  className,
}: {
  label: string;
  amount: number;
  total: number;
  className: string;
}) {
  if (!total) return null;
  const percent = Math.min(100, Math.max(0, (amount / total) * 100));

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-ink-600">{label}</span>
        <span className="tabular text-xs font-semibold text-ink-900">
          {formatCompactINR(amount)}
        </span>
      </div>
      <div className="meter">
        <div className={`meter-bar ${className}`} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function firstName(name: string | undefined): string {
  if (!name) return 'there';
  return name.split(' ')[0] ?? name;
}

function initials(name: string | undefined): string {
  if (!name) return '?';
  return name
    .split(' ')
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}
