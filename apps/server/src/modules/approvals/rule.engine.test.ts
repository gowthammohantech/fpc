import { describe, expect, it } from 'vitest';
import { toMinor } from '@fpc/shared';
import { evaluate, matches, type EvaluableRule, type RuleContext } from './rule.engine.js';

/** The PRD §15 ladder, expressed exactly as it would be seeded. */
const LADDER: EvaluableRule[] = [
  {
    id: 'r1',
    name: 'Up to ₹1L — Finance Manager',
    appliesTo: 'VENDOR_INVOICE',
    priority: 10,
    active: true,
    conditions: [{ field: 'amount', operator: 'lte', value: toMinor(100_000) }],
    steps: [{ order: 1, approverType: 'ROLE', roleKey: 'FINANCE_MANAGER' }],
  },
  {
    id: 'r2',
    name: '₹1L to ₹10L — Department Head then Finance Manager',
    appliesTo: 'VENDOR_INVOICE',
    priority: 20,
    active: true,
    conditions: [
      { field: 'amount', operator: 'gt', value: toMinor(100_000) },
      { field: 'amount', operator: 'lte', value: toMinor(1_000_000) },
    ],
    steps: [
      { order: 1, approverType: 'DEPARTMENT_HEAD' },
      { order: 2, approverType: 'ROLE', roleKey: 'FINANCE_MANAGER' },
    ],
  },
  {
    id: 'r3',
    name: 'Above ₹10L — Department Head, Finance Head, CFO',
    appliesTo: 'VENDOR_INVOICE',
    priority: 30,
    active: true,
    conditions: [{ field: 'amount', operator: 'gt', value: toMinor(1_000_000) }],
    steps: [
      { order: 1, approverType: 'DEPARTMENT_HEAD' },
      { order: 2, approverType: 'ROLE', roleKey: 'FINANCE_MANAGER' },
      { order: 3, approverType: 'ROLE', roleKey: 'CFO' },
    ],
  },
];

function invoice(amount: number, overrides: Partial<RuleContext> = {}): RuleContext {
  return { appliesTo: 'VENDOR_INVOICE', amount, currency: 'INR', ...overrides };
}

describe('approval rule engine', () => {
  it('routes the ₹35.4L TechZone invoice to the three-step chain', () => {
    const rule = evaluate(invoice(toMinor(3_540_000)), LADDER);
    expect(rule?.id).toBe('r3');
    expect(rule?.steps.map((step) => step.roleKey ?? step.approverType)).toEqual([
      'DEPARTMENT_HEAD',
      'FINANCE_MANAGER',
      'CFO',
    ]);
  });

  it('routes a small invoice to a single Finance Manager approval', () => {
    expect(evaluate(invoice(toMinor(45_000)), LADDER)?.id).toBe('r1');
  });

  it('places each band boundary in exactly one band', () => {
    // ₹1,00,000 exactly: the "up to ₹1L" band, not the next one up.
    expect(evaluate(invoice(toMinor(100_000)), LADDER)?.id).toBe('r1');
    expect(evaluate(invoice(toMinor(100_000) + 1), LADDER)?.id).toBe('r2');
    // ₹10,00,000 exactly: the middle band.
    expect(evaluate(invoice(toMinor(1_000_000)), LADDER)?.id).toBe('r2');
    expect(evaluate(invoice(toMinor(1_000_000) + 1), LADDER)?.id).toBe('r3');
  });

  it('never leaves an amount unrouted across the whole ladder', () => {
    for (const amount of [1, 99_999, 100_000, 100_001, 999_999, 1_000_000, 1_000_001, 100_000_000]) {
      expect(evaluate(invoice(toMinor(amount)), LADDER), `₹${amount}`).not.toBeNull();
    }
  });

  it('ignores rules for a different subject type', () => {
    expect(evaluate({ ...invoice(toMinor(50_000)), appliesTo: 'PAYROLL_BATCH' }, LADDER)).toBeNull();
  });

  it('ignores deactivated rules', () => {
    const disabled = LADDER.map((rule) => ({ ...rule, active: false }));
    expect(evaluate(invoice(toMinor(3_540_000)), disabled)).toBeNull();
  });

  it('prefers the higher-priority rule, then the more specific one', () => {
    const catchAll: EvaluableRule = {
      id: 'catch-all',
      name: 'Everything — CFO',
      appliesTo: 'VENDOR_INVOICE',
      priority: 30,
      active: true,
      conditions: [],
      steps: [{ order: 1, approverType: 'ROLE', roleKey: 'CFO' }],
    };
    // Same priority as r3, but r3 carries a condition and so is more specific.
    expect(evaluate(invoice(toMinor(3_540_000)), [catchAll, ...LADDER])?.id).toBe('r3');
  });

  it('is deterministic regardless of the order rules arrive in', () => {
    const reversed = [...LADDER].reverse();
    expect(evaluate(invoice(toMinor(3_540_000)), reversed)?.id).toBe(
      evaluate(invoice(toMinor(3_540_000)), LADDER)?.id,
    );
  });

  it('supports vendor, department and location conditions', () => {
    const vendorRule: EvaluableRule = {
      id: 'vendor',
      name: 'Strategic vendors need the CFO',
      appliesTo: 'VENDOR_INVOICE',
      priority: 100,
      active: true,
      conditions: [{ field: 'vendorId', operator: 'in', value: ['v1', 'v2'] }],
      steps: [{ order: 1, approverType: 'ROLE', roleKey: 'CFO' }],
    };
    expect(evaluate(invoice(toMinor(1_000), { vendorId: 'v1' }), [...LADDER, vendorRule])?.id).toBe('vendor');
    expect(evaluate(invoice(toMinor(1_000), { vendorId: 'v9' }), [...LADDER, vendorRule])?.id).toBe('r1');
  });
});

describe('condition operators', () => {
  const context = invoice(toMinor(500_000), { vendorId: 'v1', locationId: 'chennai' });

  it('evaluates comparison operators against minor units', () => {
    expect(matches({ field: 'amount', operator: 'gte', value: toMinor(500_000) }, context)).toBe(true);
    expect(matches({ field: 'amount', operator: 'lt', value: toMinor(500_000) }, context)).toBe(false);
  });

  it('treats between as lower-inclusive and upper-exclusive', () => {
    expect(
      matches({ field: 'amount', operator: 'between', value: [toMinor(500_000), toMinor(1_000_000)] }, context),
    ).toBe(true);
    expect(
      matches({ field: 'amount', operator: 'between', value: [toMinor(100_000), toMinor(500_000)] }, context),
    ).toBe(false);
  });

  it('handles membership tests', () => {
    expect(matches({ field: 'locationId', operator: 'in', value: ['chennai', 'pune'] }, context)).toBe(true);
    expect(matches({ field: 'locationId', operator: 'nin', value: ['chennai'] }, context)).toBe(false);
  });

  it('does not match a comparison against a missing field', () => {
    expect(matches({ field: 'departmentId', operator: 'eq', value: 'it' }, context)).toBe(false);
    expect(matches({ field: 'employeeCount', operator: 'gt', value: 100 }, context)).toBe(false);
  });
});
