import { RoleKey, toMinor } from '@fpc/shared';

/**
 * Demo data for the PRD's two flagship journeys (§37, §38).
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
];

export const DEPARTMENTS = [
  {
    company: 'engineering',
    name: 'Information Technology',
    code: 'IT',
    head: 'ithead@nova.example.com',
  },
  { company: 'engineering', name: 'Operations', code: 'OPS' },
  { company: 'engineering', name: 'Finance', code: 'FIN' },
  { company: 'technologies', name: 'Engineering', code: 'ENG' },
];

/**
 * One user per role, so the RBAC model can be demonstrated by signing in as
 * each of them. Every account uses the same development password.
 */
export const DEMO_PASSWORD = 'FinanceOps@2026';

export const USERS = [
  {
    name: 'Priya Nair',
    email: 'admin@nova.example.com',
    roles: [RoleKey.PLATFORM_ADMIN],
    companies: [] as string[],
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
    note: 'Finance Head in the approval chain',
  },
  {
    name: 'Arjun Menon',
    email: 'ithead@nova.example.com',
    roles: [RoleKey.APPROVER],
    companies: ['engineering'],
    note: 'IT Head — first approver on the TechZone invoice',
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
];

export const VENDORS = [
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
];

export const BANK_ACCOUNTS = [
  {
    company: 'engineering',
    label: 'HDFC Current — Operations',
    bankName: 'HDFC Bank',
    accountNumber: '00600350001234',
    ifsc: 'HDFC0000060',
    currentBalance: toMinor(8_92_00_000),
    bankFileFormat: 'HDFC' as const,
  },
  {
    company: 'technologies',
    label: 'ICICI Current',
    bankName: 'ICICI Bank',
    accountNumber: '00119988776655',
    ifsc: 'ICIC0000011',
    currentBalance: toMinor(1_20_00_000),
    bankFileFormat: 'ICICI' as const,
  },
];

/**
 * The PRD §15 approval ladder, seeded as data.
 *
 * Bands are expressed with `lte` / `gt` against the same boundary so that
 * ₹1,00,000 and ₹10,00,000 each fall in exactly one band.
 */
export const APPROVAL_RULES = [
  {
    company: 'engineering',
    name: 'Up to ₹1L — Finance Manager',
    description: 'Routine spend needs one finance approval.',
    appliesTo: 'VENDOR_INVOICE' as const,
    priority: 10,
    conditions: [{ field: 'amount', operator: 'lte', value: toMinor(1_00_000) }],
    steps: [{ order: 1, approverType: 'ROLE' as const, roleKey: RoleKey.FINANCE_MANAGER }],
  },
  {
    company: 'engineering',
    name: '₹1L to ₹10L — Department Head then Finance Manager',
    description: 'Mid-size spend needs the requesting department and finance.',
    appliesTo: 'VENDOR_INVOICE' as const,
    priority: 20,
    conditions: [
      { field: 'amount', operator: 'gt', value: toMinor(1_00_000) },
      { field: 'amount', operator: 'lte', value: toMinor(10_00_000) },
    ],
    steps: [
      { order: 1, approverType: 'DEPARTMENT_HEAD' as const, label: 'Department Head' },
      { order: 2, approverType: 'ROLE' as const, roleKey: RoleKey.FINANCE_MANAGER },
    ],
  },
  {
    company: 'engineering',
    name: 'Above ₹10L — Department Head, Finance Head, CFO',
    description: 'Large spend needs three levels, ending with the CFO.',
    appliesTo: 'VENDOR_INVOICE' as const,
    priority: 30,
    conditions: [{ field: 'amount', operator: 'gt', value: toMinor(10_00_000) }],
    steps: [
      { order: 1, approverType: 'DEPARTMENT_HEAD' as const, label: 'Department Head' },
      {
        order: 2,
        approverType: 'ROLE' as const,
        roleKey: RoleKey.FINANCE_MANAGER,
        label: 'Finance Head',
      },
      { order: 3, approverType: 'ROLE' as const, roleKey: RoleKey.CFO },
    ],
  },
  {
    company: 'engineering',
    name: 'All payroll — CFO',
    // The Finance Head is deliberately not in this chain: payroll is walled off
    // from the rest of finance (PRD §18), so FINANCE_MANAGER holds neither
    // `payroll:read` nor `payroll:approve` and could never action the step.
    description: 'Every payroll run needs the CFO.',
    appliesTo: 'PAYROLL_BATCH' as const,
    priority: 10,
    conditions: [],
    steps: [{ order: 1, approverType: 'ROLE' as const, roleKey: RoleKey.CFO, label: 'CFO' }],
  },
];

/** The flagship invoice from PRD §37, plus a few to populate the register. */
export const INVOICES = [
  {
    company: 'engineering',
    vendor: 'TECHZONE',
    department: 'IT',
    location: 'MAA',
    invoiceNumber: 'INV-9821',
    daysAgo: 3,
    dueInDays: 5,
    subtotal: 30_00_000,
    tax: 5_40_000,
    total: 35_40_000,
    /** Leave in REVIEW_REQUIRED so the demo can walk it through by hand. */
    stopAt: 'REVIEW_REQUIRED' as const,
  },
  {
    company: 'engineering',
    vendor: 'AWS',
    department: 'IT',
    location: 'BLR',
    invoiceNumber: 'INV-2381',
    daysAgo: 6,
    dueInDays: 7,
    subtotal: 6_94_915,
    tax: 1_25_085,
    total: 8_20_000,
    stopAt: 'APPROVED' as const,
  },
  {
    company: 'engineering',
    vendor: 'ABCLTD',
    department: 'OPS',
    location: 'PNQ',
    invoiceNumber: 'INV-882',
    daysAgo: 9,
    dueInDays: 10,
    subtotal: 10_16_949,
    tax: 1_83_051,
    total: 12_00_000,
    stopAt: 'PENDING_APPROVAL' as const,
  },
  {
    company: 'engineering',
    vendor: 'ZENITH',
    department: 'OPS',
    location: 'MAA',
    invoiceNumber: 'INV-4410',
    daysAgo: 40,
    dueInDays: -12,
    subtotal: 4_23_729,
    tax: 76_271,
    total: 5_00_000,
    stopAt: 'APPROVED' as const,
  },
  {
    company: 'engineering',
    vendor: 'AWS',
    department: 'IT',
    location: 'BLR',
    invoiceNumber: 'INV-2210',
    daysAgo: 45,
    dueInDays: -18,
    subtotal: 76_271,
    tax: 13_729,
    total: 90_000,
    stopAt: 'APPROVED' as const,
  },
];

/** PRD §38: 850 employees, ₹6.20 Cr, split across three locations. */
export const PAYROLL = {
  company: 'engineering',
  employeeCount: 850,
  targetTotal: 6_20_00_000,
  locations: [
    { code: 'MAA', name: 'Chennai', count: 320 },
    { code: 'BLR', name: 'Bengaluru', count: 280 },
    { code: 'PNQ', name: 'Pune', count: 250 },
  ],
  /** Last month, so the CFO screen shows the +₹12L movement from §19. */
  previousTotal: 6_08_00_000,
};

export const FIRST_NAMES = [
  'Arun',
  'Divya',
  'Kumar',
  'Meera',
  'Rahul',
  'Sneha',
  'Vikram',
  'Anita',
  'Suresh',
  'Kavya',
  'Rajesh',
  'Deepa',
  'Manoj',
  'Priya',
  'Sanjay',
  'Lakshmi',
  'Ganesh',
  'Nisha',
  'Ravi',
  'Pooja',
];

export const LAST_NAMES = [
  'Sharma',
  'Nair',
  'Reddy',
  'Iyer',
  'Menon',
  'Patel',
  'Kulkarni',
  'Rao',
  'Pillai',
  'Krishnan',
  'Desai',
  'Joshi',
  'Bhat',
  'Chandra',
  'Varma',
  'Mehta',
  'Gupta',
  'Singh',
  'Das',
  'Bose',
];

export const IFSC_CODES = ['HDFC0001234', 'ICIC0000221', 'SBIN0004567', 'HDFC0004321'];
