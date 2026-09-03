import { describe, expect, it } from 'vitest';
import { parseInvoiceDate } from './invoice.service.js';

describe('invoice date parsing', () => {
  it('reads the formats that appear on Indian invoices', () => {
    expect(parseInvoiceDate('2026-09-05')?.toISOString()).toBe('2026-09-05T00:00:00.000Z');
    expect(parseInvoiceDate('05-Sep-2026')?.toISOString()).toBe('2026-09-05T00:00:00.000Z');
    expect(parseInvoiceDate('5 September 2026')?.toISOString()).toBe('2026-09-05T00:00:00.000Z');
  });

  it('treats ambiguous numeric dates as day-first', () => {
    // 05/09/2026 is 5 September in India, not 9 May.
    expect(parseInvoiceDate('05/09/2026')?.getUTCMonth()).toBe(8);
    expect(parseInvoiceDate('05/09/2026')?.getUTCDate()).toBe(5);
  });

  it('expands two-digit years', () => {
    expect(parseInvoiceDate('05-09-26')?.getUTCFullYear()).toBe(2026);
  });

  it('returns null for text that is not a date', () => {
    expect(parseInvoiceDate('not a date')).toBeNull();
  });
});
