/**
 * Text normalisation and similarity, shared by two features that need the same
 * notion of "is this the same party":
 *
 *  - duplicate invoice detection (PRD §13)
 *  - bank transaction ↔ payment obligation matching (PRD §25)
 */

/** Payment-rail noise that carries no identity information. */
const RAIL_NOISE = new Set([
  'neft', 'rtgs', 'imps', 'upi', 'ach', 'nach', 'chq', 'cheque', 'dr', 'cr',
  'txn', 'trf', 'transfer', 'payment', 'pmt', 'paid', 'to', 'from', 'ref',
  'inb', 'ib', 'mb', 'bulk', 'salary', 'sal', 'vendor', 'inv', 'invoice',
]);

/** Company-form suffixes that should not drive a name match. */
const LEGAL_SUFFIXES = new Set([
  'pvt', 'private', 'ltd', 'limited', 'llp', 'inc', 'incorporated', 'corp',
  'corporation', 'co', 'company', 'plc', 'gmbh', 'sa', 'bv', 'and', 'the',
]);

/** Lowercase, strip punctuation, collapse whitespace. */
export function normalizeText(input: string | null | undefined): string {
  if (!input) return '';
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Normalised significant tokens, with rail noise and legal suffixes removed. */
export function significantTokens(input: string | null | undefined): string[] {
  return normalizeText(input)
    .split(' ')
    .filter((token) => token.length > 1 && !RAIL_NOISE.has(token) && !LEGAL_SUFFIXES.has(token));
}

/** Canonical form of a beneficiary/party name, used for comparison and keys. */
export function normalizeName(input: string | null | undefined): string {
  return significantTokens(input).join(' ');
}

/**
 * Invoice numbers arrive with inconsistent separators and casing
 * ("INV-9821", "inv 9821", "INV/9821"). Collapse to a comparable key.
 */
export function normalizeInvoiceNumber(input: string | null | undefined): string {
  if (!input) return '';
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Normalise account numbers, tolerating masking ("XXXX8291"). */
export function normalizeAccountNumber(input: string | null | undefined): string {
  if (!input) return '';
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Last n digits of an account number — masked statements often show only these. */
export function accountTail(input: string | null | undefined, digits = 4): string {
  const normalized = normalizeAccountNumber(input).replace(/[^0-9]/g, '');
  return normalized.slice(-digits);
}

function bigrams(value: string): Map<string, number> {
  const grams = new Map<string, number>();
  for (let i = 0; i < value.length - 1; i += 1) {
    const gram = value.slice(i, i + 2);
    grams.set(gram, (grams.get(gram) ?? 0) + 1);
  }
  return grams;
}

/**
 * Sørensen–Dice coefficient over character bigrams, returning 0..1.
 * Chosen over Levenshtein because it handles word reordering and truncation —
 * both common in bank narrations ("TECHZONE SOLUTIONS" vs "TECHZONE SOLUT").
 */
export function diceCoefficient(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;

  const gramsA = bigrams(a);
  const gramsB = bigrams(b);
  let intersection = 0;
  let totalA = 0;
  let totalB = 0;
  for (const count of gramsA.values()) totalA += count;
  for (const [gram, count] of gramsB) {
    totalB += count;
    const inA = gramsA.get(gram);
    if (inA) intersection += Math.min(inA, count);
  }
  return (2 * intersection) / (totalA + totalB);
}

/**
 * Name similarity 0..1 combining a bigram score with a token-containment
 * bonus, so "TECHZONE" inside "NEFT TECHZONE SOLUTIONS PVT LTD" still scores
 * highly even though the strings differ a lot in length.
 */
export function nameSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  const left = normalizeName(a);
  const right = normalizeName(b);
  if (!left || !right) return 0;
  if (left === right) return 1;

  const dice = diceCoefficient(left, right);

  const leftTokens = new Set(left.split(' '));
  const rightTokens = new Set(right.split(' '));
  const smaller = leftTokens.size <= rightTokens.size ? leftTokens : rightTokens;
  const larger = smaller === leftTokens ? rightTokens : leftTokens;
  let contained = 0;
  for (const token of smaller) if (larger.has(token)) contained += 1;
  const containment = smaller.size ? contained / smaller.size : 0;

  return Math.min(1, Math.max(dice, containment * 0.95));
}

/**
 * True when `haystack` contains `needle` as a reference, ignoring separators.
 * Used to spot an invoice number or batch reference inside a bank narration.
 */
export function containsReference(
  haystack: string | null | undefined,
  needle: string | null | undefined,
): boolean {
  const normalizedNeedle = normalizeInvoiceNumber(needle);
  if (!normalizedNeedle || normalizedNeedle.length < 4) return false;
  return normalizeInvoiceNumber(haystack).includes(normalizedNeedle);
}

/** Whole days between two dates, ignoring time of day. */
export function daysBetween(a: Date, b: Date): number {
  const dayA = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate());
  const dayB = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate());
  return Math.round(Math.abs(dayA - dayB) / 86_400_000);
}
