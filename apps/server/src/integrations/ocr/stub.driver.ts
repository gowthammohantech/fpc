import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import type { ExtractedField, ExtractionResult } from '@fpc/shared';
import { normalizeName } from '@fpc/shared';
import { logger } from '../../config/logger.js';
import type { DocumentExtractor, ExtractionInput } from './types.js';

const require = createRequire(import.meta.url);

/**
 * Credential-free extractor used by default in development and demos.
 *
 * It works two ways, in order:
 *
 *  1. A `<file>.extract.json` sidecar next to the fixture, which lets the demo
 *     produce an exact, repeatable extraction (this is how INV-9821 yields the
 *     confidences shown in the PRD).
 *  2. Otherwise, plain-text regex extraction over the PDF's text layer. This is
 *     genuinely useful for text-based PDFs and reports honest, moderate
 *     confidences, so the review queue behaves realistically offline.
 *
 * It is not an OCR engine — scanned images produce no fields, which correctly
 * routes the invoice to manual review.
 */
export class StubExtractor implements DocumentExtractor {
  readonly name = 'stub';

  constructor(private readonly fixtureDir?: string) {}

  async extract(input: ExtractionInput): Promise<ExtractionResult> {
    const sidecar = await this.readSidecar(input.fileName);
    if (sidecar) return sidecar;

    const text = await this.textOf(input);
    const fields = text ? extractFromText(text, input.knownVendorNames ?? []) : {};

    return {
      fields,
      lineItems: [],
      rawText: text?.slice(0, 20_000),
      provider: this.name,
      extractedAt: new Date().toISOString(),
      overallConfidence: meanConfidence(fields),
    };
  }

  private async textOf(input: ExtractionInput): Promise<string | null> {
    if (input.contentType === 'text/plain') return input.content.toString('utf8');
    if (input.contentType !== 'application/pdf') return null;
    try {
      // pdf-parse is CommonJS and reads a sample file at import time under ESM,
      // so it is required lazily and only when a PDF actually arrives.
      const pdfParse = require('pdf-parse') as (buffer: Buffer) => Promise<{ text: string }>;
      const parsed = await pdfParse(input.content);
      return parsed.text;
    } catch (error) {
      logger.warn({ err: error, file: input.fileName }, 'pdf text extraction failed');
      return null;
    }
  }

  private async readSidecar(fileName: string): Promise<ExtractionResult | null> {
    if (!this.fixtureDir) return null;
    for (const directory of [this.fixtureDir, `${this.fixtureDir}/processed`]) {
      try {
        const raw = await readFile(`${directory}/${fileName}.extract.json`, 'utf8');
        const parsed = JSON.parse(raw) as Partial<ExtractionResult>;
        return {
          fields: parsed.fields ?? {},
          lineItems: parsed.lineItems ?? [],
          provider: `${this.name}:fixture`,
          extractedAt: new Date().toISOString(),
          overallConfidence: parsed.overallConfidence ?? meanConfidence(parsed.fields ?? {}),
        };
      } catch {
        // Try the next location.
      }
    }
    return null;
  }
}

type Fields = Record<string, ExtractedField<string | number>>;

const PATTERNS: Array<{ field: string; pattern: RegExp; confidence: number }> = [
  {
    field: 'invoiceNumber',
    pattern: /invoice\s*(?:no\.?|number|#)\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-/]{2,30})/i,
    confidence: 0.9,
  },
  {
    field: 'invoiceDate',
    pattern: /invoice\s*date\s*[:\-]?\s*([0-9]{1,2}[-/][A-Za-z0-9]{2,9}[-/][0-9]{2,4}|[0-9]{4}-[0-9]{2}-[0-9]{2})/i,
    confidence: 0.85,
  },
  {
    field: 'dueDate',
    pattern: /due\s*date\s*[:\-]?\s*([0-9]{1,2}[-/][A-Za-z0-9]{2,9}[-/][0-9]{2,4}|[0-9]{4}-[0-9]{2}-[0-9]{2})/i,
    confidence: 0.82,
  },
  {
    field: 'gstin',
    pattern: /\b(\d{2}[A-Z]{5}\d{4}[A-Z]\d[A-Z\d]Z[A-Z\d])\b/,
    confidence: 0.95,
  },
  { field: 'ifsc', pattern: /\b([A-Z]{4}0[A-Z0-9]{6})\b/, confidence: 0.9 },
  {
    field: 'subtotal',
    pattern: /(?:sub\s*total|taxable\s*value)\s*[:\-]?\s*(?:₹|INR|Rs\.?)?\s*([\d,]+(?:\.\d{1,2})?)/i,
    confidence: 0.8,
  },
  {
    field: 'taxAmount',
    pattern: /(?:total\s*tax|tax\s*amount|gst)\s*[:\-]?\s*(?:₹|INR|Rs\.?)?\s*([\d,]+(?:\.\d{1,2})?)/i,
    confidence: 0.78,
  },
  {
    field: 'totalAmount',
    pattern: /(?:grand\s*total|total\s*amount|amount\s*payable|total)\s*[:\-]?\s*(?:₹|INR|Rs\.?)?\s*([\d,]+(?:\.\d{1,2})?)/i,
    confidence: 0.85,
  },
];

function extractFromText(text: string, knownVendorNames: string[]): Fields {
  const fields: Fields = {};

  for (const { field, pattern, confidence } of PATTERNS) {
    const match = pattern.exec(text);
    if (match?.[1]) fields[field] = { value: match[1].trim(), confidence, source: 'OCR' };
  }

  // Resolving the vendor against the master is far more reliable than trying
  // to guess which line of the header is the supplier's name.
  const normalizedText = normalizeName(text);
  const vendor = knownVendorNames.find((name) => {
    const normalized = normalizeName(name);
    return normalized.length > 3 && normalizedText.includes(normalized);
  });
  if (vendor) fields.vendorName = { value: vendor, confidence: 0.93, source: 'OCR' };

  fields.currency = { value: /₹|INR|Rs\.?/i.test(text) ? 'INR' : 'INR', confidence: 0.99, source: 'OCR' };
  return fields;
}

function meanConfidence(fields: Fields): number {
  const values = Object.values(fields).map((field) => field.confidence);
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
