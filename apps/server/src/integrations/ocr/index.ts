import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { AzureDocumentIntelligenceExtractor } from './azureDocIntel.driver.js';
import { ClaudeExtractor } from './claude.driver.js';
import { StubExtractor } from './stub.driver.js';
import type { DocumentExtractor } from './types.js';

export * from './types.js';

let instance: DocumentExtractor | null = null;

/** The configured extraction driver (OCR_DRIVER). */
export function extractor(): DocumentExtractor {
  if (instance) return instance;

  if (env.OCR_DRIVER === 'claude') {
    if (!env.ANTHROPIC_API_KEY) throw new Error('OCR_DRIVER=claude requires ANTHROPIC_API_KEY');
    instance = new ClaudeExtractor(env.ANTHROPIC_API_KEY, env.ANTHROPIC_MODEL);
  } else if (env.OCR_DRIVER === 'azure-doc-intelligence') {
    if (!env.AZURE_DOC_INTEL_ENDPOINT || !env.AZURE_DOC_INTEL_KEY) {
      throw new Error(
        'OCR_DRIVER=azure-doc-intelligence requires AZURE_DOC_INTEL_ENDPOINT and AZURE_DOC_INTEL_KEY',
      );
    }
    instance = new AzureDocumentIntelligenceExtractor(
      env.AZURE_DOC_INTEL_ENDPOINT,
      env.AZURE_DOC_INTEL_KEY,
    );
  } else {
    instance = new StubExtractor(env.MAIL_FIXTURE_DIR);
  }

  logger.info({ driver: instance.name }, 'document extractor ready');
  return instance;
}

/** Test seam. */
export function setExtractor(driver: DocumentExtractor | null): void {
  instance = driver;
}
