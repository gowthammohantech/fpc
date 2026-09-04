import { Types, type HydratedDocument } from 'mongoose';
import {
  ApprovalStatus,
  InvoiceStatus,
  toMinor,
  type ExtractionResult,
  type ValidationFinding,
} from '@fpc/shared';
import { logger } from '../config/logger.js';
import { Invoice, type InvoiceDoc } from '../models/invoice.model.js';
import { ApprovalRequest } from '../models/approvalRequest.model.js';
import { act, startApproval } from '../modules/approvals/approval.service.js';
import { onApprovalDecided } from '../modules/approvals/approval.dispatcher.js';
import { audit } from '../modules/audit/audit.service.js';
import { COMPANIES, VENDORS } from './data.org.js';
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
    locationId: definition.location
      ? context.locationIds[keyOf(definition.company, definition.location)]
      : undefined,
    departmentId: definition.department
      ? context.departmentIds[keyOf(definition.company, definition.department)]
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
    // No rule matched, so the service auto-approved. Nothing left to drive.
    invoice.status = InvoiceStatus.APPROVED;
    invoice.approvalStatus = ApprovalStatus.APPROVED;
    await invoice.save();
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
      try {
        await onApprovalDecided(decision.decision, decision.context);
      } catch (error) {
        logger.info(
          { invoiceNumber: definition.invoiceNumber, err: (error as Error).message },
          'seeded invoice approved but could not become a payment obligation',
        );
      }
      break;
    }
  }

  if (definition.stopAt === 'PARTIALLY_APPROVED') {
    await backdateChain(outcome.request._id, definition.daysAgo);
  }
}

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
