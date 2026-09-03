import { ApprovalStatus, InvoiceStatus, NotificationType, formatINR } from '@fpc/shared';
import { logger } from '../../config/logger.js';
import { eventBus } from '../../core/eventBus.js';
import { Invoice } from '../../models/invoice.model.js';
import { audit, type AuditContext } from '../audit/audit.service.js';
import type { ApprovalDecision } from './approval.service.js';

/**
 * Applies a completed approval decision to the subject it governs.
 *
 * The approval engine deliberately knows nothing about invoices or payroll —
 * it only manages chains. This dispatcher is the single place where a
 * decision becomes a lifecycle change on the underlying record.
 */
export async function onApprovalDecided(
  decision: ApprovalDecision,
  context: AuditContext,
): Promise<void> {
  if (!decision.completed) return;

  const { request } = decision;
  if (request.subjectType === 'VENDOR_INVOICE') {
    await applyToInvoice(decision, context);
    return;
  }

  if (request.subjectType === 'PAYROLL_BATCH') {
    const payroll = await import('../payroll/payroll.service.js');
    if (decision.finalStatus === ApprovalStatus.REJECTED) {
      await payroll.onRejected(request.subjectId, context);
    } else {
      await payroll.onApproved(request.subjectId, context);
    }
    return;
  }

  logger.warn({ subjectType: request.subjectType }, 'no handler for approval subject type');
}

async function applyToInvoice(decision: ApprovalDecision, context: AuditContext): Promise<void> {
  const { request, finalStatus } = decision;
  const invoice = await Invoice.findById(request.subjectId);
  if (!invoice) return;

  const from = invoice.status;

  if (finalStatus === ApprovalStatus.REJECTED) {
    invoice.status = InvoiceStatus.REJECTED;
    invoice.approvalStatus = ApprovalStatus.REJECTED;
    await invoice.save();

    await audit.recordStatusChange(
      {
        event: 'invoice.rejected',
        entityType: 'INVOICE',
        entityId: invoice._id,
        entityLabel: invoice.invoiceNumber,
        tenantId: invoice.tenantId,
        companyId: invoice.companyId,
        from,
        to: InvoiceStatus.REJECTED,
      },
      context,
    );

    eventBus.publish({
      type: NotificationType.INVOICE_REJECTED,
      tenantId: String(invoice.tenantId),
      companyId: String(invoice.companyId),
      entityType: 'INVOICE',
      entityId: String(invoice._id),
      recipientUserIds: invoice.submittedBy ? [String(invoice.submittedBy)] : [],
      title: `Invoice ${invoice.invoiceNumber ?? ''} was rejected`,
      body: `${invoice.vendorName ?? 'An invoice'} for ${formatINR(invoice.totalAmount ?? 0)} was rejected during approval.`,
      link: `/invoices/${String(invoice._id)}`,
    });
    return;
  }

  invoice.status = InvoiceStatus.APPROVED;
  invoice.approvalStatus = ApprovalStatus.APPROVED;
  await invoice.save();

  await audit.recordStatusChange(
    {
      event: 'invoice.approved',
      entityType: 'INVOICE',
      entityId: invoice._id,
      entityLabel: invoice.invoiceNumber,
      tenantId: invoice.tenantId,
      companyId: invoice.companyId,
      from,
      to: InvoiceStatus.APPROVED,
    },
    context,
  );

  eventBus.publish({
    type: NotificationType.INVOICE_APPROVED,
    tenantId: String(invoice.tenantId),
    companyId: String(invoice.companyId),
    entityType: 'INVOICE',
    entityId: String(invoice._id),
    recipientUserIds: invoice.submittedBy ? [String(invoice.submittedBy)] : [],
    title: `Invoice ${invoice.invoiceNumber ?? ''} approved`,
    body: `${invoice.vendorName ?? 'An invoice'} for ${formatINR(invoice.totalAmount ?? 0)} is fully approved and ready for payment.`,
    link: `/invoices/${String(invoice._id)}`,
  });

  // Approved invoices become payment obligations and enter accounts payable
  // (PRD §9, §20). Imported lazily to keep the approval module free of a
  // dependency on the payment pipeline.
  const { createObligationForInvoice } = await import('../payments/obligation.service.js');
  await createObligationForInvoice(invoice._id, context);
}
