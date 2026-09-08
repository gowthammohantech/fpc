import { InvoiceStatus } from '../enums.js';
import { defineStateMachine } from './stateMachine.js';

/**
 * Invoice lifecycle — PRD §14.
 *
 * The happy path is a straight ladder:
 *   RECEIVED → EXTRACTING → REVIEW_REQUIRED → VALIDATED → SUBMITTED →
 *   PENDING_APPROVAL → ACCOUNTING_VERIFICATION → [TREASURY_APPROVAL] →
 *   APPROVED → PAYMENT_PENDING → PAYMENT_BATCHED → PAYMENT_PROCESSING →
 *   PAID → RECONCILED
 *
 * The two new stages sit *before* APPROVED, which keeps the meaning APPROVED
 * has always had: cleared to pay. It is still the only state an obligation is
 * created from and still the only way into PAYMENT_PENDING, so every consumer
 * that reads APPROVED as "approved and unpaid" — the payables view, the
 * dashboard's approved-unpaid figure, the approved-invoices report — keeps
 * working without knowing the stages exist.
 *
 * Business sign-off is recorded on `approvalStatus`, not here, which is why
 * clearing the approval chain moves an invoice to ACCOUNTING_VERIFICATION
 * rather than to APPROVED.
 *
 * TREASURY_APPROVAL is conditional: accounting either clears the invoice itself
 * or raises a finance request, so both edges leave ACCOUNTING_VERIFICATION.
 *
 * Note that PAID is only reachable from PAYMENT_PROCESSING, and in practice
 * only the reconciliation service performs that move — there is no
 * "mark as paid" action anywhere in the product (PRD §27).
 */
const T: Record<InvoiceStatus, InvoiceStatus[]> = {
  [InvoiceStatus.RECEIVED]: [
    InvoiceStatus.EXTRACTING,
    InvoiceStatus.REVIEW_REQUIRED,
    InvoiceStatus.CANCELLED,
    InvoiceStatus.FAILED,
  ],
  [InvoiceStatus.EXTRACTING]: [
    InvoiceStatus.REVIEW_REQUIRED,
    InvoiceStatus.FAILED,
    InvoiceStatus.CANCELLED,
  ],
  [InvoiceStatus.REVIEW_REQUIRED]: [
    InvoiceStatus.VALIDATED,
    InvoiceStatus.DUPLICATE,
    InvoiceStatus.CANCELLED,
    InvoiceStatus.REJECTED,
  ],
  [InvoiceStatus.VALIDATED]: [
    InvoiceStatus.SUBMITTED,
    InvoiceStatus.REVIEW_REQUIRED,
    InvoiceStatus.DUPLICATE,
    InvoiceStatus.CANCELLED,
  ],
  [InvoiceStatus.SUBMITTED]: [
    InvoiceStatus.PENDING_APPROVAL,
    // A rule set with no matching rule skips business approval rather than
    // stranding the invoice; the approval service records why. It still goes
    // to accounting — nothing reaches the bank unverified.
    InvoiceStatus.ACCOUNTING_VERIFICATION,
    InvoiceStatus.CANCELLED,
  ],
  // Clearing the approval chain hands over to accounting, never to the bank.
  [InvoiceStatus.PENDING_APPROVAL]: [
    InvoiceStatus.ACCOUNTING_VERIFICATION,
    InvoiceStatus.REJECTED,
    InvoiceStatus.CANCELLED,
  ],
  [InvoiceStatus.ACCOUNTING_VERIFICATION]: [
    // Accounting verified it and cleared it for payment.
    InvoiceStatus.APPROVED,
    // Accounting raised a finance request for the Treasury team.
    InvoiceStatus.TREASURY_APPROVAL,
    // Sent back to the originating department for correction.
    InvoiceStatus.REVIEW_REQUIRED,
    InvoiceStatus.REJECTED,
    InvoiceStatus.CANCELLED,
  ],
  [InvoiceStatus.TREASURY_APPROVAL]: [
    InvoiceStatus.APPROVED,
    // Treasury returned it to accounting rather than deciding.
    InvoiceStatus.ACCOUNTING_VERIFICATION,
    InvoiceStatus.REJECTED,
    InvoiceStatus.CANCELLED,
  ],
  // Cleared to pay. The only state an obligation is created from, and still
  // the only way into the payment pipeline.
  [InvoiceStatus.APPROVED]: [InvoiceStatus.PAYMENT_PENDING, InvoiceStatus.CANCELLED],
  [InvoiceStatus.PAYMENT_PENDING]: [InvoiceStatus.PAYMENT_BATCHED, InvoiceStatus.CANCELLED],
  // Removing an obligation from a draft batch returns the invoice to the queue.
  [InvoiceStatus.PAYMENT_BATCHED]: [
    InvoiceStatus.PAYMENT_PROCESSING,
    InvoiceStatus.PAYMENT_PENDING,
    InvoiceStatus.CANCELLED,
  ],
  [InvoiceStatus.PAYMENT_PROCESSING]: [
    InvoiceStatus.PAID,
    InvoiceStatus.FAILED,
    InvoiceStatus.PAYMENT_PENDING,
  ],
  [InvoiceStatus.PAID]: [InvoiceStatus.RECONCILED],
  [InvoiceStatus.RECONCILED]: [],
  [InvoiceStatus.REJECTED]: [InvoiceStatus.REVIEW_REQUIRED, InvoiceStatus.CANCELLED],
  [InvoiceStatus.DUPLICATE]: [InvoiceStatus.REVIEW_REQUIRED, InvoiceStatus.CANCELLED],
  [InvoiceStatus.CANCELLED]: [],
  [InvoiceStatus.FAILED]: [
    InvoiceStatus.EXTRACTING,
    InvoiceStatus.REVIEW_REQUIRED,
    InvoiceStatus.CANCELLED,
  ],
};

export const invoiceMachine = defineStateMachine<InvoiceStatus>('Invoice', T);
