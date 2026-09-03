import type { ExtractedField, ExtractionResult } from '@fpc/shared';
import { logger } from '../../config/logger.js';
import type { DocumentExtractor, ExtractionInput } from './types.js';

/**
 * Azure Document Intelligence prebuilt-invoice model.
 *
 * Uses the REST API directly rather than the SDK: the request is a single
 * analyse-and-poll cycle, and this keeps the dependency surface small.
 * Unlike the Claude driver, the confidences here are the service's own.
 */
export class AzureDocumentIntelligenceExtractor implements DocumentExtractor {
  readonly name = 'azure-doc-intelligence';

  constructor(
    private readonly endpoint: string,
    private readonly apiKey: string,
  ) {}

  async extract(input: ExtractionInput): Promise<ExtractionResult> {
    const url = `${this.endpoint.replace(/\/$/, '')}/documentintelligence/documentModels/prebuilt-invoice:analyze?api-version=2024-11-30`;

    const started = await fetch(url, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': this.apiKey,
        'Content-Type': input.contentType,
      },
      body: new Uint8Array(input.content),
    });
    if (!started.ok) {
      throw new Error(`Document Intelligence rejected the document: ${started.status}`);
    }

    const operationUrl = started.headers.get('operation-location');
    if (!operationUrl) throw new Error('Document Intelligence returned no operation-location');

    const result = await this.poll(operationUrl);
    return this.toExtraction(result);
  }

  private async poll(operationUrl: string, attempts = 30): Promise<AnalyzeResult> {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      await delay(attempt === 0 ? 1000 : 2000);
      const response = await fetch(operationUrl, {
        headers: { 'Ocp-Apim-Subscription-Key': this.apiKey },
      });
      const body = (await response.json()) as {
        status: string;
        analyzeResult?: AnalyzeResult;
        error?: { message?: string };
      };
      if (body.status === 'succeeded' && body.analyzeResult) return body.analyzeResult;
      if (body.status === 'failed') {
        throw new Error(`Document Intelligence failed: ${body.error?.message ?? 'unknown error'}`);
      }
    }
    throw new Error('Document Intelligence timed out');
  }

  private toExtraction(result: AnalyzeResult): ExtractionResult {
    const document = result.documents?.[0];
    const source = document?.fields ?? {};
    const fields: Record<string, ExtractedField<string | number>> = {};

    const mapping: Record<string, string> = {
      VendorName: 'vendorName',
      InvoiceId: 'invoiceNumber',
      InvoiceDate: 'invoiceDate',
      DueDate: 'dueDate',
      SubTotal: 'subtotal',
      TotalTax: 'taxAmount',
      InvoiceTotal: 'totalAmount',
      VendorTaxId: 'gstin',
    };

    for (const [azureField, ourField] of Object.entries(mapping)) {
      const value = source[azureField];
      if (!value) continue;
      const extracted = value.valueCurrency?.amount ?? value.valueDate ?? value.content;
      if (extracted === undefined || extracted === null) continue;
      fields[ourField] = {
        value: typeof extracted === 'number' ? extracted : String(extracted),
        confidence: value.confidence ?? 0.5,
        source: 'OCR',
      };
    }

    const confidences = Object.values(fields).map((entry) => entry.confidence);
    logger.debug({ fields: Object.keys(fields) }, 'document intelligence extraction complete');

    return {
      fields,
      lineItems: (source.Items?.valueArray ?? []).map((item) => ({
        description: item.valueObject?.Description?.content ?? '',
        quantity: item.valueObject?.Quantity?.valueNumber,
        amount: item.valueObject?.Amount?.valueCurrency?.amount,
      })),
      provider: this.name,
      model: 'prebuilt-invoice',
      extractedAt: new Date().toISOString(),
      overallConfidence: confidences.length
        ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length
        : 0,
    };
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface AnalyzeField {
  content?: string;
  confidence?: number;
  valueDate?: string;
  valueNumber?: number;
  valueCurrency?: { amount?: number };
  valueArray?: Array<{ valueObject?: Record<string, AnalyzeField> }>;
}

interface AnalyzeResult {
  documents?: Array<{ fields?: Record<string, AnalyzeField> }>;
}
