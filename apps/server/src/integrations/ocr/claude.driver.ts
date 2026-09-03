import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
// The SDK's zodOutputFormat helper is built against Zod 4; the rest of the
// codebase uses the classic Zod 3 API, and zod ships both under one package.
import * as z from 'zod/v4';
import type { ExtractedField, ExtractionResult } from '@fpc/shared';
import { logger } from '../../config/logger.js';
import type { DocumentExtractor, ExtractionInput } from './types.js';

/**
 * Confidence is self-reported by the model.
 *
 * It is a useful triage signal — it reliably separates "read this cleanly off
 * the page" from "inferred this" — but it is not a calibrated probability, and
 * the product treats it accordingly: low confidence routes a field to human
 * review, it never gates a payment on its own.
 */
const field = z.object({
  value: z.string().nullable().describe('Verbatim value from the document, or null if absent'),
  confidence: z.number().min(0).max(1).describe('0-1; how clearly this was stated in the document'),
});

const extractionSchema = z.object({
  vendorName: field.describe('The supplier issuing the invoice, not the recipient'),
  invoiceNumber: field,
  invoiceDate: field.describe('ISO 8601 (YYYY-MM-DD)'),
  dueDate: field.describe('ISO 8601 (YYYY-MM-DD)'),
  currency: field.describe('ISO 4217 code, e.g. INR'),
  subtotal: field.describe('Amount before tax, digits and decimal point only'),
  taxAmount: field.describe('Total tax, digits and decimal point only'),
  totalAmount: field.describe('Total payable, digits and decimal point only'),
  gstin: field.describe("The supplier's GSTIN"),
  bankAccountNumber: field,
  ifsc: field,
  lineItems: z
    .array(
      z.object({
        description: z.string(),
        quantity: z.number().nullable(),
        unitPrice: z.number().nullable(),
        amount: z.number().nullable(),
        hsnSac: z.string().nullable(),
        taxRate: z.number().nullable(),
      }),
    )
    .describe('Line items if the invoice itemises them; empty array otherwise'),
});

const SYSTEM_PROMPT = [
  'You extract structured data from supplier invoices for an accounts payable system.',
  'Report only what the document states. If a field is absent, return null with confidence 0 —',
  'never infer, compute, or guess a value to fill a gap.',
  'Amounts must be digits and an optional decimal point, with no currency symbol or thousands',
  'separators. Indian invoices often use lakh/crore grouping (35,40,000.00): read the grouping',
  'correctly and return 3540000.00.',
  'The vendor is the party issuing the invoice, never the party being billed.',
].join(' ');

/** Extraction backed by Claude's vision and document understanding. */
export class ClaudeExtractor implements DocumentExtractor {
  readonly name = 'claude';
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    private readonly model: string,
  ) {
    this.client = new Anthropic({ apiKey });
  }

  async extract(input: ExtractionInput): Promise<ExtractionResult> {
    const response = await this.client.messages.parse({
      model: this.model,
      max_tokens: 16_000,
      system: SYSTEM_PROMPT,
      output_config: { format: zodOutputFormat(extractionSchema) },
      messages: [
        {
          role: 'user',
          content: [
            this.documentBlock(input),
            {
              type: 'text',
              text: input.knownVendorNames?.length
                ? `Extract this invoice. If the supplier matches one of these known vendors, use that exact spelling: ${input.knownVendorNames.slice(0, 100).join(', ')}.`
                : 'Extract this invoice.',
            },
          ],
        },
      ],
    });

    const parsed = response.parsed_output;
    if (!parsed) {
      logger.warn({ file: input.fileName }, 'claude extraction returned no parsable output');
      return empty(this.name, this.model);
    }

    const { lineItems, ...rest } = parsed as z.infer<typeof extractionSchema>;
    const fields: Record<string, ExtractedField<string | number>> = {};
    for (const [key, value] of Object.entries(rest)) {
      const extracted = value as z.infer<typeof field>;
      if (extracted.value === null) continue;
      fields[key] = { value: extracted.value, confidence: extracted.confidence, source: 'OCR' };
    }

    const confidences = Object.values(fields).map((entry) => entry.confidence);
    return {
      fields,
      lineItems: lineItems.map((item) => ({
        description: item.description,
        quantity: item.quantity ?? undefined,
        unitPrice: item.unitPrice ?? undefined,
        amount: item.amount ?? undefined,
        hsnSac: item.hsnSac ?? undefined,
        taxRate: item.taxRate ?? undefined,
      })),
      provider: this.name,
      model: this.model,
      extractedAt: new Date().toISOString(),
      overallConfidence: confidences.length
        ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length
        : 0,
    };
  }

  /** PDFs go in as documents; JPEG/PNG as images. */
  private documentBlock(input: ExtractionInput): Anthropic.ContentBlockParam {
    const data = input.content.toString('base64');
    if (input.contentType === 'application/pdf') {
      return {
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data },
      };
    }
    return {
      type: 'image',
      source: {
        type: 'base64',
        media_type: input.contentType as 'image/jpeg' | 'image/png',
        data,
      },
    };
  }
}

function empty(provider: string, model?: string): ExtractionResult {
  return {
    fields: {},
    lineItems: [],
    provider,
    model,
    extractedAt: new Date().toISOString(),
    overallConfidence: 0,
  };
}
