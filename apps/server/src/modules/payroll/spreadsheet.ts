import { parse as parseCsv } from 'csv-parse/sync';
import ExcelJS from 'exceljs';

/**
 * Spreadsheet reading shared by payroll import and bank statement import.
 *
 * Both features receive files produced by humans and other systems, so the
 * reader tolerates the usual mess: a title row above the real header, blank
 * rows, and merged/blank header cells.
 */

export interface SheetTable {
  /** Header labels exactly as they appear in the file. */
  headers: string[];
  /** Data rows keyed by header label. */
  rows: Array<Record<string, unknown>>;
  /** 1-based sheet row number of each entry in `rows`. */
  rowNumbers: number[];
  sheetName?: string;
}

export async function readTable(
  content: Buffer,
  fileName: string,
  options: { headerRow?: number; sheet?: string } = {},
): Promise<SheetTable> {
  return /\.csv$/i.test(fileName) ? readCsv(content, options) : readXlsx(content, options);
}

function readCsv(content: Buffer, options: { headerRow?: number }): SheetTable {
  const records = parseCsv(content, {
    skip_empty_lines: true,
    relax_column_count: true,
    bom: true,
  }) as string[][];

  const headerIndex = options.headerRow ? options.headerRow - 1 : detectHeaderRow(records);
  const headers = normalizeHeaders(records[headerIndex] ?? []);

  const rows: Array<Record<string, unknown>> = [];
  const rowNumbers: number[] = [];
  for (let index = headerIndex + 1; index < records.length; index += 1) {
    const record = records[index]!;
    if (record.every((cell) => String(cell ?? '').trim() === '')) continue;
    rows.push(toRecord(headers, record));
    rowNumbers.push(index + 1);
  }

  return { headers, rows, rowNumbers };
}

async function readXlsx(
  content: Buffer,
  options: { headerRow?: number; sheet?: string },
): Promise<SheetTable> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(content as unknown as ArrayBuffer);

  const sheet = options.sheet ? workbook.getWorksheet(options.sheet) : workbook.worksheets[0];
  if (!sheet) throw new Error('The workbook has no readable sheet');

  const matrix: unknown[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const values = row.values as unknown[];
    // ExcelJS row.values is 1-indexed with a leading hole.
    matrix[rowNumber - 1] = values.slice(1).map(cellValue);
  });

  const dense = matrix.map((row) => row ?? []);
  const headerIndex = options.headerRow ? options.headerRow - 1 : detectHeaderRow(dense);
  const headers = normalizeHeaders((dense[headerIndex] ?? []).map((value) => String(value ?? '')));

  const rows: Array<Record<string, unknown>> = [];
  const rowNumbers: number[] = [];
  for (let index = headerIndex + 1; index < dense.length; index += 1) {
    const record = dense[index] ?? [];
    if (record.every((cell) => cell === null || cell === undefined || String(cell).trim() === '')) {
      continue;
    }
    rows.push(toRecord(headers, record));
    rowNumbers.push(index + 1);
  }

  return { headers, rows, rowNumbers, sheetName: sheet.name };
}

/** ExcelJS returns rich objects for formulas, hyperlinks and dates. */
function cellValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'object') {
    const rich = value as { result?: unknown; text?: unknown; richText?: Array<{ text: string }> };
    if (rich.result !== undefined) return rich.result;
    if (Array.isArray(rich.richText)) return rich.richText.map((part) => part.text).join('');
    if (rich.text !== undefined) return rich.text;
  }
  return value;
}

/**
 * Finds the real header row.
 *
 * Payroll and bank exports very often carry a title, a company name and a
 * period above the column headings; taking row 1 blindly would read those as
 * the headers. The row with the most non-empty, non-numeric cells in the
 * first ten rows is the header.
 */
function detectHeaderRow(rows: unknown[][]): number {
  let bestIndex = 0;
  let bestScore = -1;

  for (let index = 0; index < Math.min(rows.length, 10); index += 1) {
    const row = rows[index] ?? [];
    const score = row.filter((cell) => {
      const text = String(cell ?? '').trim();
      return text.length > 0 && Number.isNaN(Number(text));
    }).length;
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }
  return bestIndex;
}

/** Blank header cells still need a stable key so their column is addressable. */
function normalizeHeaders(raw: unknown[]): string[] {
  return raw.map((value, index) => {
    const text = String(value ?? '').trim();
    return text || `Column ${index + 1}`;
  });
}

function toRecord(headers: string[], values: unknown[]): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  headers.forEach((header, index) => {
    record[header] = values[index] ?? null;
  });
  return record;
}

/**
 * Maps our field names to the sheet's actual column headings.
 *
 * Uploaders name columns differently every time ("Net Salary", "NET PAY",
 * "Amount"), so each field carries a list of accepted aliases; matching is
 * case- and punctuation-insensitive, exact aliases first and then substrings.
 */
export function autoDetectColumns<T extends string>(
  headers: string[],
  aliases: Record<T, string[]>,
): Partial<Record<T, string>> {
  const normalized = headers.map((header) => ({ header, key: canonical(header) }));
  const mapping: Partial<Record<T, string>> = {};
  const taken = new Set<string>();

  for (const pass of ['exact', 'partial'] as const) {
    for (const [field, candidates] of Object.entries(aliases) as Array<[T, string[]]>) {
      if (mapping[field]) continue;

      for (const candidate of candidates) {
        const target = canonical(candidate);
        const match = normalized.find(
          (entry) =>
            !taken.has(entry.header) &&
            (pass === 'exact' ? entry.key === target : entry.key.includes(target)),
        );
        if (match) {
          mapping[field] = match.header;
          taken.add(match.header);
          break;
        }
      }
    }
  }

  return mapping;
}

function canonical(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}
