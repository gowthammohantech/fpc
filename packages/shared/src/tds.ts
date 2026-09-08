/**
 * Tax Deducted at Source.
 *
 * The vendor bills a gross amount; the payer withholds TDS and pays the vendor
 * the remainder, so three figures have to be kept apart and never conflated:
 *
 *   totalAmount   what the vendor invoiced        (gross — unchanged meaning)
 *   tdsAmount     what is withheld                (never leaves the bank)
 *   netPayable    totalAmount − tdsAmount         (what the bank actually pays)
 *
 * Every function here is pure — no database, no clock — which is what lets the
 * boundary cases be unit-tested directly, the same way the approval rule engine
 * is.
 */

import { applyRate, type BasisPoints, type Minor } from './money.js';

/** The part of an invoice a deduction is calculated on. */
export interface TdsBaseSource {
  subtotal?: Minor | null;
  taxAmount?: Minor | null;
  totalAmount?: Minor | null;
}

export interface TdsInput {
  tdsApplicable: boolean;
  baseAmount: Minor;
  rateBasisPoints?: BasisPoints | null;
}

export interface TdsBreakdown {
  tdsAmount: Minor;
  netPayable: Minor;
}

/**
 * The taxable value a deduction applies to.
 *
 * TDS is withheld on the value of the supply, not on the GST charged on it, so
 * the subtotal is the right base. Invoices that were only ever read as a single
 * total fall back to `total − tax`, then to the total itself.
 */
export function tdsBaseFor(source: TdsBaseSource): Minor {
  if (typeof source.subtotal === 'number' && source.subtotal > 0) return source.subtotal;
  const total = source.totalAmount ?? 0;
  const tax = source.taxAmount ?? 0;
  if (total > 0 && tax > 0 && tax < total) return total - tax;
  return total;
}

/**
 * The amount to withhold. Returns 0 whenever the deduction does not apply, so
 * callers never have to branch before storing the figure.
 */
export function computeTds(input: TdsInput): Minor {
  if (!input.tdsApplicable) return 0;
  const rate = input.rateBasisPoints ?? 0;
  if (rate <= 0 || input.baseAmount <= 0) return 0;
  return applyRate(input.baseAmount, rate);
}

/**
 * What the bank pays. Clamped at zero: a deduction can never exceed the
 * invoice, and a mis-keyed rate must not produce a negative payment
 * instruction.
 */
export function netPayableFor(totalAmount: Minor, tdsAmount: Minor): Minor {
  return Math.max(0, totalAmount - tdsAmount);
}

/** Convenience for the accounting workbench: both derived figures at once. */
export function tdsBreakdown(totalAmount: Minor, input: TdsInput): TdsBreakdown {
  const tdsAmount = Math.min(computeTds(input), totalAmount);
  return { tdsAmount, netPayable: netPayableFor(totalAmount, tdsAmount) };
}
