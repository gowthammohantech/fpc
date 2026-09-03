import {
  amountsMatch,
  containsReference,
  daysBetween,
  nameSimilarity,
  type MatchSignals,
} from '@fpc/shared';

/**
 * Bank transaction ↔ payment obligation matching — PRD §25.
 *
 * The engine only ever *suggests*. Confirming a match is what marks money as
 * actually paid, and that stays a human decision (PRD §25: "AI suggests,
 * finance confirms"), because a wrong confirmation closes a payable that was
 * never really paid.
 *
 * Scoring is a weighted sum of independent signals, out of 100:
 *
 *   amount     50   exact, or 35 within tolerance — the strongest signal
 *   name       25   fuzzy match of beneficiary against the bank narration
 *   date       15   proximity to when the batch went to the bank
 *   reference  10   our batch/invoice reference echoed in the narration
 *
 * Amount alone (50) is deliberately not enough to suggest: two vendors billing
 * the same round figure in one batch is common, and that is exactly the case
 * where an automatic match would pay the wrong payable.
 */

export const SUGGESTION_THRESHOLD = 85;

export const WEIGHTS = {
  amountExact: 50,
  amountClose: 35,
  name: 25,
  date: 15,
  reference: 10,
} as const;

export interface MatchCandidate {
  id: string;
  /** Minor units. */
  amount: number;
  beneficiaryName: string;
  payeeName: string;
  reference: string;
  paymentBatchReference?: string | undefined;
  /** When the batch went to the bank; the debit should be near it. */
  expectedDate?: Date | undefined;
}

export interface MatchTransaction {
  /** Minor units, positive. */
  amount: number;
  description: string;
  reference?: string | undefined;
  utr?: string | undefined;
  transactionDate: Date;
}

export interface ScoredMatch {
  candidateId: string;
  confidence: number;
  signals: MatchSignals;
}

/** Scores one transaction against one candidate obligation. */
export function score(transaction: MatchTransaction, candidate: MatchCandidate): ScoredMatch {
  const exact = transaction.amount === candidate.amount;
  const close = !exact && amountsMatch(candidate.amount, transaction.amount);
  const amountScore = exact ? WEIGHTS.amountExact : close ? WEIGHTS.amountClose : 0;

  // The bank narration holds the beneficiary name; compare against both the
  // beneficiary and the payee, since they differ for some vendors.
  const narration = [transaction.description, transaction.reference].filter(Boolean).join(' ');
  const similarity = Math.max(
    nameSimilarity(candidate.beneficiaryName, narration),
    nameSimilarity(candidate.payeeName, narration),
  );
  const nameScore = similarity * WEIGHTS.name;

  const dayGap = candidate.expectedDate
    ? daysBetween(transaction.transactionDate, candidate.expectedDate)
    : Number.POSITIVE_INFINITY;
  const dateScore = dateScoreFor(dayGap);

  const referenceHit =
    containsReference(narration, candidate.reference) ||
    containsReference(narration, candidate.paymentBatchReference) ||
    containsReference(transaction.utr, candidate.reference);
  const referenceScore = referenceHit ? WEIGHTS.reference : 0;

  return {
    candidateId: candidate.id,
    confidence: Math.round(amountScore + nameScore + dateScore + referenceScore),
    signals: {
      amountScore,
      nameScore: Math.round(nameScore),
      dateScore,
      referenceScore,
      amountExact: exact,
      nameSimilarity: Number(similarity.toFixed(3)),
      dayGap: Number.isFinite(dayGap) ? dayGap : -1,
      referenceHit,
    },
  };
}

/**
 * Ranks candidates for one transaction, best first.
 *
 * A candidate whose amount does not match at all is dropped outright: no
 * combination of name and date should ever suggest paying a different sum.
 */
export function rank(
  transaction: MatchTransaction,
  candidates: MatchCandidate[],
  limit = 5,
): ScoredMatch[] {
  return candidates
    .map((candidate) => score(transaction, candidate))
    .filter((result) => result.signals.amountScore > 0)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, limit);
}

/**
 * The single best match, or null when the engine is not confident enough.
 *
 * Returns null when two candidates are within a few points of each other:
 * an ambiguous suggestion is worse than none, because it invites a reviewer
 * to confirm the first plausible row.
 */
export function bestMatch(
  transaction: MatchTransaction,
  candidates: MatchCandidate[],
  threshold = SUGGESTION_THRESHOLD,
): ScoredMatch | null {
  const ranked = rank(transaction, candidates, 2);
  const best = ranked[0];
  if (!best || best.confidence < threshold) return null;

  const runnerUp = ranked[1];
  if (runnerUp && best.confidence - runnerUp.confidence < 5) return null;

  return best;
}

/** Bank debits appear within a day or two of the file being uploaded. */
function dateScoreFor(dayGap: number): number {
  if (!Number.isFinite(dayGap)) return 0;
  if (dayGap === 0) return WEIGHTS.date;
  if (dayGap === 1) return 12;
  if (dayGap <= 3) return 8;
  if (dayGap <= 7) return 4;
  return 0;
}
