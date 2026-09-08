import type { Types } from 'mongoose';
import { Counter } from '../models/counter.model.js';

/**
 * Human-readable identifiers.
 *
 * Every tracked entity gets one at creation so a person can quote it — on the
 * phone, in an email, in a spreadsheet — without pasting a Mongo id. The
 * sequence is allocated atomically per tenant and per key; the unique index on
 * each entity's reference field is the second line of defence.
 */

/** Atomically claims the next value of a counter, creating it on first use. */
export async function nextSequence(tenantId: Types.ObjectId, key: string): Promise<number> {
  const counter = await Counter.findOneAndUpdate(
    { tenantId, key },
    { $inc: { value: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  ).lean();
  return counter?.value ?? 1;
}

/**
 * `FIN-INV-2026-000182` and friends.
 *
 * The year is part of both the counter key and the printed reference, so
 * numbering restarts each January and a reference always says when it was
 * issued.
 */
export async function nextReference(
  tenantId: Types.ObjectId,
  prefix: string,
  options: { at?: Date; width?: number } = {},
): Promise<string> {
  const year = (options.at ?? new Date()).getFullYear();
  const value = await nextSequence(tenantId, `${prefix}:${year}`);
  return `${prefix}-${year}-${String(value).padStart(options.width ?? 6, '0')}`;
}

/** Reference prefixes, kept together so no two entities can collide. */
export const REFERENCE_PREFIX = {
  INVOICE: 'FIN-INV',
  APPROVAL: 'APR',
  FINANCE_REQUEST: 'FR',
  PAYMENT_BATCH: 'PAY',
  RECONCILIATION: 'REC',
} as const;
