import { useQuery } from '@tanstack/react-query';
import { ROLE_KEYS, ROLE_LABELS, type RoleKey } from '@fpc/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { formatDate, humanize } from '@/lib/format';
import { Card, Money, PageHeader, Spinner, StatusBadge } from '@/components/ui';
import { CrudPage } from './CrudPage';

export function CompaniesPage() {
  return (
    <CrudPage
      title="Companies"
      subtitle="Legal entities whose payments this platform handles"
      queryKey="settings-companies"
      permissions={{
        read: 'company:read',
        create: 'company:create',
        update: 'company:update',
      }}
      list={(query) => api.settings.companies(query)}
      create={(body) => api.settings.createCompany(body)}
      update={(id, body) => api.settings.updateCompany(id, body)}
      columns={[
        { header: 'Name', render: (row) => <span className="font-medium">{row.name}</span> },
        { header: 'Legal name', render: (row) => row.legalName ?? '—' },
        { header: 'GSTIN', render: (row) => <span className="font-mono text-xs">{row.gstin ?? '—'}</span> },
        {
          header: 'Invoice inbox',
          render: (row) => row.invoiceInboxAddress ?? <span className="text-slate-400">Not configured</span>,
        },
        { header: 'Status', render: (row) => <StatusBadge status={row.active ? 'ACTIVE' : 'INACTIVE'} /> },
      ]}
      fields={[
        { name: 'name', label: 'Name', required: true },
        { name: 'legalName', label: 'Legal name' },
        { name: 'gstin', label: 'GSTIN' },
        { name: 'cin', label: 'CIN' },
        {
          name: 'invoiceInboxAddress',
          label: 'Invoice mailbox',
          type: 'email',
          help: 'Vendor invoices sent here are ingested automatically.',
        },
      ]}
    />
  );
}

export function LocationsPage() {
  return (
    <CrudPage
      title="Locations"
      subtitle="Branches and offices used to filter invoices, payroll and reports"
      queryKey="settings-locations"
      permissions={{
        read: 'location:read',
        create: 'location:create',
        update: 'location:update',
        delete: 'location:delete',
      }}
      list={(query) => api.settings.locations(query)}
      create={(body) => api.settings.createLocation(body)}
      update={(id, body) => api.settings.updateLocation(id, body)}
      remove={(id) => api.settings.deleteLocation(id)}
      columns={[
        { header: 'Name', render: (row) => <span className="font-medium">{row.name}</span> },
        { header: 'Code', render: (row) => <span className="font-mono text-xs">{row.code}</span> },
        { header: 'City', render: (row) => row.city ?? '—' },
        { header: 'State', render: (row) => row.state ?? '—' },
        { header: 'Status', render: (row) => <StatusBadge status={row.active ? 'ACTIVE' : 'INACTIVE'} /> },
      ]}
      fields={[
        { name: 'name', label: 'Name', required: true },
        { name: 'code', label: 'Code', required: true, help: 'Short code used in payroll files.' },
        { name: 'city', label: 'City' },
        { name: 'state', label: 'State' },
      ]}
    />
  );
}

export function VendorsPage() {
  return (
    <CrudPage
      title="Vendors"
      subtitle="Payment details used when an approved invoice becomes an obligation"
      queryKey="settings-vendors"
      permissions={{
        read: 'vendor:read',
        create: 'vendor:create',
        update: 'vendor:update',
        delete: 'vendor:delete',
      }}
      list={(query) => api.settings.vendors(query)}
      create={(body) => api.settings.createVendor(body)}
      update={(id, body) => api.settings.updateVendor(id, body)}
      remove={(id) => api.settings.deleteVendor(id)}
      columns={[
        { header: 'Name', render: (row) => <span className="font-medium">{row.name}</span> },
        { header: 'Code', render: (row) => <span className="font-mono text-xs">{row.code}</span> },
        { header: 'Email', render: (row) => row.email ?? '—' },
        { header: 'GSTIN', render: (row) => <span className="font-mono text-xs">{row.gstin ?? '—'}</span> },
        {
          header: 'Bank details',
          render: (row) =>
            row.bankAccountNumber && row.ifsc ? (
              <span className="font-mono text-xs">
                …{row.bankAccountNumber.slice(-4)} · {row.ifsc}
              </span>
            ) : (
              <span className="text-amber-700">Missing — cannot be paid</span>
            ),
        },
        { header: 'Terms', render: (row) => `${row.paymentTermsDays} days` },
        { header: 'Status', render: (row) => <StatusBadge status={row.status} /> },
      ]}
      fields={[
        { name: 'name', label: 'Vendor name', required: true },
        { name: 'code', label: 'Vendor code', help: 'Generated automatically if left blank.' },
        { name: 'email', label: 'Email', type: 'email', help: 'Payment confirmations are sent here.' },
        { name: 'phone', label: 'Phone' },
        { name: 'gstin', label: 'GSTIN' },
        { name: 'beneficiaryName', label: 'Beneficiary name', help: 'If it differs from the vendor name.' },
        { name: 'bankAccountNumber', label: 'Bank account number' },
        { name: 'ifsc', label: 'IFSC' },
        { name: 'paymentTermsDays', label: 'Payment terms (days)', type: 'number' },
        { name: 'notes', label: 'Notes' },
      ]}
      defaults={{ paymentTermsDays: 30 }}
    />
  );
}

export function UsersPage() {
  const { companyId } = useAuth();

  const { data: companies } = useQuery({
    queryKey: ['companies'],
    queryFn: () => api.settings.companies({ pageSize: 100 }),
  });

  return (
    <CrudPage
      title="Users"
      subtitle="Who can sign in, and what each of them may do"
      queryKey="settings-users"
      permissions={{
        read: 'user:read',
        create: 'user:create',
        update: 'user:update',
        delete: 'user:delete',
      }}
      list={(query) => api.settings.users(query)}
      create={(body) => api.settings.createUser(body)}
      update={(id, body) => api.settings.updateUser(id, body)}
      remove={(id) => api.settings.deleteUser(id)}
      columns={[
        { header: 'Name', render: (row) => <span className="font-medium">{row.name}</span> },
        { header: 'Email', render: (row) => row.email },
        {
          header: 'Roles',
          render: (row) => row.roleKeys.map((role) => ROLE_LABELS[role as RoleKey]).join(', '),
        },
        {
          header: 'Companies',
          render: (row) =>
            row.companyIds.length === 0
              ? 'All'
              : row.companyIds
                  .map((id) => companies?.items.find((company) => company.id === id)?.name ?? '—')
                  .join(', '),
        },
        { header: 'Last login', render: (row) => formatDate(row.lastLoginAt) },
        { header: 'Status', render: (row) => <StatusBadge status={row.status} /> },
      ]}
      fields={[
        { name: 'name', label: 'Full name', required: true },
        { name: 'email', label: 'Email', type: 'email', required: true },
        {
          name: 'password',
          label: 'Password',
          help: 'Leave blank to create the account as invited with a generated password.',
        },
        {
          name: 'roleKeys',
          label: 'Roles',
          type: 'multiselect',
          required: true,
          options: ROLE_KEYS.map((role) => ({ value: role, label: ROLE_LABELS[role as RoleKey] })),
          help: 'Permissions are the union of the selected roles.',
        },
        {
          name: 'companyIds',
          label: 'Companies',
          type: 'multiselect',
          options: (companies?.items ?? []).map((company) => ({
            value: company.id,
            label: company.name,
          })),
          help: 'Leave empty for access to every company in the tenant.',
        },
      ]}
      defaults={{ roleKeys: [], companyIds: companyId ? [companyId] : [] }}
      toFormValues={(row) => ({
        name: row.name,
        email: row.email,
        roleKeys: row.roleKeys,
        companyIds: row.companyIds,
      })}
    />
  );
}

/**
 * Role reference — PRD §7.
 *
 * Roles are fixed in code rather than editable rows: the MVP defines exactly
 * eight, and the permissions listed here are the same ones the API enforces.
 */
export function RolesPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['roles'],
    queryFn: () => api.settings.roles(),
  });

  if (isLoading) return <Spinner />;

  return (
    <>
      <PageHeader
        title="Roles"
        subtitle="What each role can do. These are enforced by the API, not just the interface."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        {data?.items.map((role) => (
          <Card key={role.key} className="p-5">
            <div className="flex items-baseline justify-between">
              <h2 className="font-semibold">{role.label}</h2>
              <span className="text-xs text-slate-500">{role.permissionCount} permissions</span>
            </div>
            <div className="mt-3 flex flex-wrap gap-1">
              {role.permissions.map((permission) => (
                <span
                  key={permission}
                  className={`rounded px-1.5 py-0.5 font-mono text-xs ${
                    permission.startsWith('payroll:')
                      ? 'bg-purple-100 text-purple-800'
                      : permission.endsWith(':approve')
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {permission}
                </span>
              ))}
            </div>
          </Card>
        ))}
      </div>

      <p className="mt-6 text-sm text-slate-500">
        Payroll permissions are shown in purple and approval permissions in green — the two
        separations the platform relies on. Change a user's roles under Users.
      </p>
    </>
  );
}

export function BankAccountsPage() {
  return (
    <CrudPage
      title="Bank Accounts"
      subtitle="Accounts payments are made from, and statements imported into"
      queryKey="settings-bank-accounts"
      permissions={{
        read: 'bank_account:read',
        create: 'bank_account:create',
        update: 'bank_account:update',
        delete: 'bank_account:delete',
      }}
      list={(query) => api.settings.bankAccounts(query)}
      create={(body) => api.settings.createBankAccount(body)}
      update={(id, body) => api.settings.updateBankAccount(id, body)}
      columns={[
        { header: 'Label', render: (row) => <span className="font-medium">{row.label}</span> },
        { header: 'Bank', render: (row) => row.bankName },
        {
          header: 'Account',
          render: (row) => <span className="font-mono text-xs">…{row.accountNumber.slice(-4)}</span>,
        },
        { header: 'IFSC', render: (row) => <span className="font-mono text-xs">{row.ifsc}</span> },
        { header: 'File format', render: (row) => humanize(row.bankFileFormat) },
        {
          header: 'Balance',
          align: 'right',
          render: (row) => <Money minor={row.currentBalance} />,
        },
      ]}
      fields={[
        { name: 'label', label: 'Label', required: true },
        { name: 'bankName', label: 'Bank name', required: true },
        { name: 'accountNumber', label: 'Account number', required: true },
        { name: 'ifsc', label: 'IFSC', required: true },
        {
          name: 'bankFileFormat',
          label: 'Bank file format',
          type: 'select',
          options: [
            { value: 'HDFC', label: 'HDFC bulk payment' },
            { value: 'ICICI', label: 'ICICI corporate payment' },
            { value: 'GENERIC_XLSX', label: 'Generic Excel' },
            { value: 'GENERIC_CSV', label: 'Generic CSV' },
          ],
          help: 'Determines the layout of the file generated for this account.',
        },
      ]}
      defaults={{ bankFileFormat: 'GENERIC_XLSX' }}
    />
  );
}
