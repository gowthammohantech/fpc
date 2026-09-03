import { describe, expect, it } from 'vitest';
import {
  InvoiceStatus,
  IllegalTransitionError,
  amountsMatch,
  containsReference,
  formatCompactINR,
  formatINR,
  invoiceMachine,
  nameSimilarity,
  normalizeInvoiceNumber,
  normalizeName,
  parseAmountToMinor,
  paymentBatchMachine,
  permissionsForRoles,
  ROLE_PERMISSIONS,
  RoleKey,
  toMinor,
} from './index.js';

describe('money', () => {
  it('stores rupees as integer paise', () => {
    expect(toMinor(3540000)).toBe(354000000);
    expect(toMinor('35,40,000.00')).toBe(354000000);
    expect(toMinor('₹82,000')).toBe(8200000);
  });

  it('avoids float drift when summing amounts', () => {
    // 0.1 + 0.2 !== 0.3 in floating point; in minor units it is exact.
    expect(toMinor(0.1) + toMinor(0.2)).toBe(toMinor(0.3));
  });

  it('parses the amount formats found on invoices and statements', () => {
    expect(parseAmountToMinor('1,00,000.50')).toBe(10000050);
    expect(parseAmountToMinor('(2,500)')).toBe(-250000);
    expect(parseAmountToMinor('  ')).toBeNull();
    expect(parseAmountToMinor('n/a')).toBeNull();
  });

  it('applies the larger of the absolute and relative tolerance', () => {
    expect(amountsMatch(toMinor(100), toMinor(100.5))).toBe(true); // within ₹1
    expect(amountsMatch(toMinor(100), toMinor(102))).toBe(false);
    expect(amountsMatch(toMinor(1_000_000), toMinor(1_004_000))).toBe(true); // within 0.5%
    expect(amountsMatch(toMinor(1_000_000), toMinor(1_010_000))).toBe(false);
  });

  it('formats amounts with Indian grouping', () => {
    expect(formatINR(354000000)).toContain('35,40,000');
    // Two decimals are kept for currency; a whole number drops them.
    expect(formatCompactINR(6200000000)).toBe('₹6.20 Cr');
    expect(formatCompactINR(354000000)).toBe('₹35.40 L');
    expect(formatCompactINR(8200000)).toBe('₹82 K');
  });
});

describe('invoice state machine', () => {
  it('permits the PRD §14 happy path end to end', () => {
    const ladder = [
      InvoiceStatus.RECEIVED,
      InvoiceStatus.EXTRACTING,
      InvoiceStatus.REVIEW_REQUIRED,
      InvoiceStatus.VALIDATED,
      InvoiceStatus.SUBMITTED,
      InvoiceStatus.PENDING_APPROVAL,
      InvoiceStatus.APPROVED,
      InvoiceStatus.PAYMENT_PENDING,
      InvoiceStatus.PAYMENT_BATCHED,
      InvoiceStatus.PAYMENT_PROCESSING,
      InvoiceStatus.PAID,
      InvoiceStatus.RECONCILED,
    ];
    for (let i = 0; i < ladder.length - 1; i += 1) {
      expect(invoiceMachine.canTransition(ladder[i]!, ladder[i + 1]!)).toBe(true);
    }
  });

  it('refuses to jump straight to PAID', () => {
    expect(invoiceMachine.canTransition(InvoiceStatus.RECEIVED, InvoiceStatus.PAID)).toBe(false);
    expect(invoiceMachine.canTransition(InvoiceStatus.APPROVED, InvoiceStatus.PAID)).toBe(false);
    expect(() =>
      invoiceMachine.assertTransition(InvoiceStatus.APPROVED, InvoiceStatus.PAID),
    ).toThrow(IllegalTransitionError);
  });

  it('only reaches PAID from PAYMENT_PROCESSING, which is the reconciliation path', () => {
    const sources = invoiceMachine.states.filter((state) =>
      invoiceMachine.nextStates(state).includes(InvoiceStatus.PAID),
    );
    expect(sources).toEqual([InvoiceStatus.PAYMENT_PROCESSING]);
  });

  it('treats RECONCILED and CANCELLED as terminal', () => {
    expect(invoiceMachine.nextStates(InvoiceStatus.RECONCILED)).toEqual([]);
    expect(invoiceMachine.nextStates(InvoiceStatus.CANCELLED)).toEqual([]);
  });

  it('lets a payment batch reach RECONCILED only after export', () => {
    expect(paymentBatchMachine.canTransition('DRAFT', 'EXPORTED')).toBe(false);
    expect(paymentBatchMachine.pathBetween('DRAFT', 'RECONCILED')).toContain('EXPORTED');
  });
});

describe('permissions', () => {
  it('keeps payroll invisible to finance executives and AP-side roles', () => {
    for (const role of [RoleKey.FINANCE_EXECUTIVE, RoleKey.FINANCE_MANAGER, RoleKey.APPROVER]) {
      expect(ROLE_PERMISSIONS[role]).not.toContain('payroll:read');
      expect(ROLE_PERMISSIONS[role]).not.toContain('payroll:approve');
    }
  });

  it('does not let a finance executive approve anything', () => {
    const granted = ROLE_PERMISSIONS[RoleKey.FINANCE_EXECUTIVE];
    expect(granted).not.toContain('invoice:approve');
    expect(granted).not.toContain('payroll:approve');
    // But it can do the preparation work the PRD §7 example lists.
    expect(granted).toEqual(
      expect.arrayContaining([
        'invoice:read',
        'bank_statement:create',
        'payment_batch:create',
        'reconciliation:confirm',
      ]),
    );
  });

  it('gives the CFO payroll visibility and both approval rights', () => {
    expect(ROLE_PERMISSIONS[RoleKey.CFO]).toEqual(
      expect.arrayContaining(['payroll:read', 'payroll:approve', 'invoice:approve', 'audit:read']),
    );
  });

  it('keeps the auditor read-only', () => {
    const mutating = ROLE_PERMISSIONS[RoleKey.AUDITOR].filter(
      (permission) => !permission.endsWith(':read') && !permission.endsWith(':read_all') && permission !== 'report:export',
    );
    expect(mutating).toEqual([]);
  });

  it('unions permissions across multiple roles', () => {
    const granted = permissionsForRoles([RoleKey.PAYROLL_USER, RoleKey.APPROVER]);
    expect(granted).toEqual(expect.arrayContaining(['payroll:create', 'invoice:approve']));
  });
});

describe('name matching', () => {
  it('ignores payment-rail noise and legal suffixes', () => {
    expect(normalizeName('TechZone Solutions Pvt Ltd')).toBe('techzone solutions');
    expect(normalizeName('NEFT DR TECHZONE SOLUTIONS')).toBe('techzone solutions');
  });

  it('matches a bank narration against a beneficiary name', () => {
    expect(nameSimilarity('TechZone Solutions Pvt Ltd', 'NEFT TECHZONE SOLUTIONS')).toBeGreaterThan(0.9);
    expect(nameSimilarity('TechZone Solutions', 'Zenith Metals')).toBeLessThan(0.4);
  });

  it('normalises invoice numbers so separators do not defeat duplicate checks', () => {
    expect(normalizeInvoiceNumber('INV-9821')).toBe('INV9821');
    expect(normalizeInvoiceNumber('inv 9821')).toBe('INV9821');
    expect(normalizeInvoiceNumber('INV/9821')).toBe('INV9821');
  });

  it('finds an invoice reference inside a bank narration', () => {
    expect(containsReference('NEFT/INV9821/TECHZONE', 'INV-9821')).toBe(true);
    expect(containsReference('NEFT/TECHZONE', 'INV-9821')).toBe(false);
    // Short references are too weak a signal to trust.
    expect(containsReference('anything 123', '123')).toBe(false);
  });
});
