import { describe, expect, it } from 'vitest';
import {
  applyRate,
  basisPointsToPercent,
  computeTds,
  netPayableFor,
  percentToBasisPoints,
  tdsBaseFor,
  tdsBreakdown,
  toMinor,
} from './index.js';

describe('rates', () => {
  it('stores a percentage as integer basis points', () => {
    expect(percentToBasisPoints(10)).toBe(1000);
    expect(percentToBasisPoints(0.75)).toBe(75);
    expect(percentToBasisPoints(7.5)).toBe(750);
    expect(basisPointsToPercent(1000)).toBe(10);
  });

  it('applies a rate without leaving integer arithmetic', () => {
    expect(applyRate(toMinor(1_00_000), 1000)).toBe(toMinor(10_000));
    // 7.5% of ₹1,23,456.78 — the half-paise rounds up rather than drifting.
    expect(applyRate(12345678, 750)).toBe(925926);
  });

  it('refuses a non-integer amount or rate', () => {
    expect(() => applyRate(100.5, 1000)).toThrow(TypeError);
    expect(() => applyRate(100, 10.5)).toThrow(TypeError);
  });
});

describe('TDS', () => {
  it('deducts on the taxable value, not on the GST charged over it', () => {
    // ₹1,00,000 + 18% GST = ₹1,18,000 billed. TDS is on the ₹1,00,000.
    const base = tdsBaseFor({
      subtotal: toMinor(1_00_000),
      taxAmount: toMinor(18_000),
      totalAmount: toMinor(1_18_000),
    });
    expect(base).toBe(toMinor(1_00_000));
    expect(computeTds({ tdsApplicable: true, baseAmount: base, rateBasisPoints: 1000 })).toBe(
      toMinor(10_000),
    );
  });

  it('falls back to total minus tax when only the totals were read', () => {
    expect(tdsBaseFor({ taxAmount: toMinor(18_000), totalAmount: toMinor(1_18_000) })).toBe(
      toMinor(1_00_000),
    );
  });

  it('falls back to the total when no tax was identified', () => {
    expect(tdsBaseFor({ totalAmount: toMinor(50_000) })).toBe(toMinor(50_000));
    // A tax figure at or above the total is nonsense, so it is ignored rather
    // than producing a zero or negative base.
    expect(tdsBaseFor({ totalAmount: toMinor(50_000), taxAmount: toMinor(50_000) })).toBe(
      toMinor(50_000),
    );
  });

  it('withholds nothing when the deduction does not apply', () => {
    const base = toMinor(1_00_000);
    expect(computeTds({ tdsApplicable: false, baseAmount: base, rateBasisPoints: 1000 })).toBe(0);
    expect(computeTds({ tdsApplicable: true, baseAmount: base, rateBasisPoints: 0 })).toBe(0);
    expect(computeTds({ tdsApplicable: true, baseAmount: base })).toBe(0);
    expect(computeTds({ tdsApplicable: true, baseAmount: 0, rateBasisPoints: 1000 })).toBe(0);
  });

  it('nets the gross bill down to what the bank actually pays', () => {
    const { tdsAmount, netPayable } = tdsBreakdown(toMinor(1_18_000), {
      tdsApplicable: true,
      baseAmount: toMinor(1_00_000),
      rateBasisPoints: 1000,
    });
    expect(tdsAmount).toBe(toMinor(10_000));
    expect(netPayable).toBe(toMinor(1_08_000));
  });

  it('never produces a negative payment instruction', () => {
    // A mis-keyed 200% rate must not turn into money owed by the vendor.
    const { tdsAmount, netPayable } = tdsBreakdown(toMinor(1_000), {
      tdsApplicable: true,
      baseAmount: toMinor(1_000),
      rateBasisPoints: 10_000,
    });
    expect(tdsAmount).toBe(toMinor(1_000));
    expect(netPayable).toBe(0);
    expect(netPayableFor(toMinor(100), toMinor(500))).toBe(0);
  });

  it('leaves the gross figure alone when nothing is withheld', () => {
    const gross = toMinor(35_40_000);
    const { tdsAmount, netPayable } = tdsBreakdown(gross, {
      tdsApplicable: false,
      baseAmount: gross,
    });
    expect(tdsAmount).toBe(0);
    expect(netPayable).toBe(gross);
  });
});
