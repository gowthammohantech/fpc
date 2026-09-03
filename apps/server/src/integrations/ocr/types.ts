import type { ExtractionResult } from '@fpc/shared';

export interface ExtractionInput {
  fileName: string;
  contentType: string;
  content: Buffer;
  /** Vendor names already known for this company, to help resolve the payee. */
  knownVendorNames?: string[];
}

/**
 * Invoice field extraction (PRD §12).
 *
 * Implementations return a value **and a confidence** for every field, because
 * the review screen highlights anything the extractor was unsure about rather
 * than presenting all values as equally trustworthy.
 */
export interface DocumentExtractor {
  readonly name: string;
  extract(input: ExtractionInput): Promise<ExtractionResult>;
}

/** Field names the platform understands. Extractors should populate these. */
export const EXTRACTION_FIELDS = [
  'vendorName',
  'invoiceNumber',
  'invoiceDate',
  'dueDate',
  'currency',
  'subtotal',
  'taxAmount',
  'totalAmount',
  'gstin',
  'bankAccountNumber',
  'ifsc',
] as const;
export type ExtractionField = (typeof EXTRACTION_FIELDS)[number];
