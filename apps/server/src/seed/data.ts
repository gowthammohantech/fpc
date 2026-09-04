/**
 * Demo data for the PRD's flagship journeys (§37, §38) and for every other
 * state the product can rest in.
 *
 * Split by concern; this module stays the single import point, because the
 * integration tests and the CLI runner import `DEMO_PASSWORD` and `USERS`
 * from here.
 */

export * from './data.org.js';
export * from './data.approvals.js';
export * from './data.invoices.js';
export * from './data.payroll.js';
