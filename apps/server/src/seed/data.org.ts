import { RoleKey, toMinor } from '@fpc/shared';

/**
 * Organisation master data for the demo tenant.
 *
 * Amounts are written in rupees here for readability and converted to minor
 * units on the way in, so this file stays comparable with the PRD's figures.
 */

export const TENANT = { name: 'Nova Group', slug: 'nova' };

export const COMPANIES = [
  {
    key: 'engineering',
    name: 'Nova Engineering Pvt Ltd',
    legalName: 'Nova Engineering Private Limited',
    gstin: '33AABCN1234A1Z5',
    invoiceInboxAddress: 'invoice@nova-engineering.example.com',
  },
  {
    key: 'technologies',
    name: 'Nova Technologies Pvt Ltd',
    legalName: 'Nova Technologies Private Limited',
    gstin: '29AABCN9876B1Z2',
    invoiceInboxAddress: 'invoice@nova-technologies.example.com',
  },
];

/**
 * Location codes repeat across companies on purpose — both companies have a
 * Bengaluru office. Every lookup in the seed is therefore keyed by
 * `company:code`, never by code alone.
 */
export const LOCATIONS = [
  { company: 'engineering', name: 'Chennai', code: 'MAA', city: 'Chennai', state: 'Tamil Nadu' },
  { company: 'engineering', name: 'Bengaluru', code: 'BLR', city: 'Bengaluru', state: 'Karnataka' },
  { company: 'engineering', name: 'Pune', code: 'PNQ', city: 'Pune', state: 'Maharashtra' },
  {
    company: 'technologies',
    name: 'Hyderabad',
    code: 'HYD',
    city: 'Hyderabad',
    state: 'Telangana',
  },
  {
    company: 'technologies',
    name: 'Bengaluru',
    code: 'BLR',
    city: 'Bengaluru',
    state: 'Karnataka',
  },
];

export const DEPARTMENTS = [
  {
    company: 'engineering',
    name: 'Information Technology',
    code: 'IT',
    head: 'ithead@nova.example.com',
  },
  { company: 'engineering', name: 'Operations', code: 'OPS', head: 'opshead@nova.example.com' },
  { company: 'engineering', name: 'Finance', code: 'FIN' },
  {
    company: 'technologies',
    name: 'Engineering',
    code: 'ENG',
    head: 'techapprover@nova.example.com',
  },
  // Deliberately headless: the DEPARTMENT_HEAD approver type falls back to
  // whoever holds the generic APPROVER role, and this is what exercises it.
  { company: 'technologies', name: 'Operations', code: 'OPS' },
];

/**
 * Roles the tenant defined for itself, alongside the eight built-ins.
 *
 * Keys are deliberately not INVOICE_CLERK: the RBAC integration test creates a
 * role with that key and expects a 201, which a seeded row would turn into a
 * 409. Every permission below must be a member of PERMISSIONS.
 */
export const ROLES = [
  {
    key: 'AP_CLERK',
    label: 'Accounts Payable Clerk',
    description: 'Keys invoices and prepares payments. Cannot approve, and never sees payroll.',
    permissions: [
      'dashboard:read',
      'invoice:read',
      'invoice:create',
      'invoice:update',
      'invoice:submit',
      'vendor:read',
      'payable:read',
      'obligation:read',
      'payment_batch:read',
      'payment_batch:create',
      'report:read',
      'notification:read',
    ],
  },
  {
    key: 'TREASURY_VIEWER',
    label: 'Treasury Viewer',
    description: 'Read-only view of the bank position, payment batches and reconciliation.',
    permissions: [
      'dashboard:read',
      'bank_account:read',
      'bank_statement:read',
      'bank_transaction:read',
      'reconciliation:read',
      'payment_batch:read',
      'obligation:read',
      'report:read',
      'notification:read',
    ],
  },
];

/**
 * Emails the RBAC integration test creates for itself. A seeded account on any
 * of these would turn its expected 201 into a 409.
 */
export const RESERVED_EMAILS = [
  'newcomer@nova.example.com',
  'seconduser@nova.example.com',
  'clerk@nova.example.com',
  'ghost@nova.example.com',
];

/**
 * One user per role, so the RBAC model can be demonstrated by signing in as
 * each of them. Every account able to sign in uses the same password.
 */
export const DEMO_PASSWORD = 'FinanceOps@2026';

export interface UserSeed {
  name: string;
  email: string;
  roles: string[];
  companies: string[];
  /** Company-qualified location keys, e.g. `engineering:MAA`. */
  locations?: string[];
  status?: 'ACTIVE' | 'INVITED' | 'SUSPENDED';
  note: string;
}

export const USERS: UserSeed[] = [
  {
    name: 'Priya Nair',
    email: 'admin@nova.example.com',
    roles: [RoleKey.PLATFORM_ADMIN],
    companies: [],
    note: 'Platform administrator — full access across the tenant',
  },
  {
    name: 'Sanjay Rao',
    email: 'companyadmin@nova.example.com',
    roles: [RoleKey.COMPANY_ADMIN],
    companies: ['engineering', 'technologies'],
    note: 'Company administration and master data',
  },
  {
    name: 'Ravi Kumar',
    email: 'ravi@nova.example.com',
    roles: [RoleKey.FINANCE_EXECUTIVE],
    companies: ['engineering'],
    note: 'The PRD §7 example — prepares work, cannot approve, cannot see payroll',
  },
  {
    name: 'Meera Iyer',
    email: 'financemanager@nova.example.com',
    roles: [RoleKey.FINANCE_MANAGER],
    companies: ['engineering'],
    note: 'Finance Head in the approval chain; releases bank files',
  },
  {
    name: 'Arjun Menon',
    email: 'ithead@nova.example.com',
    roles: [RoleKey.APPROVER],
    companies: ['engineering'],
    note: 'IT Head — first approver on the TechZone invoice',
  },
  {
    name: 'Deepa Krishnan',
    email: 'opshead@nova.example.com',
    roles: [RoleKey.APPROVER],
    companies: ['engineering'],
    note: 'Operations Head — first approver on the Pune chain',
  },
  {
    name: 'Lakshmi Subramanian',
    email: 'cfo@nova.example.com',
    roles: [RoleKey.CFO],
    companies: ['engineering', 'technologies'],
    note: 'CFO — final approver, sees payroll',
  },
  {
    name: 'Divya Reddy',
    email: 'payroll@nova.example.com',
    roles: [RoleKey.PAYROLL_USER],
    companies: ['engineering'],
    note: 'Payroll only — no invoice access',
  },
  {
    name: 'Anand Pillai',
    email: 'auditor@nova.example.com',
    roles: [RoleKey.AUDITOR],
    companies: ['engineering', 'technologies'],
    note: 'Read-only across everything, including the audit trail',
  },
  {
    name: 'Nikhil Varma',
    email: 'apclerk@nova.example.com',
    roles: ['AP_CLERK'],
    companies: ['engineering'],
    note: 'Holds a role the tenant defined itself, not one of the eight built-ins',
  },
  {
    name: 'Farhan Qureshi',
    email: 'treasury@nova.example.com',
    roles: ['TREASURY_VIEWER', RoleKey.AUDITOR],
    companies: ['engineering', 'technologies'],
    note: 'Two roles at once — a custom role unioned with a built-in one',
  },
  {
    name: 'Kavya Menon',
    email: 'chennai.ap@nova.example.com',
    roles: [RoleKey.FINANCE_EXECUTIVE],
    companies: ['engineering'],
    locations: ['engineering:MAA'],
    note: 'Scoped to Chennai — the location filter is applied, not offered',
  },
  {
    name: 'Vikram Shah',
    email: 'techfinance@nova.example.com',
    roles: [RoleKey.FINANCE_MANAGER],
    companies: ['technologies'],
    note: 'Finance Manager for Nova Technologies',
  },
  {
    name: 'Neha Kulkarni',
    email: 'techapprover@nova.example.com',
    roles: [RoleKey.APPROVER],
    companies: ['technologies'],
    note: 'Head of the Nova Technologies engineering department',
  },
  {
    name: 'Anjali Bose',
    email: 'techpayroll@nova.example.com',
    roles: [RoleKey.PAYROLL_USER],
    companies: ['technologies'],
    note: 'Payroll for Nova Technologies',
  },
  {
    name: 'Rahul Bhat',
    email: 'joining@nova.example.com',
    roles: [RoleKey.FINANCE_EXECUTIVE],
    companies: ['engineering'],
    status: 'INVITED',
    note: 'Invited, not yet activated — cannot sign in until the invite is accepted',
  },
  {
    // Never made a department head: `materializeSteps` resolves a head without
    // checking status, and a suspended head would strand every chain below it.
    name: 'Sunita Das',
    email: 'suspended@nova.example.com',
    roles: [RoleKey.APPROVER],
    companies: ['engineering'],
    status: 'SUSPENDED',
    note: 'Suspended — kept for the audit trail, but cannot sign in',
  },
];

export interface VendorSeed {
  company: string;
  code: string;
  name: string;
  email?: string;
  gstin?: string;
  bankAccountNumber?: string;
  ifsc?: string;
  beneficiaryName?: string;
  paymentTermsDays: number;
  status?: 'ACTIVE' | 'INACTIVE' | 'BLOCKED';
  notes?: string;
}

export const VENDORS: VendorSeed[] = [
  {
    company: 'engineering',
    code: 'TECHZONE',
    name: 'TechZone Solutions Pvt Ltd',
    email: 'accounts@techzone.example.com',
    gstin: '33AAACT2727Q1ZW',
    bankAccountNumber: '50200012345678',
    ifsc: 'HDFC0001234',
    beneficiaryName: 'TechZone Solutions Pvt Ltd',
    paymentTermsDays: 30,
  },
  {
    company: 'engineering',
    code: 'AWS',
    name: 'Amazon Web Services India',
    email: 'billing@aws.example.com',
    bankAccountNumber: '00110022334455',
    ifsc: 'ICIC0000221',
    paymentTermsDays: 15,
  },
  {
    company: 'engineering',
    code: 'ZENITH',
    name: 'Zenith Metals Ltd',
    email: 'ar@zenith.example.com',
    bankAccountNumber: '77880099112233',
    ifsc: 'SBIN0004567',
    paymentTermsDays: 45,
  },
  {
    company: 'engineering',
    code: 'ABCLTD',
    name: 'ABC Industrial Supplies Ltd',
    email: 'accounts@abcltd.example.com',
    bankAccountNumber: '12340098765432',
    ifsc: 'HDFC0004321',
    paymentTermsDays: 30,
  },
  {
    company: 'engineering',
    code: 'ORION',
    name: 'Orion Systems Pvt Ltd',
    email: 'ar@orion.example.com',
    gstin: '33AAACO5521M1ZX',
    bankAccountNumber: '50200098761234',
    ifsc: 'HDFC0001234',
    paymentTermsDays: 30,
  },
  {
    company: 'engineering',
    code: 'PRIMEFAC',
    name: 'Prime Facility Services Pvt Ltd',
    email: 'accounts@primefacility.example.com',
    bankAccountNumber: '33440055667788',
    ifsc: 'SBIN0004567',
    paymentTermsDays: 30,
    status: 'INACTIVE',
    notes: 'Contract ended. Retained so historical invoices keep their vendor.',
  },
  {
    company: 'engineering',
    code: 'GLOBALX',
    name: 'GlobalX Traders Pvt Ltd',
    email: 'accounts@globalx.example.com',
    bankAccountNumber: '99001122334455',
    ifsc: 'ICIC0000221',
    paymentTermsDays: 30,
    status: 'BLOCKED',
    notes: 'Blocked pending a GST compliance review. No new payments.',
  },
  {
    // No bank details on purpose. An invoice for this vendor can be approved
    // but cannot become a payment obligation, which is the state the demo
    // shows: approved, and stuck until master data is fixed.
    company: 'engineering',
    code: 'SWIFTLOG',
    name: 'Swift Logistics Pvt Ltd',
    email: 'billing@swiftlog.example.com',
    paymentTermsDays: 21,
  },
  {
    company: 'technologies',
    code: 'CLOUDNINE',
    name: 'CloudNine Hosting Pvt Ltd',
    email: 'billing@cloudnine.example.com',
    gstin: '29AAACC8812K1Z9',
    bankAccountNumber: '00119911223344',
    ifsc: 'ICIC0000221',
    paymentTermsDays: 15,
  },
  {
    company: 'technologies',
    code: 'NIMBUS',
    name: 'Nimbus Design Studio LLP',
    email: 'accounts@nimbus.example.com',
    bankAccountNumber: '77881122446688',
    ifsc: 'SBIN0004567',
    paymentTermsDays: 30,
  },
];

/**
 * Labels matter: the bank-account list sorts by label and the journeys test
 * picks the operations account, so "Operations" stays first alphabetically
 * within Nova Engineering.
 */
export const BANK_ACCOUNTS = [
  {
    company: 'engineering',
    key: 'engineering:ops',
    label: 'HDFC Current — Operations',
    bankName: 'HDFC Bank',
    accountNumber: '00600350001234',
    ifsc: 'HDFC0000060',
    currentBalance: toMinor(8_92_00_000),
    bankFileFormat: 'HDFC' as const,
  },
  {
    company: 'engineering',
    key: 'engineering:payroll',
    label: 'HDFC Current — Payroll Disbursement',
    bankName: 'HDFC Bank',
    accountNumber: '00600350005678',
    ifsc: 'HDFC0000060',
    currentBalance: toMinor(2_40_00_000),
    bankFileFormat: 'GENERIC_XLSX' as const,
  },
  {
    company: 'technologies',
    key: 'technologies:ops',
    label: 'ICICI Current',
    bankName: 'ICICI Bank',
    accountNumber: '00119988776655',
    ifsc: 'ICIC0000011',
    currentBalance: toMinor(1_20_00_000),
    bankFileFormat: 'ICICI' as const,
  },
  {
    company: 'technologies',
    key: 'technologies:payroll',
    label: 'ICICI Payments — CSV upload',
    bankName: 'ICICI Bank',
    accountNumber: '00119988770000',
    ifsc: 'ICIC0000011',
    currentBalance: toMinor(52_00_000),
    bankFileFormat: 'GENERIC_CSV' as const,
  },
];
