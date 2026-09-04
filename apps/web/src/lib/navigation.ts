import {
  ArrowLeftRight,
  Building2,
  ChartColumn,
  CircleCheck,
  CreditCard,
  FileText,
  GitBranch,
  Landmark,
  Layers,
  LayoutDashboard,
  MapPin,
  Network,
  RefreshCcw,
  ScrollText,
  SendHorizontal,
  ShieldCheck,
  Store,
  UserCog,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import type { Permission } from '@fpc/shared';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Hidden unless the user holds one of these. */
  permissions: Permission[];
}

export interface NavGroup {
  title: string | null;
  items: NavItem[];
}

/**
 * Navigation groups follow PRD §39 exactly: internal modules are not exposed
 * as menu items, and every entry is gated on the same permission the API
 * enforces, so the menu can never offer an action that would be refused.
 *
 * The sidebar and the command palette both read this list, so a page can only
 * ever be reachable one way by accident.
 */
export const NAV_GROUPS: NavGroup[] = [
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
