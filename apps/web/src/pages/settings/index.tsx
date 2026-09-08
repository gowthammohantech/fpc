import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { TDS_SECTIONS, formatBasisPoints, roleLabel } from '@fpc/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { formatDate, humanize } from '@/lib/format';
import { Modal, Money, StatusBadge } from '@/components/ui';
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
        {
          header: 'GSTIN',
          render: (row) => <span className="font-mono text-xs">{row.gstin ?? '—'}</span>,
        },
        {
          header: 'Invoice inbox',
          render: (row) =>
            row.invoiceInboxAddress ?? <span className="text-slate-400">Not configured</span>,
        },
        {
          header: 'Status',
          render: (row) => <StatusBadge status={row.active ? 'ACTIVE' : 'INACTIVE'} />,
        },
      ]}
      fields={[
        { name: 'name', label: 'Name', required: true },
        { name: 'legalName', label: 'Legal name' },
        { name: 'gstin', label: 'GSTIN' },
        { name: 'cin', label: 'CIN' },
        {
          name: 'invoiceInboxAddress',
          label: 'Shared invoice mailbox',
          type: 'email',
          help: 'A mailbox the platform monitors for everyone. To pull invoices from your own Outlook instead, use Invoice Mailbox under Operations.',
        },
      ]}
    />
  );
}

/**
 * Groups — the only organisation level above the legal entity, so unlike every
 * other master it carries no company.
 */
export function GroupsPage() {
  return (
    <CrudPage
      title="Groups"
      subtitle="Sits above the legal entity, so a CFO can see the whole group at once"
      queryKey="settings-groups"
      permissions={{
        read: 'group:read',
        create: 'group:create',
        update: 'group:update',
        delete: 'group:delete',
      }}
      list={(query) => api.settings.groups(query)}
      create={(body) => api.settings.createGroup(body)}
      update={(id, body) => api.settings.updateGroup(id, body)}
      remove={(id) => api.settings.deleteGroup(id)}
      columns={[
        { header: 'Name', render: (row) => <span className="font-medium">{row.name}</span> },
        { header: 'Code', render: (row) => <span className="font-mono text-xs">{row.code}</span> },
        {
          header: 'Status',
          render: (row) => <StatusBadge status={row.active ? 'ACTIVE' : 'INACTIVE'} />,
        },
      ]}
      fields={[
        { name: 'name', label: 'Name', required: true },
        { name: 'code', label: 'Code', required: true },
      ]}
    />
  );
}

export function RegionsPage() {
  return (
    <CrudPage
      title="Regions"
      subtitle="Geographic grouping used to filter invoices, payments and reports"
      queryKey="settings-regions"
      permissions={{
        read: 'region:read',
        create: 'region:create',
        update: 'region:update',
        delete: 'region:delete',
      }}
      list={(query) => api.settings.regions(query)}
      create={(body) => api.settings.createRegion(body)}
      update={(id, body) => api.settings.updateRegion(id, body)}
      remove={(id) => api.settings.deleteRegion(id)}
      columns={[
        { header: 'Name', render: (row) => <span className="font-medium">{row.name}</span> },
        { header: 'Code', render: (row) => <span className="font-mono text-xs">{row.code}</span> },
        {
          header: 'Status',
          render: (row) => <StatusBadge status={row.active ? 'ACTIVE' : 'INACTIVE'} />,
        },
      ]}
      fields={[
        { name: 'name', label: 'Name', required: true },
        { name: 'code', label: 'Code', required: true },
      ]}
    />
  );
}

/**
 * Verticals — the first rung of the revised approval ladder.
 *
 * The head is load-bearing in the same way a department head is: VERTICAL_HEAD
 * approval steps resolve through it.
 */
export function VerticalsPage() {
  const { companyId } = useAuth();

  const { data: users } = useQuery({
    queryKey: ['users', 'for-verticals', companyId],
    queryFn: () => api.settings.users({ companyId, pageSize: 200 }),
  });

  const userName = (id: string | undefined) => users?.items.find((user) => user.id === id)?.name;

  return (
    <CrudPage
      title="Verticals"
      subtitle="Business lines. Approval routes through the vertical head before finance."
      queryKey="settings-verticals"
      permissions={{
        read: 'vertical:read',
        create: 'vertical:create',
        update: 'vertical:update',
        delete: 'vertical:delete',
      }}
      list={(query) => api.settings.verticals(query)}
      create={(body) => api.settings.createVertical(body)}
      update={(id, body) => api.settings.updateVertical(id, body)}
      remove={(id) => api.settings.deleteVertical(id)}
      columns={[
        { header: 'Name', render: (row) => <span className="font-medium">{row.name}</span> },
        { header: 'Code', render: (row) => <span className="font-mono text-xs">{row.code}</span> },
        {
          header: 'Head',
          render: (row) =>
            row.headUserId ? (
              (userName(row.headUserId) ?? 'Unknown user')
            ) : (
              <span className="text-amber-700">Not set — approvals fall back to any head</span>
            ),
        },
        {
          header: 'Status',
          render: (row) => <StatusBadge status={row.active ? 'ACTIVE' : 'INACTIVE'} />,
        },
      ]}
      fields={[
        { name: 'name', label: 'Name', required: true },
        { name: 'code', label: 'Code', required: true },
        {
          name: 'headUserId',
          label: 'Vertical head',
          type: 'select',
          options: (users?.items ?? []).map((user) => ({ value: user.id, label: user.name })),
          help: 'Approval rules with a "Vertical head" step route to this person.',
        },
      ]}
      toFormValues={(row) => ({ name: row.name, code: row.code, headUserId: row.headUserId ?? '' })}
    />
  );
}

export function BusinessUnitsPage() {
  const { companyId } = useAuth();

  const { data: verticals } = useQuery({
    queryKey: ['verticals', 'for-business-units', companyId],
    queryFn: () => api.settings.verticals({ companyId, pageSize: 200 }),
  });

  const verticalName = (id: string | undefined) =>
    verticals?.items.find((vertical) => vertical.id === id)?.name;

  return (
    <CrudPage
      title="Business units"
      subtitle="Units within a vertical. A classified unit is visible only to users granted it by name."
      queryKey="settings-business-units"
      permissions={{
        read: 'business_unit:read',
        create: 'business_unit:create',
        update: 'business_unit:update',
        delete: 'business_unit:delete',
      }}
      list={(query) => api.settings.businessUnits(query)}
      create={(body) => api.settings.createBusinessUnit(body)}
      update={(id, body) => api.settings.updateBusinessUnit(id, body)}
      remove={(id) => api.settings.deleteBusinessUnit(id)}
      columns={[
        { header: 'Name', render: (row) => <span className="font-medium">{row.name}</span> },
        { header: 'Code', render: (row) => <span className="font-mono text-xs">{row.code}</span> },
        { header: 'Vertical', render: (row) => verticalName(row.verticalId) ?? '—' },
        { header: 'Visibility', render: (row) => <StatusBadge status={row.kind} /> },
        {
          header: 'Status',
          render: (row) => <StatusBadge status={row.active ? 'ACTIVE' : 'INACTIVE'} />,
        },
      ]}
      fields={[
        { name: 'name', label: 'Name', required: true },
        { name: 'code', label: 'Code', required: true },
        {
          name: 'verticalId',
          label: 'Vertical',
          type: 'select',
          required: true,
          options: (verticals?.items ?? []).map((vertical) => ({
            value: vertical.id,
            label: vertical.name,
          })),
        },
        {
          name: 'kind',
          label: 'Visibility',
          type: 'select',
          options: [
            { value: 'STANDARD', label: 'Standard' },
            { value: 'CLASSIFIED', label: 'Classified' },
          ],
          help: 'A classified unit stays hidden unless a user is granted it by name — holding the vertical above it is not enough.',
        },
      ]}
      toFormValues={(row) => ({
        name: row.name,
        code: row.code,
        verticalId: row.verticalId,
        kind: row.kind,
      })}
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
        {
          header: 'Status',
          render: (row) => <StatusBadge status={row.active ? 'ACTIVE' : 'INACTIVE'} />,
        },
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

/**
 * Departments — PRD §7, §9.
 *
 * The load-bearing field is the head: DEPARTMENT_HEAD approval steps resolve
 * through it, so without this screen the PRD §15 ₹1L–₹10L and >₹10L ladders
 * could not be configured at all without direct API access.
 */
export function DepartmentsPage() {
  const { companyId } = useAuth();

  const { data: users } = useQuery({
    queryKey: ['users', 'for-departments', companyId],
    queryFn: () => api.settings.users({ companyId, pageSize: 200 }),
  });

  const { data: verticals } = useQuery({
    queryKey: ['verticals', 'for-departments', companyId],
    queryFn: () => api.settings.verticals({ companyId, pageSize: 200 }),
  });

  const userName = (id: string | undefined) => users?.items.find((user) => user.id === id)?.name;
  const verticalName = (id: string | undefined) =>
    verticals?.items.find((vertical) => vertical.id === id)?.name;

  return (
    <CrudPage
      title="Departments"
      subtitle="Used to route approvals and to filter invoices, payroll and reports"
      queryKey="settings-departments"
      permissions={{
        read: 'department:read',
        create: 'department:create',
        update: 'department:update',
        delete: 'department:delete',
      }}
      list={(query) => api.settings.departments(query)}
      create={(body) => api.settings.createDepartment(body)}
      update={(id, body) => api.settings.updateDepartment(id, body)}
      remove={(id) => api.settings.deleteDepartment(id)}
      columns={[
        { header: 'Name', render: (row) => <span className="font-medium">{row.name}</span> },
        { header: 'Code', render: (row) => <span className="font-mono text-xs">{row.code}</span> },
        { header: 'Vertical', render: (row) => verticalName(row.verticalId) ?? '—' },
        {
          header: 'Head',
          render: (row) =>
            row.headUserId ? (
              (userName(row.headUserId) ?? 'Unknown user')
            ) : (
              <span className="text-amber-700">Not set — approvals fall back to any approver</span>
            ),
        },
        {
          header: 'Status',
          render: (row) => <StatusBadge status={row.active ? 'ACTIVE' : 'INACTIVE'} />,
        },
      ]}
      fields={[
        { name: 'name', label: 'Name', required: true },
        { name: 'code', label: 'Code', required: true, help: 'Short code used in payroll files.' },
        {
          name: 'verticalId',
          label: 'Vertical',
          type: 'select',
          options: [
            { value: '', label: '—' },
            ...(verticals?.items ?? []).map((vertical) => ({
              value: vertical.id,
              label: vertical.name,
            })),
          ],
          help: 'Which business line this department reports into.',
        },
        {
          name: 'headUserId',
          label: 'Department head',
          type: 'select',
          options: (users?.items ?? []).map((user) => ({ value: user.id, label: user.name })),
          help: 'Approval rules with a "Department head" step route to this person.',
        },
      ]}
      toFormValues={(row) => ({
        name: row.name,
        code: row.code,
        verticalId: row.verticalId ?? '',
        headUserId: row.headUserId ?? '',
      })}
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
        {
          header: 'GSTIN',
          render: (row) => <span className="font-mono text-xs">{row.gstin ?? '—'}</span>,
        },
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
        {
          header: 'TDS',
          render: (row) =>
            row.tdsApplicable ? (
              <span>
                {row.tdsSection ?? '—'} ·{' '}
                {row.tdsRateBasisPoints ? formatBasisPoints(row.tdsRateBasisPoints) : '—'}
              </span>
            ) : (
              <span className="text-slate-400">None</span>
            ),
        },
        { header: 'Terms', render: (row) => `${row.paymentTermsDays} days` },
        { header: 'Status', render: (row) => <StatusBadge status={row.status} /> },
      ]}
      fields={[
        { name: 'name', label: 'Vendor name', required: true },
        { name: 'code', label: 'Vendor code', help: 'Generated automatically if left blank.' },
        {
          name: 'email',
          label: 'Email',
          type: 'email',
          help: 'Payment confirmations are sent here.',
        },
        { name: 'phone', label: 'Phone' },
        { name: 'gstin', label: 'GSTIN' },
        {
          name: 'pan',
          label: 'PAN',
          help: 'Required before TDS can be deducted — withholding needs an identified payee.',
        },
        {
          name: 'tdsApplicable',
          label: 'Deduct TDS',
          type: 'select',
          options: [
            { value: 'false', label: 'No' },
            { value: 'true', label: 'Yes' },
          ],
          help: 'A default only. The accounting team confirms or overrides it on each invoice.',
        },
        {
          name: 'tdsSection',
          label: 'TDS section',
          type: 'select',
          options: [
            { value: '', label: '—' },
            ...TDS_SECTIONS.map((section) => ({ value: section, label: section })),
          ],
        },
        {
          name: 'tdsRateBasisPoints',
          label: 'TDS rate (basis points)',
          type: 'number',
          help: '1000 is 10%, 75 is 0.75%. Stored as an integer so the deduction never drifts.',
        },
        {
          name: 'beneficiaryName',
          label: 'Beneficiary name',
          help: 'If it differs from the vendor name.',
        },
        { name: 'bankAccountNumber', label: 'Bank account number' },
        { name: 'ifsc', label: 'IFSC' },
        { name: 'paymentTermsDays', label: 'Payment terms (days)', type: 'number' },
        { name: 'notes', label: 'Notes' },
      ]}
      defaults={{ paymentTermsDays: 30 }}
      formColumns={2}
    />
  );
}

export function UsersPage() {
  const { companyId } = useAuth();
  const [invite, setInvite] = useState<{ email: string; url: string } | null>(null);

  const { data: companies } = useQuery({
    queryKey: ['companies'],
    queryFn: () => api.settings.companies({ pageSize: 100 }),
  });

  // The catalogue rather than the built-in list, so roles the tenant created
  // under Settings → Roles can be granted here too.
  const { data: roles } = useQuery({
    queryKey: ['roles'],
    queryFn: () => api.settings.roles(),
  });
  const roleLabels = Object.fromEntries((roles?.items ?? []).map((role) => [role.key, role.label]));

  return (
    <>
      {invite ? <InviteLinkModal invite={invite} onClose={() => setInvite(null)} /> : null}
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
        create={async (body) => {
          const created = await api.settings.createUser(body);
          // An account created without a password cannot sign in until this
          // link is used, so it is surfaced immediately rather than lost.
          if (created.inviteUrl) {
            setInvite({ email: created.email, url: created.inviteUrl });
          }
          return created;
        }}
        update={(id, body) => api.settings.updateUser(id, body)}
        remove={(id) => api.settings.deleteUser(id)}
        rowActions={(row) =>
          row.status === 'INVITED'
            ? [
                {
                  label: 'Resend invite',
                  run: async () => {
                    const result = await api.settings.reinviteUser(row.id);
                    setInvite({ email: row.email, url: result.inviteUrl });
                  },
                },
              ]
            : []
        }
        columns={[
          { header: 'Name', render: (row) => <span className="font-medium">{row.name}</span> },
          { header: 'Email', render: (row) => row.email },
          {
            header: 'Roles',
            render: (row) => row.roleKeys.map((role) => roleLabel(role, roleLabels)).join(', '),
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
          {
            header: 'Status',
            render: (row) => (
              <span className="flex items-center gap-2">
                <StatusBadge status={row.status} />
                {row.status === 'INVITED' ? (
                  <span className="text-xs text-slate-500">has not signed in yet</span>
                ) : null}
              </span>
            ),
          },
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
            name: 'status',
            label: 'Status',
            type: 'select',
            options: [
              { value: 'ACTIVE', label: 'Active' },
              { value: 'INVITED', label: 'Invited — cannot sign in yet' },
              { value: 'SUSPENDED', label: 'Suspended' },
            ],
            help: 'Only an active account can sign in.',
          },
          {
            name: 'roleKeys',
            label: 'Roles',
            type: 'multiselect',
            // A handful of roles, compared against each other — three columns
            // show all of them without a scrollbar.
            columns: 3,
            required: true,
            options: (roles?.items ?? [])
              .filter((role) => role.active)
              .map((role) => ({
                value: role.key,
                label: role.label,
                // The same count the Roles screen shows, so the weight of a
                // role is visible at the moment it is granted.
                hint: `${role.permissionCount} permissions`,
              })),
            help: 'Permissions are the union of the selected roles. See Roles for what each one grants.',
          },
          {
            name: 'companyIds',
            label: 'Companies',
            type: 'multiselect',
            columns: 2,
            options: (companies?.items ?? []).map((company) => ({
              value: company.id,
              label: company.name,
            })),
            help: 'Leave empty for access to every company in the tenant.',
          },
        ]}
        formColumns={2}
        defaults={{ roleKeys: [], companyIds: companyId ? [companyId] : [] }}
        toFormValues={(row) => ({
          name: row.name,
          email: row.email,
          roleKeys: row.roleKeys,
          companyIds: row.companyIds,
          status: row.status,
        })}
      />
    </>
  );
}

/**
 * Shows an invitation link once, right after it is issued.
 *
 * The token is never retrievable again — only its hash is stored — so this is
 * the single opportunity to hand it over.
 */
function InviteLinkModal({
  invite,
  onClose,
}: {
  invite: { email: string; url: string };
  onClose(): void;
}) {
  const link = `${window.location.origin}${invite.url}`;
  const [copied, setCopied] = useState(false);

  return (
    <Modal
      title="Invitation created"
      onClose={onClose}
      footer={
        <button className="btn-primary" onClick={onClose}>
          Done
        </button>
      }
    >
      <p className="text-sm text-slate-600">
        Send this link to <span className="font-medium">{invite.email}</span>. They will set their
        own password and the account becomes active. It expires in seven days.
      </p>
      <p className="mt-3 break-all rounded-md bg-slate-50 p-3 font-mono text-xs">{link}</p>
      <button
        className="btn-secondary mt-3"
        onClick={() => {
          void navigator.clipboard?.writeText(link).then(() => setCopied(true));
        }}
      >
        {copied ? 'Copied' : 'Copy link'}
      </button>
      <p className="mt-3 text-xs text-slate-500">
        This link is shown only once. If it is lost, use “Resend invite” on the user row.
      </p>
    </Modal>
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
      remove={(id) => api.settings.deleteBankAccount(id)}
      columns={[
        { header: 'Label', render: (row) => <span className="font-medium">{row.label}</span> },
        { header: 'Bank', render: (row) => row.bankName },
        {
          header: 'Account',
          render: (row) => (
            <span className="font-mono text-xs">…{row.accountNumber.slice(-4)}</span>
          ),
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
