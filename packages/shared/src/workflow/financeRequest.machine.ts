import { FinanceRequestStatus } from '../enums.js';
import { defineStateMachine } from './stateMachine.js';

/**
 * Treasury escalation lifecycle.
 *
 * A request is raised, decided once, and closed — every outcome is terminal.
 * An invoice that comes back from Treasury and is escalated again gets a
 * *new* request with a new reference, so each round trip is a row rather than
 * a mutation and the audit trail reads as a history instead of a final state.
 */
const T: Record<FinanceRequestStatus, FinanceRequestStatus[]> = {
  [FinanceRequestStatus.PENDING]: [
    FinanceRequestStatus.APPROVED,
    FinanceRequestStatus.REJECTED,
    FinanceRequestStatus.RETURNED,
    FinanceRequestStatus.CANCELLED,
  ],
  [FinanceRequestStatus.APPROVED]: [],
  [FinanceRequestStatus.REJECTED]: [],
  [FinanceRequestStatus.RETURNED]: [],
  [FinanceRequestStatus.CANCELLED]: [],
};

export const financeRequestMachine = defineStateMachine<FinanceRequestStatus>('FinanceRequest', T);
