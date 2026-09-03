import { ApprovalStatus as A, PaymentStatus as P, ReconciliationStatus as R } from '../enums.js';
import { defineStateMachine } from './stateMachine.js';

/**
 * A payment obligation carries three independent status axes (PRD §20).
 * Each gets its own machine so a service can move one without accidentally
 * corrupting another.
 */

const APPROVAL: Record<A, A[]> = {
  [A.NOT_REQUIRED]: [A.APPROVED],
  [A.PENDING]: [A.IN_PROGRESS, A.APPROVED, A.REJECTED, A.CANCELLED],
  [A.IN_PROGRESS]: [A.APPROVED, A.REJECTED, A.CANCELLED],
  [A.APPROVED]: [],
  [A.REJECTED]: [A.PENDING],
  [A.CANCELLED]: [],
};

const PAYMENT: Record<P, P[]> = {
  [P.PENDING]: [P.QUEUED, P.ON_HOLD, P.CANCELLED],
  [P.QUEUED]: [P.BATCHED, P.ON_HOLD, P.CANCELLED, P.PENDING],
  [P.BATCHED]: [P.PROCESSING, P.QUEUED, P.CANCELLED],
  [P.PROCESSING]: [P.PAID, P.FAILED, P.QUEUED],
  [P.PAID]: [],
  [P.FAILED]: [P.QUEUED, P.CANCELLED],
  [P.ON_HOLD]: [P.PENDING, P.QUEUED, P.CANCELLED],
  [P.CANCELLED]: [],
};

const RECONCILIATION: Record<R, R[]> = {
  [R.UNMATCHED]: [R.SUGGESTED, R.MATCHED, R.IGNORED],
  [R.SUGGESTED]: [R.MATCHED, R.UNMATCHED, R.IGNORED],
  [R.MATCHED]: [R.UNMATCHED],
  [R.IGNORED]: [R.UNMATCHED],
};

export const obligationApprovalMachine = defineStateMachine<A>('ObligationApproval', APPROVAL);
export const obligationPaymentMachine = defineStateMachine<P>('ObligationPayment', PAYMENT);
export const reconciliationMachine = defineStateMachine<R>('Reconciliation', RECONCILIATION);
