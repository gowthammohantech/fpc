import { PaymentBatchStatus as S } from '../enums.js';
import { defineStateMachine } from './stateMachine.js';

/**
 * Payment batch lifecycle — PRD §22.
 *
 * EXPORTED means the bank file has been generated and downloaded; everything
 * between that point and the statement upload happens outside the platform
 * (PRD §23), so PROCESSING simply records "the file is with the bank".
 */
const T: Record<S, S[]> = {
  [S.DRAFT]: [S.READY, S.CANCELLED],
  [S.READY]: [S.EXPORTED, S.DRAFT, S.CANCELLED],
  [S.EXPORTED]: [S.PROCESSING, S.CANCELLED],
  [S.PROCESSING]: [S.PARTIALLY_RECONCILED, S.RECONCILED, S.COMPLETED],
  [S.COMPLETED]: [S.PARTIALLY_RECONCILED, S.RECONCILED],
  [S.PARTIALLY_RECONCILED]: [S.RECONCILED, S.PARTIALLY_RECONCILED],
  [S.RECONCILED]: [],
  [S.CANCELLED]: [],
};

export const paymentBatchMachine = defineStateMachine<S>('PaymentBatch', T);
