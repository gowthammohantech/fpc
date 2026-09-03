import { describe, expect, it } from 'vitest';
import { toMinor } from '@fpc/shared';
import {
  SUGGESTION_THRESHOLD,
  bestMatch,
  rank,
  score,
  type MatchCandidate,
  type MatchTransaction,
} from './match.engine.js';

const exportedOn = new Date(Date.UTC(2026, 8, 5));

const techzone: MatchCandidate = {
  id: 'techzone',
  amount: toMinor(3_540_000),
  beneficiaryName: 'TechZone Solutions Pvt Ltd',
  payeeName: 'TechZone Solutions',
  reference: 'INV-9821',
  paymentBatchReference: 'PB-20260905-001',
  expectedDate: exportedOn,
};

function debit(overrides: Partial<MatchTransaction> = {}): MatchTransaction {
  return {
    amount: toMinor(3_540_000),
    description: 'NEFT TECHZONE SOLUTIONS',
    transactionDate: exportedOn,
    ...overrides,
  };
}

describe('match scoring', () => {
  it('suggests the TechZone payment with high confidence', () => {
    const result = score(debit(), techzone);

    expect(result.signals.amountExact).toBe(true);
    expect(result.signals.dayGap).toBe(0);
    expect(result.confidence).toBeGreaterThanOrEqual(SUGGESTION_THRESHOLD);
    expect(result.confidence).toBeLessThanOrEqual(100);
  });

  it('adds the reference signal when our reference is echoed in the narration', () => {
    const withReference = score(
      debit({ description: 'NEFT TECHZONE SOLUTIONS PB-20260905-001/INV-9821' }),
      techzone,
    );
    expect(withReference.signals.referenceHit).toBe(true);
    // A narration containing the name is never a literal string equality, so
    // the name signal tops out just below its full weight — the total is very
    // high but deliberately not a flat 100.
    expect(withReference.confidence).toBeGreaterThanOrEqual(95);
    expect(withReference.confidence).toBeGreaterThan(score(debit(), techzone).confidence);
  });

  it('does not suggest on amount alone', () => {
    // Same amount, completely different beneficiary and date — this is the
    // case where an automatic match would close the wrong payable.
    const result = score(
      debit({ description: 'NEFT ZENITH METALS', transactionDate: new Date(Date.UTC(2026, 7, 1)) }),
      techzone,
    );
    expect(result.signals.amountScore).toBe(50);
    expect(result.confidence).toBeLessThan(SUGGESTION_THRESHOLD);
  });

  it('scores an amount within tolerance lower than an exact one', () => {
    const off = score(debit({ amount: toMinor(3_540_000) - 50 }), techzone);
    expect(off.signals.amountExact).toBe(false);
    expect(off.signals.amountScore).toBe(35);
    expect(off.confidence).toBeLessThan(score(debit(), techzone).confidence);
  });

  it('decays the date signal as the gap widens', () => {
    const gaps = [0, 1, 3, 7, 30].map(
      (days) =>
        score(
          debit({ transactionDate: new Date(exportedOn.getTime() + days * 86_400_000) }),
          techzone,
        ).signals.dateScore,
    );
    expect(gaps).toEqual([...gaps].sort((a, b) => b - a));
    expect(gaps.at(-1)).toBe(0);
  });

  it('matches a truncated beneficiary name in the narration', () => {
    const result = score(debit({ description: 'RTGS TECHZONE SOLUT' }), techzone);
    expect(result.signals.nameSimilarity).toBeGreaterThan(0.7);
  });
});

describe('candidate ranking', () => {
  const zenith: MatchCandidate = {
    ...techzone,
    id: 'zenith',
    beneficiaryName: 'Zenith Metals Ltd',
    payeeName: 'Zenith Metals',
    reference: 'INV-4410',
  };
  const smaller: MatchCandidate = { ...techzone, id: 'small', amount: toMinor(18_200) };

  it('drops candidates whose amount does not match at all', () => {
    const ranked = rank(debit(), [techzone, smaller]);
    expect(ranked.map((entry) => entry.candidateId)).toEqual(['techzone']);
  });

  it('puts the right beneficiary first when amounts tie', () => {
    const ranked = rank(debit(), [zenith, techzone]);
    expect(ranked[0]!.candidateId).toBe('techzone');
  });

  it('returns a confident single match', () => {
    expect(bestMatch(debit(), [techzone, smaller])?.candidateId).toBe('techzone');
  });

  it('refuses to choose between two near-identical candidates', () => {
    // Two obligations to the same beneficiary for the same amount in one
    // batch: guessing here would mark the wrong invoice paid.
    const twin: MatchCandidate = { ...techzone, id: 'techzone-2', reference: 'INV-9822' };
    expect(bestMatch(debit(), [techzone, twin])).toBeNull();
  });

  it('returns nothing when no candidate clears the threshold', () => {
    expect(bestMatch(debit({ description: 'ATM WITHDRAWAL' }), [zenith])).toBeNull();
  });

  it('handles an empty candidate list', () => {
    expect(bestMatch(debit(), [])).toBeNull();
    expect(rank(debit(), [])).toEqual([]);
  });
});
