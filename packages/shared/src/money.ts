/**
 * Money handling.
 *
 * Every monetary amount in this system is stored and transported as an integer
 * number of **minor units** (paise for INR). Floating point never touches a
 * financial figure — a ₹35,40,000.00 invoice is the integer 354000000.
 */

export type Minor = number;

const MINOR_PER_MAJOR = 100;

/** Convert a major-unit value (rupees) to minor units (paise). */
export function toMinor(major: number | string): Minor {
  const value = typeof major === 'string' ? Number(major.replace(/[,\s₹]/g, '')) : major;
  if (!Number.isFinite(value)) throw new TypeError(`Not a numeric amount: ${String(major)}`);
  return Math.round(value * MINOR_PER_MAJOR);
}

/** Convert minor units back to a major-unit number. For display/export only. */
export function fromMinor(minor: Minor): number {
  return minor / MINOR_PER_MAJOR;
}

export function addMinor(...values: Minor[]): Minor {
  return values.reduce((sum, value) => sum + value, 0);
}

export function subMinor(a: Minor, b: Minor): Minor {
  return a - b;
}

/** Absolute difference — used by tolerance checks. */
export function diffMinor(a: Minor, b: Minor): Minor {
  return Math.abs(a - b);
}

/**
 * True when two amounts agree within an absolute tolerance (default ₹1) or a
 * relative tolerance (default 0.5%), whichever is larger. Used for the
 * `subtotal + tax ≈ total` check (PRD §13) and for bank amount matching.
 */
export function amountsMatch(
  a: Minor,
  b: Minor,
  options: { absoluteTolerance?: Minor; relativeTolerance?: number } = {},
): boolean {
  const { absoluteTolerance = 100, relativeTolerance = 0.005 } = options;
  const tolerance = Math.max(absoluteTolerance, Math.abs(a) * relativeTolerance);
  return diffMinor(a, b) <= tolerance;
}

const INR_FORMATTER = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** ₹35,40,000.00 */
export function formatINR(minor: Minor): string {
  return INR_FORMATTER.format(fromMinor(minor));
}

/**
 * Compact Indian-numbering display used across dashboards and list screens:
 * ₹6.20 Cr, ₹35.40 L, ₹82,000.
 */
export function formatCompactINR(minor: Minor): string {
  const major = fromMinor(minor);
  const sign = major < 0 ? '-' : '';
  const abs = Math.abs(major);
  if (abs >= 1_00_00_000) return `${sign}₹${trim(abs / 1_00_00_000)} Cr`;
  if (abs >= 1_00_000) return `${sign}₹${trim(abs / 1_00_000)} L`;
  if (abs >= 1_000) return `${sign}₹${trim(abs / 1_000)} K`;
  return `${sign}₹${abs.toFixed(0)}`;
}

function trim(value: number): string {
  return value.toFixed(2).replace(/\.00$/, '');
}

/**
 * Rates follow the same discipline as amounts: integers only.
 *
 * A rate is stored as **basis points** — hundredths of a percent — so a 10%
 * TDS rate is the integer 1000 and 0.75% is 75. Nothing rounds twice, and a
 * rate can be compared and summed exactly.
 */
export type BasisPoints = number;

const BASIS_POINTS_PER_UNIT = 10_000;

export function percentToBasisPoints(percent: number): BasisPoints {
  if (!Number.isFinite(percent)) throw new TypeError(`Not a numeric rate: ${String(percent)}`);
  return Math.round(percent * 100);
}

export function basisPointsToPercent(basisPoints: BasisPoints): number {
  return basisPoints / 100;
}

/** `10%`, `0.75%` — trailing zeros trimmed, as the rate is displayed on screen. */
export function formatBasisPoints(basisPoints: BasisPoints): string {
  return `${String(basisPointsToPercent(basisPoints))}%`;
}

/**
 * Apply a basis-point rate to a minor-unit amount, rounding half up.
 *
 * The intermediate product stays exact for any amount this product can hold:
 * ₹100 Cr at 100% is 10^15, comfortably inside the safe integer range.
 */
export function applyRate(amount: Minor, basisPoints: BasisPoints): Minor {
  if (!Number.isInteger(amount)) throw new TypeError('Amount must be an integer minor value');
  if (!Number.isInteger(basisPoints)) throw new TypeError('Rate must be integer basis points');
  return Math.round((amount * basisPoints) / BASIS_POINTS_PER_UNIT);
}

/** Parse amounts as they appear in invoices and bank statements. */
export function parseAmountToMinor(input: unknown): Minor | null {
  if (input === null || input === undefined || input === '') return null;
  if (typeof input === 'number') return Number.isFinite(input) ? toMinor(input) : null;
  const raw = String(input).trim();
  if (!raw) return null;

  // Strip currency symbols, spaces, and thousands separators (Indian or
  // Western grouping); keep a trailing minus or parenthesised negative.
  const negative = /^\(.*\)$/.test(raw) || raw.trim().endsWith('-') || raw.trim().startsWith('-');
  const cleaned = raw.replace(/[()₹$,\s]/g, '').replace(/-/g, '');
  if (!/^\d*\.?\d*$/.test(cleaned) || cleaned === '' || cleaned === '.') return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return toMinor(negative ? -value : value);
}
