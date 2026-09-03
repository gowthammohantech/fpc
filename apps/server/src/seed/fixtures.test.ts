import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { toMinor } from '@fpc/shared';
import { StubExtractor } from '../integrations/ocr/stub.driver.js';
import { parseStatement } from '../modules/banking/statement.import.js';
import { parsePayrollFile } from '../modules/payroll/payroll.import.js';
import {
  buildPdf,
  writeInvoicePdf,
  writePayrollWorkbook,
  writeStatementWorkbook,
} from './fixtures.js';
import { readFile } from 'node:fs/promises';

/**
 * The demo fixtures are only useful if the product's own importers can read
 * them. These tests run the generated files back through the real extractor
 * and importers, so a broken demo is caught here rather than in front of an
 * audience.
 */
let directory: string;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'fpc-fixtures-'));
});

afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('invoice PDF fixture', () => {
  it('produces a PDF the extractor can actually read fields from', async () => {
    const path = join(directory, 'INV-9930.pdf');
    await writeInvoicePdf(path);

    const content = await readFile(path);
    expect(content.subarray(0, 8).toString()).toContain('%PDF-1.4');

    const extraction = await new StubExtractor().extract({
      fileName: 'INV-9930.pdf',
      contentType: 'application/pdf',
      content,
      knownVendorNames: ['TechZone Solutions Pvt Ltd'],
    });

    expect(extraction.fields.invoiceNumber?.value).toBe('INV-9930');
    expect(extraction.fields.vendorName?.value).toBe('TechZone Solutions Pvt Ltd');
    expect(extraction.fields.gstin?.value).toBe('33AAACT2727Q1ZW');
    expect(extraction.fields.ifsc?.value).toBe('HDFC0001234');
    expect(extraction.overallConfidence).toBeGreaterThan(0.5);
  });

  it('escapes PDF syntax characters so the file stays valid', () => {
    const pdf = buildPdf(['Vendor (Pvt) Ltd \\ Special']).toString('latin1');
    expect(pdf).toContain('\\(Pvt\\)');
    expect(pdf).toContain('%%EOF');
  });
});

describe('payroll workbook fixture', () => {
  it('imports as 850 employees totalling the PRD figure', async () => {
    const path = join(directory, 'payroll.xlsx');
    await writePayrollWorkbook(path);

    const result = await parsePayrollFile(await readFile(path), 'payroll.xlsx');

    expect(result.employeeCount).toBe(850);
    expect(result.rejected).toHaveLength(0);
    // Every row must be payable: no IFSC, account or duplicate errors.
    expect(result.rows.filter((row) => row.findings.length)).toHaveLength(0);
    expect(result.locationBreakdown.map((entry) => entry.locationName).sort()).toEqual([
      'Bengaluru',
      'Chennai',
      'Pune',
    ]);
    // Within a rounding rupee of ₹6.20 Cr.
    expect(Math.abs(result.totalNetAmount - toMinor(6_20_00_000))).toBeLessThan(toMinor(1_000));
  });

  it('finds the header row beneath the title block', async () => {
    const path = join(directory, 'payroll2.xlsx');
    await writePayrollWorkbook(path);
    const result = await parsePayrollFile(await readFile(path), 'payroll2.xlsx');
    expect(result.mapping.employeeCode).toBe('Employee ID');
    expect(result.mapping.netAmount).toBe('Net Salary');
  });
});

describe('bank statement fixture', () => {
  it('imports with debits, a credit and a bank charge', async () => {
    const path = join(directory, 'statement.xlsx');
    await writeStatementWorkbook(path);

    const result = await parseStatement(await readFile(path), 'statement.xlsx', 'acct-1');

    const debits = result.transactions.filter((entry) => entry.direction === 'DEBIT');
    const credits = result.transactions.filter((entry) => entry.direction === 'CREDIT');

    expect(debits).toHaveLength(4);
    expect(credits).toHaveLength(1);

    // The TechZone line must match the seeded invoice exactly, or the demo's
    // reconciliation step produces no suggestion.
    const techzone = debits.find((entry) => entry.description.includes('TECHZONE'));
    expect(techzone?.amount).toBe(toMinor(35_40_000));

    // A bank charge is present so the demo exercises the ignore path.
    expect(debits.some((entry) => entry.description.includes('BANK CHARGES'))).toBe(true);
  });

  it('gives every row a distinct dedupe hash', async () => {
    const path = join(directory, 'statement2.xlsx');
    await writeStatementWorkbook(path);
    const result = await parseStatement(await readFile(path), 'statement2.xlsx', 'acct-1');
    const hashes = new Set(result.transactions.map((entry) => entry.dedupeHash));
    expect(hashes.size).toBe(result.transactions.length);
  });
});
