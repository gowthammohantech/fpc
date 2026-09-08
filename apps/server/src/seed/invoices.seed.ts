import { Types, type HydratedDocument } from 'mongoose';
import {
  ApprovalStatus,
  InvoiceStatus,
  computeTds,
  netPayableFor,
  tdsBaseFor,
  toMinor,
  type ExtractionResult,
  type TdsSection,
  type ValidationFinding,
} from '@fpc/shared';
import { logger } from '../config/logger.js';
import { Invoice, type InvoiceDoc } from '../models/invoice.model.js';
import { ApprovalRequest } from '../models/approvalRequest.model.js';
import { act, startApproval } from '../modules/approvals/approval.service.js';
import { onApprovalDecided } from '../modules/approvals/approval.dispatcher.js';
import { audit } from '../modules/audit/audit.service.js';
import { REFERENCE_PREFIX, nextReference } from '../core/sequence.js';
import * as financeRequests from '../modules/financeRequests/financeRequest.service.js';
import * as invoiceService from '../modules/invoices/invoice.service.js';
import { COMPANIES, VENDORS, type VendorSeed } from './data.org.js';
import { INVOICES, type FindingSeed, type InvoiceSeed } from './data.invoices.js';
import { attachInvoiceDocument } from './documents.seed.js';
import { actor, daysFromNow, keyOf, user, type SeedContext } from './context.js';

/** Who prepares and submits work in each company. */
const PREPARER: Record<string, string> = {
  engineering: 'ravi@nova.example.com',
  technologies: 'companyadmin@nova.example.com',
};

/**
 * Creates the invoice register and walks each row to its resting state.
 *
 * The walk drives the real approval services rather than writing statuses, so
 * every seeded invoice is somewhere the product could actually have put it,
 * and the approval chains, audit events and notifications that go with it all
 * exist too.
 */
export async function seedInvoices(context: SeedContext): Promise<number> {
  const byNumber = new Map<string, Types.ObjectId>();
  let created = 0;

  // Existing rows first, so a duplicate finding can point at the invoice it
  // duplicates. The array is ordered accordingly.
  for (const definition of INVOICES) {
    const companyId = context.companyIds[definition.company]!;
    const seedKey = definition.seedKey ?? definition.invoiceNumber!;

    const existing = await Invoice.findOne({
      tenantId: context.tenantId,
      companyId,
      ...(definition.invoiceNumber
        ? { invoiceNumber: definition.invoiceNumber }
        : { documentFileName: `${seedKey}.pdf` }),
    });
    if (existing) {
      if (definition.invoiceNumber) byNumber.set(seedKey, existing._id);
      continue;
    }

    const invoice = await createInvoice(context, definition, byNumber);
    byNumber.set(seedKey, invoice._id);
    created += 1;

    await walk(context, definition, invoice);
  }

  return created;
}

async function createInvoice(
  context: SeedContext,
  definition: InvoiceSeed,
  byNumber: Map<string, Types.ObjectId>,
) {
  const companyId = context.companyIds[definition.company]!;
  const vendor = definition.vendor
    ? VENDORS.find(
        (entry) => entry.company === definition.company && entry.code === definition.vendor,
      )
    : undefined;
  const invoiceDate = daysFromNow(-definition.daysAgo);

  return Invoice.create({
    tenantId: context.tenantId,
    companyId,
    // The tracking ID is what a person quotes; allocated at intake in the
    // service, and here so seeded rows are quotable too.
    trackingId: await nextReference(context.tenantId, REFERENCE_PREFIX.INVOICE),
    groupId: context.groupIds.nova,
    locationId: definition.location
      ? context.locationIds[keyOf(definition.company, definition.location)]
      : undefined,
    departmentId: definition.department
      ? context.departmentIds[keyOf(definition.company, definition.department)]
      : undefined,
    regionId: definition.region
      ? context.regionIds[keyOf(definition.company, definition.region)]
      : undefined,
    verticalId: definition.vertical
      ? context.verticalIds[keyOf(definition.company, definition.vertical)]
      : undefined,
    businessUnitId: definition.businessUnit
      ? context.businessUnitIds[keyOf(definition.company, definition.businessUnit)]
      : undefined,
    vendorId: definition.vendor
      ? context.vendorIds[keyOf(definition.company, definition.vendor)]
      : undefined,
    vendorName: vendor?.name,
    invoiceNumber: definition.invoiceNumber,
    invoiceDate: definition.extraction === 'SPARSE' ? undefined : invoiceDate,
    dueDate: definition.dueInDays === undefined ? undefined : daysFromNow(definition.dueInDays),
    currency: 'INR',
    subtotal: definition.subtotal === undefined ? undefined : toMinor(definition.subtotal),
    taxAmount: definition.tax === undefined ? undefined : toMinor(definition.tax),
    totalAmount: definition.total === undefined ? undefined : toMinor(definition.total),
    gstin: vendor?.gstin,
    // Proposed from the vendor master, exactly as `applyExtraction` does for a
    // real invoice; the accounting stage below confirms or overrides it.
    ...proposedTds(vendor, definition),
    status: InvoiceStatus.RECEIVED,
    source: definition.source ?? 'EMAIL',
    // Doubles as the idempotency key for the row with no invoice number.
    documentFileName: `${definition.seedKey ?? definition.invoiceNumber}.pdf`,
    receivedAt: invoiceDate,
    senderEmail: vendor?.email,
    approvalStatus: ApprovalStatus.NOT_REQUIRED,
    extraction: extractionFor(definition, vendor?.name),
    extractionAttempts: definition.extractionAttempts ?? 0,
    extractionError: definition.extractionError,
    findings: (definition.findings ?? []).map((finding) => toFinding(finding, byNumber)),
  });
}

/** Walks one invoice from RECEIVED to wherever its definition stops. */
/**
 * The TDS figures a seeded invoice arrives with.
 *
 * Mirrors `invoice.service.proposeTds`, which cannot be reused directly here
 * because the seed builds a plain object rather than a hydrated document.
 */
function proposedTds(vendor: VendorSeed | undefined, definition: InvoiceSeed) {
  const amounts = {
    subtotal: definition.subtotal === undefined ? undefined : toMinor(definition.subtotal),
    taxAmount: definition.tax === undefined ? undefined : toMinor(definition.tax),
    totalAmount: definition.total === undefined ? undefined : toMinor(definition.total),
  };
  const applicable = !!vendor?.tdsApplicable && !!vendor.pan && !!vendor.tdsRateBasisPoints;
  if (!applicable) {
    return {
      tdsApplicable: false,
      tdsAmount: 0,
      netPayable: amounts.totalAmount ?? 0,
    };
  }

  const base = tdsBaseFor(amounts);
  const tdsAmount = computeTds({
    tdsApplicable: true,
    baseAmount: base,
    rateBasisPoints: vendor.tdsRateBasisPoints,
  });
  return {
    tdsApplicable: true,
    tdsSection: vendor.tdsSection as TdsSection,
    tdsRateBasisPoints: vendor.tdsRateBasisPoints,
    tdsBaseAmount: base,
    tdsAmount,
    netPayable: netPayableFor(amounts.totalAmount ?? 0, tdsAmount),
  };
}

async function walk(
  context: SeedContext,
  definition: InvoiceSeed,
  invoice: HydratedDocument<InvoiceDoc>,
): Promise<void> {
  const preparerEmail = PREPARER[definition.company]!;
  const preparer = user(context, preparerEmail);
  const preparerContext = actor(context, preparerEmail);
  const company = COMPANIES.find((entry) => entry.key === definition.company)!;
  const vendor = definition.vendor
    ? VENDORS.find(
        (entry) => entry.company === definition.company && entry.code === definition.vendor,
      )
    : undefined;

  await attachInvoiceDocument(invoice, {
    fileName: `${definition.seedKey ?? definition.invoiceNumber}.pdf`.replace(/[^\w.-]/g, '_'),
    description: definition.description,
    gstin: vendor?.gstin,
    companyName: company.name,
    uploadedBy: preparer.id,
  });

  if (definition.stopAt === 'RECEIVED') {
    await invoice.save();
    return;
  }

  invoice.status = InvoiceStatus.EXTRACTING;

  if (definition.stopAt === 'FAILED') {
    invoice.status = InvoiceStatus.FAILED;
    await invoice.save();
    return;
  }

  invoice.status = InvoiceStatus.REVIEW_REQUIRED;
  await invoice.save();

  if (definition.stopAt === 'REVIEW_REQUIRED') return;

  if (definition.stopAt === 'CANCELLED' || definition.stopAt === 'DUPLICATE') {
    const from = invoice.status;
    invoice.status =
      definition.stopAt === 'CANCELLED' ? InvoiceStatus.CANCELLED : InvoiceStatus.DUPLICATE;
    await invoice.save();
    await audit.recordStatusChange(
      {
        event: definition.stopAt === 'CANCELLED' ? 'invoice.cancelled' : 'invoice.duplicate',
        entityType: 'INVOICE',
        entityId: invoice._id,
        entityLabel: invoice.invoiceNumber,
        tenantId: invoice.tenantId,
        companyId: invoice.companyId,
        from,
        to: invoice.status,
        reason: definition.cancelReason,
      },
      preparerContext,
    );
    return;
  }

  invoice.status = InvoiceStatus.VALIDATED;
  invoice.status = InvoiceStatus.SUBMITTED;
  invoice.submittedBy = preparer.id;
  invoice.submittedAt = daysFromNow(-definition.daysAgo + 1);
  await invoice.save();

  const outcome = await startApproval(
    {
      tenantId: invoice.tenantId,
      companyId: invoice.companyId,
      subjectType: 'VENDOR_INVOICE',
      subjectId: invoice._id,
      subjectLabel: `${invoice.vendorName ?? 'Invoice'} ${invoice.invoiceNumber ?? ''}`.trim(),
      amount: invoice.totalAmount ?? 0,
      requestedByUserId: preparer.id,
      departmentId: invoice.departmentId,
      locationId: invoice.locationId,
      vendorId: invoice.vendorId,
    },
    preparerContext,
  );

  if (!outcome.request) {
    // No rule matched, so business approval is skipped — but accounting still
    // has to see it, exactly as the submit route does.
    invoice.status = InvoiceStatus.ACCOUNTING_VERIFICATION;
    invoice.approvalStatus = ApprovalStatus.APPROVED;
    await invoice.save();
    await runAccountingStage(context, definition, invoice);
    return;
  }

  invoice.status = InvoiceStatus.PENDING_APPROVAL;
  invoice.approvalRequestId = outcome.request._id;
  invoice.approvalStatus = ApprovalStatus.IN_PROGRESS;
  await invoice.save();

  if (definition.stopAt === 'PENDING_APPROVAL') return;

  const stepCount = outcome.request.steps.length;
  const decisions =
    definition.stopAt === 'REJECTED'
      ? 1
      : definition.stopAt === 'PARTIALLY_APPROVED'
        ? Math.min(1, stepCount - 1)
        : stepCount;

  for (let index = 0; index < decisions; index += 1) {
    const decision = await actOnCurrentStep(
      context,
      outcome.request._id,
      preparer.id,
      definition.stopAt === 'REJECTED' ? 'REJECT' : 'APPROVE',
      definition.decisionComment,
    );
    if (!decision) break;
    if (decision.completed) {
      // `onApprovalDecided` creates the payment obligation, which refuses a
      // vendor with no bank details on file. That is the point of the Swift
      // Logistics row: it rests at APPROVED, visibly unpayable.
      // Business approval hands the invoice to accounting; the obligation is
      // created later, by the accounting stage below.
      await onApprovalDecided(decision.decision, decision.context);
      break;
    }
  }

  if (definition.stopAt === 'PARTIALLY_APPROVED') {
    await backdateChain(outcome.request._id, definition.daysAgo);
    return;
  }

  if (definition.stopAt === 'REJECTED') return;

  const fresh = await Invoice.findById(invoice._id);
  if (fresh?.status === InvoiceStatus.ACCOUNTING_VERIFICATION) {
    await runAccountingStage(context, definition, fresh);
  }
}

/**
 * Drives the accounting and trustee stages for a seeded invoice.
 *
 * Uses the real services rather than assigning statuses, so the seeded rows
 * carry the same audit trail, TDS figures and obligations a live invoice
 * would — which is what makes the demo data trustworthy as a fixture.
 */
async function runAccountingStage(
  context: SeedContext,
  definition: InvoiceSeed,
  invoice: HydratedDocument<InvoiceDoc>,
): Promise<void> {
  if (definition.stopAt === 'ACCOUNTING_VERIFICATION') return;

  const accountant = user(context, ACCOUNTING_EMAIL);
  const accountantContext = actor(context, ACCOUNTING_EMAIL);

  if (definition.stopAt === 'TRUSTEE_APPROVAL') {
    await financeRequests.open(
      {
        invoice,
        priority: definition.trusteePriority ?? 'P2',
        remarks: definition.trusteeRemarks ?? 'Escalated for a trustee decision.',
        requestedByUserId: accountant.id,
        requestedByName: accountant.name,
      },
      accountantContext,
    );
    return;
  }

  invoice.accounting = {
    verifiedByUserId: accountant.id,
    verifiedAt: daysFromNow(-definition.daysAgo + 2),
  };
  await invoice.save();

  try {
    await invoiceService.releaseToAccountsPayable(invoice, accountantContext);
  } catch (error) {
    // `createObligationForInvoice` refuses a vendor with no bank details on
    // file. That is the point of the Swift Logistics row: it rests visibly
    // unpayable rather than silently vanishing from the queue.
    logger.info(
      { invoiceNumber: definition.invoiceNumber, err: (error as Error).message },
      'seeded invoice cleared for payment but could not become a payment obligation',
    );
  }
}

/** The accounting team member every seeded verification is attributed to. */
const ACCOUNTING_EMAIL = 'accounts@nova.example.com';

/**
 * Acts on whatever step is currently active, as an approver who is eligible
 * for it and is not the submitter.
 */
async function actOnCurrentStep(
  context: SeedContext,
  requestId: Types.ObjectId,
  submitterId: Types.ObjectId,
  action: 'APPROVE' | 'REJECT',
  comment?: string,
) {
  const request = await ApprovalRequest.findById(requestId).lean();
  if (!request) return null;

  const step = request.steps.find((entry) => entry.order === request.currentStepOrder);
  if (!step) return null;

  const candidateId = step.candidateUserIds.find((id) => !id.equals(submitterId));
  if (!candidateId) {
    logger.warn(
      { requestId: String(requestId), step: step.order },
      'seed: every approver for this step is the submitter; leaving it pending',
    );
    return null;
  }

  const approver = Object.values(context.users).find((entry) => entry.id.equals(candidateId));
  if (!approver) return null;

  const approverContext = actor(context, approver.email);
  const decision = await act(
    {
      requestId,
      actorUserId: approver.id,
      actorName: approver.name,
      action,
      comment,
    },
    approverContext,
  );

  return { decision, completed: decision.completed, context: approverContext };
}

/**
 * Ages a half-finished chain so the approvals inbox and the Pending Approval
 * report have something overdue to show, rather than everything being minutes
 * old because the seed just ran.
 */
async function backdateChain(requestId: Types.ObjectId, daysAgo: number): Promise<void> {
  const request = await ApprovalRequest.findById(requestId);
  if (!request) return;

  request.requestedAt = daysFromNow(-daysAgo + 1);
  for (const step of request.steps) {
    if (step.actedAt) step.actedAt = daysFromNow(-daysAgo + 2);
    if (step.slaHours) {
      const base = step.status === 'ACTIVE' ? daysFromNow(-daysAgo + 2) : request.requestedAt;
      step.dueAt = new Date(base.getTime() + step.slaHours * 3_600_000);
    }
  }
  request.markModified('steps');
  await request.save();
}

function toFinding(finding: FindingSeed, byNumber: Map<string, Types.ObjectId>): ValidationFinding {
  const { relatedInvoiceNumbers, ...rest } = finding;
  return {
    ...rest,
    resolved: finding.resolved ?? false,
    resolvedAt: finding.resolved ? new Date().toISOString() : undefined,
    relatedEntityIds: (relatedInvoiceNumbers ?? [])
      .map((number) => byNumber.get(number))
      .filter(Boolean)
      .map(String),
  } as ValidationFinding;
}

/**
 * The extraction block behind the review screen's confidence column.
 *
 * The default mirrors the PRD §12 example with the tax amount left low, so
 * there is always one field worth verifying; SPARSE is the barely-readable
 * scan.
 */
function extractionFor(definition: InvoiceSeed, vendorName?: string): ExtractionResult | undefined {
  if (definition.extraction === 'NONE' || definition.stopAt === 'RECEIVED') return undefined;

  const extractedAt = daysFromNow(-definition.daysAgo).toISOString();

  if (definition.extraction === 'SPARSE') {
    return {
      fields: {
        totalAmount: { value: '', confidence: 0.21, source: 'OCR' },
        vendorName: { value: '', confidence: 0.18, source: 'OCR' },
      },
      lineItems: [],
      provider: 'seed',
      extractedAt,
      overallConfidence: 0.2,
    };
  }

  return {
    fields: {
      invoiceNumber: { value: definition.invoiceNumber ?? '', confidence: 0.99, source: 'OCR' },
      vendorName: { value: vendorName ?? '', confidence: 0.98, source: 'OCR' },
      totalAmount: { value: String(definition.total ?? ''), confidence: 0.99, source: 'OCR' },
      invoiceDate: {
        value: daysFromNow(-definition.daysAgo).toISOString().slice(0, 10),
        confidence: 0.94,
        source: 'OCR',
      },
      taxAmount: { value: String(definition.tax ?? ''), confidence: 0.81, source: 'OCR' },
    },
    lineItems: [],
    provider: 'seed',
    extractedAt,
    overallConfidence: 0.94,
  };
}
