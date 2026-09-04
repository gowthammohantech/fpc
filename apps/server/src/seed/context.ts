import { Types } from 'mongoose';
import { permissionsForRoles, type Permission } from '@fpc/shared';
import type { Principal } from '../middleware/types.js';
import type { AuditContext } from '../modules/audit/audit.service.js';
import { customGrants } from '../modules/organization/role.service.js';

export interface SeedUser {
  id: Types.ObjectId;
  name: string;
  email: string;
  roleKeys: string[];
  companyIds: Types.ObjectId[];
}

/**
 * Everything the seed writers need to refer to each other's rows.
 *
 * Codes repeat across companies — both companies have a Bengaluru office — so
 * every lookup is keyed by `company:code` rather than by code alone. Keying by
 * code was a latent bug: a second location or bank account for the same
 * company silently overwrote the first.
 */
export interface SeedContext {
  tenantId: Types.ObjectId;
  companyIds: Record<string, Types.ObjectId>;
  locationIds: Record<string, Types.ObjectId>;
  departmentIds: Record<string, Types.ObjectId>;
  vendorIds: Record<string, Types.ObjectId>;
  bankAccountIds: Record<string, Types.ObjectId>;
  users: Record<string, SeedUser>;
  /** Audit contexts attributing each seeded write to a real, named user. */
  actors: Record<string, AuditContext>;
}

export function keyOf(company: string, code: string): string {
  return `${company}:${code}`;
}

export function user(context: SeedContext, email: string): SeedUser {
  const found = context.users[email];
  if (!found) throw new Error(`seed: no user ${email}`);
  return found;
}

/**
 * The audit context for a seeded action.
 *
 * Passing the right actor to each service call is what turns the audit trail
 * from a list of anonymous rows into a readable narrative, and it costs
 * nothing because the services already accept one.
 */
export function actor(context: SeedContext, email: string): AuditContext {
  const found = context.actors[email];
  if (!found) throw new Error(`seed: no audit actor for ${email}`);
  return found;
}

/**
 * Midnight UTC, `days` from today. Negative is in the past.
 *
 * Seeded dates are relative so the demo always looks current, which is also
 * why nothing may key its idempotency off a date-derived reference.
 */
export function daysFromNow(days: number): Date {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** The calendar month `count` months before this one, year boundary included. */
export function monthsAgo(count: number): { month: number; year: number; name: string } {
  const now = new Date();
  // getUTCMonth() is 0-based, so this is already "one month ago" at count 1.
  const zeroBased = now.getUTCMonth() - count;
  const year = now.getUTCFullYear() + Math.floor(zeroBased / 12);
  const month = ((zeroBased % 12) + 12) % 12;
  return { month: month + 1, year, name: MONTH_NAMES[month]! };
}

/** The last day of a period, used as a payroll payment date. */
export function endOfMonth(period: { month: number; year: number }): Date {
  return new Date(Date.UTC(period.year, period.month, 0));
}

/** Builds one audit context per seeded user, once the users exist. */
export async function buildActors(
  tenantId: Types.ObjectId,
  users: Record<string, SeedUser>,
): Promise<Record<string, AuditContext>> {
  const grants = await customGrants(tenantId);
  const actors: Record<string, AuditContext> = {};

  for (const [email, seeded] of Object.entries(users)) {
    const permissions: Permission[] = permissionsForRoles(seeded.roleKeys, grants);
    const principal: Principal = {
      userId: seeded.id,
      tenantId,
      email,
      name: seeded.name,
      roleKeys: seeded.roleKeys,
      permissions,
      companyIds: seeded.companyIds,
      locationIds: [],
      departmentIds: [],
    };
    actors[email] = {
      principal,
      ip: '203.0.113.10',
      requestId: `seed-${email.split('@')[0]}`,
    };
  }

  return actors;
}
