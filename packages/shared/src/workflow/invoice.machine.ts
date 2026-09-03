import { InvoiceStatus } from '../enums.js';
import { defineStateMachine } from './stateMachine.js';

/**
 * Invoice lifecycle — PRD §14.
 *
 * The happy path is a straight ladder:
 *   RECEIVED → EXTRACTING → REVIEW_REQUIRED → VALIDATED → SUBMITTED →
 *   PENDING_APPROVAL → APPROVED → PAYMENT_PENDING → PAYMENT_BATCHED →
 *   PAYMENT_PROCESSING → PAID → RECONCILED
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
    // A rule set with no matching rule auto-approves rather than stranding
    // the invoice; the approval service records why.
    InvoiceStatus.APPROVED,
    InvoiceStatus.CANCELLED,
  ],
  [InvoiceStatus.PENDING_APPROVAL]: [
    InvoiceStatus.APPROVED,
    InvoiceStatus.REJECTED,
    InvoiceStatus.CANCELLED,
  ],
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
  [InvoiceStatus.FAILED]: [InvoiceStatus.EXTRACTING, InvoiceStatus.REVIEW_REQUIRED, InvoiceStatus.CANCELLED],
};

export const invoiceMachine = defineStateMachine<InvoiceStatus>('Invoice', T);
