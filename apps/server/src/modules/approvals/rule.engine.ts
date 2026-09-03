import type { ApprovalRule, ApprovalSubjectType, RuleCondition } from '@fpc/shared';

/**
 * Approval rule evaluation — PRD §15.
 *
 * This module is deliberately pure: no database, no Mongoose, no clock. It
 * takes a description of what is being approved plus the candidate rules, and
 * returns the rule that governs it. That makes the whole approval ladder —
 * including the boundary cases at exactly ₹1,00,000 and ₹10,00,000 — directly
 * unit-testable, which matters because this decides who has to sign off on
 * money leaving the company.
 */

export interface RuleContext {
  appliesTo: ApprovalSubjectType;
  /** Minor units. */
  amount: number;
  currency: string;
  vendorId?: string;
  departmentId?: string;
  locationId?: string;
  employeeCount?: number;
}

export type EvaluableRule = Pick<
  ApprovalRule,
  'id' | 'name' | 'appliesTo' | 'priority' | 'active' | 'conditions' | 'steps'
>;

/**
 * Returns the governing rule, or null when nothing matches.
 *
 * Selection order: all conditions must pass; then the highest `priority`
 * wins; ties break towards the more specific rule (more conditions), and
 * finally by name so the outcome is deterministic rather than dependent on
 * document order.
 */
export function evaluate<T extends EvaluableRule>(context: RuleContext, rules: T[]): T | null {
  const matches = rules.filter(
    (rule) =>
      rule.active && rule.appliesTo === context.appliesTo && matchesAll(rule.conditions, context),
  );
  if (!matches.length) return null;

  matches.sort(
    (a, b) =>
      b.priority - a.priority ||
      b.conditions.length - a.conditions.length ||
      a.name.localeCompare(b.name),
  );
  return matches[0]!;
}

function matchesAll(conditions: RuleCondition[], context: RuleContext): boolean {
  return conditions.every((condition) => matches(condition, context));
}

export function matches(condition: RuleCondition, context: RuleContext): boolean {
  const actual = valueOf(condition.field, context);

  switch (condition.operator) {
    case 'eq':
      return String(actual ?? '') === String(condition.value ?? '');
    case 'ne':
      return String(actual ?? '') !== String(condition.value ?? '');
    case 'gt':
      return numeric(actual) > numeric(condition.value);
    case 'gte':
      return numeric(actual) >= numeric(condition.value);
    case 'lt':
      return numeric(actual) < numeric(condition.value);
    case 'lte':
      return numeric(actual) <= numeric(condition.value);
    case 'in':
      return toList(condition.value).includes(String(actual ?? ''));
    case 'nin':
      return !toList(condition.value).includes(String(actual ?? ''));
    case 'between': {
      // Inclusive of the lower bound, exclusive of the upper — so adjacent
      // bands like [0, 1L) and [1L, 10L) cannot both claim ₹1,00,000.
      const [low, high] = toList(condition.value).map(Number);
      const value = numeric(actual);
      return (
        value >= (low ?? Number.NEGATIVE_INFINITY) && value < (high ?? Number.POSITIVE_INFINITY)
      );
    }
    default:
      return false;
  }
}

function valueOf(field: RuleCondition['field'], context: RuleContext): unknown {
  switch (field) {
    case 'amount':
      return context.amount;
    case 'vendorId':
      return context.vendorId;
    case 'departmentId':
      return context.departmentId;
    case 'locationId':
      return context.locationId;
    case 'currency':
      return context.currency;
    case 'employeeCount':
      return context.employeeCount;
    default:
      return undefined;
  }
}

function numeric(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function toList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((entry) => String(entry));
  if (typeof value === 'string') return value.split(',').map((entry) => entry.trim());
  return [String(value)];
}
