import { describe, expect, it } from 'vitest';
import { toMinor } from '@fpc/shared';
import { formatDate, humanize, isOverdue, relativeDays, rupeesToMinor } from './format';

/**
 * The formatters sit between stored paise and what a finance user reads, so a
 * mistake here misstates money on screen while every server test still passes.
 */
describe('rupee input parsing', () => {
  it('converts what a user types into integer paise', () => {
    expect(rupeesToMinor('3540000')).toBe(toMinor(3_540_000));
    expect(rupeesToMinor('35,40,000')).toBe(toMinor(3_540_000));
    expect(rupeesToMinor('₹82,000.50')).toBe(toMinor(82_000.5));
    expect(rupeesToMinor(' 1000 ')).toBe(toMinor(1_000));
  });

  it('rejects input it cannot represent exactly rather than rounding it', () => {
    // Three decimal places is not a rupee amount; silently rounding would
    // change the figure the user believes they entered.
    expect(rupeesToMinor('100.123')).toBeNull();
    expect(rupeesToMinor('abc')).toBeNull();
    expect(rupeesToMinor('')).toBeNull();
  });

  it('round-trips through the shared money helper', () => {
    for (const value of ['0.01', '1', '99999.99', '62000000']) {
      expect(rupeesToMinor(value)).toBe(toMinor(Number(value)));
    }
  });
});

describe('dates', () => {
  it('renders a readable Indian-format date', () => {
    // The month abbreviation is locale data ("Sep" or "Sept" depending on the
    // ICU build), so assert the parts that must be right rather than pinning
    // a string that varies by Node version.
    const rendered = formatDate('2026-09-05T00:00:00.000Z');
    expect(rendered).toMatch(/^05 Sep/);
    expect(rendered).toContain('2026');
  });

  it('shows an em dash rather than "Invalid Date" for missing values', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDate(undefined)).toBe('—');
    expect(formatDate('not a date')).toBe('—');
  });

  it('describes relative time in both directions', () => {
    const day = 86_400_000;
    expect(relativeDays(new Date())).toBe('today');
    expect(relativeDays(new Date(Date.now() + day))).toBe('tomorrow');
    expect(relativeDays(new Date(Date.now() - day))).toBe('yesterday');
    expect(relativeDays(new Date(Date.now() + 5 * day))).toBe('in 5 days');
    expect(relativeDays(new Date(Date.now() - 5 * day))).toBe('5 days ago');
  });

  it('treats only past dates as overdue', () => {
    expect(isOverdue(new Date(Date.now() - 86_400_000))).toBe(true);
    expect(isOverdue(new Date(Date.now() + 86_400_000))).toBe(false);
    // No due date is not overdue — an invoice without one must not turn red.
    expect(isOverdue(null)).toBe(false);
  });
});

describe('status humanisation', () => {
  it('turns stored enum values into readable labels', () => {
    expect(humanize('PAYMENT_PROCESSING')).toBe('Payment Processing');
    expect(humanize('PAID')).toBe('Paid');
    expect(humanize(undefined)).toBe('—');
  });
});
