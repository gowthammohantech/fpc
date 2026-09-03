import { Router } from 'express';
import { Types } from 'mongoose';
import { ReconciliationStatus, schemas } from '@fpc/shared';
import { asyncHandler } from '../../core/asyncHandler.js';
import { ApiError } from '../../core/errors.js';
import { paginate } from '../../core/paginate.js';
import { query, validateBody, validateQuery } from '../../core/validate.js';
import { requirePrincipal } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/requirePermission.js';
import { scopeFilter } from '../../middleware/tenantScope.js';
import { toApi } from '../../models/base.js';
import { BankTransaction, Reconciliation } from '../../models/banking.model.js';
import { PaymentObligation } from '../../models/paymentObligation.model.js';
import { auditContext } from '../audit/audit.service.js';
import { maskAccount } from '../payments/obligation.service.js';
import * as reconciliationService from './reconciliation.service.js';

export const reconciliationRouter: Router = Router();

/**
 * The reconciliation workspace — PRD §26.
 *
 * Four tabs over the same transaction collection: Matched, Suggested,
 * Unmatched, Ignored. Suggested rows carry the confidence and the individual
 * signals, so a reviewer can see *why* the engine proposed a match instead of
 * being asked to trust a number.
 */
reconciliationRouter.get(
  '/',
  requirePermission('reconciliation:read'),
  validateQuery(schemas.reconciliationListQuery),
  asyncHandler(async (req, res) => {
    const principal = requirePrincipal(req);
    const q = query<typeof schemas.reconciliationListQuery>(req);

    const filter = scopeFilter(principal, q.companyId) as Record<string, unknown>;
    filter.direction = 'DEBIT';
    filter.reconciliationStatus = q.tab;
    if (q.bankAccountId) filter.bankAccountId = new Types.ObjectId(q.bankAccountId);
    if (q.dateFrom || q.dateTo) {
      filter.transactionDate = {
        ...(q.dateFrom ? { $gte: new Date(q.dateFrom) } : {}),
        ...(q.dateTo ? { $lte: new Date(q.dateTo) } : {}),
      };
    }

    const page = await paginate(
      BankTransaction,
      filter,
      {
        page: q.page,
        pageSize: q.pageSize,
        sort: q.sort,
        order: q.order,
        defaultSort: { transactionDate: -1 },
      },
      toApi,
    );

    const transactionIds = (page.items as Array<{ id: string }>).map(
      (item) => new Types.ObjectId(item.id),
    );
    const reconciliations = await Reconciliation.find({
      bankTransactionId: { $in: transactionIds },
      status: { $ne: ReconciliationStatus.UNMATCHED },
    }).lean();

    const obligations = await PaymentObligation.find({
      _id: { $in: reconciliations.map((entry) => entry.obligationId).filter(Boolean) },
    }).lean();
    const obligationById = new Map(obligations.map((entry) => [String(entry._id), entry]));
    const byTransaction = new Map(
      reconciliations.map((entry) => [String(entry.bankTransactionId), entry]),
    );

    res.json({
      ...page,
      items: (page.items as Array<{ id: string }>).map((item) => {
        const reconciliation = byTransaction.get(item.id);
        const obligation = reconciliation?.obligationId
          ? obligationById.get(String(reconciliation.obligationId))
          : undefined;
        return {
          ...item,
          match: reconciliation
            ? {
                id: String(reconciliation._id),
                status: reconciliation.status,
                confidence: reconciliation.confidence,
                method: reconciliation.method,
                signals: reconciliation.signals,
                note: reconciliation.note,
                obligation: obligation
                  ? {
                      ...toApi(obligation),
                      beneficiaryAccount: maskAccount(obligation.beneficiaryAccount),
                    }
                  : null,
              }
            : null,
        };
      }),
    });
  }),
);

/** Counts per tab, so the UI can show them without four extra requests. */
reconciliationRouter.get(
  '/summary',
  requirePermission('reconciliation:read'),
  validateQuery(schemas.scopeQuery),
  asyncHandler(async (req, res) => {
    const principal = requirePrincipal(req);
    const q = query<typeof schemas.scopeQuery>(req);
    const base = { ...scopeFilter(principal, q.companyId), direction: 'DEBIT' };

    const grouped = await BankTransaction.aggregate<{ _id: string; count: number; amount: number }>(
      [
        { $match: base },
        {
          $group: { _id: '$reconciliationStatus', count: { $sum: 1 }, amount: { $sum: '$amount' } },
        },
      ],
    );

    const empty = { count: 0, amount: 0 };
    const byStatus = Object.fromEntries(
      grouped.map((entry) => [entry._id, { count: entry.count, amount: entry.amount }]),
    );

    res.json({
      MATCHED: byStatus.MATCHED ?? empty,
      SUGGESTED: byStatus.SUGGESTED ?? empty,
      UNMATCHED: byStatus.UNMATCHED ?? empty,
      IGNORED: byStatus.IGNORED ?? empty,
    });
  }),
);

/** Ranked candidates for the manual link dialog — PRD §26. */
reconciliationRouter.get(
  '/transactions/:id/candidates',
  requirePermission('reconciliation:match'),
  asyncHandler(async (req, res) => {
    const principal = requirePrincipal(req);
    const transaction = await BankTransaction.findOne({
      _id: objectId(req.params.id),
      ...scopeFilter(principal),
    }).lean();
    if (!transaction) throw ApiError.notFound('Bank transaction');

    const candidates = await reconciliationService.candidatesForTransaction(transaction._id);
    res.json({
      transaction: toApi(transaction),
      candidates: candidates.map((entry) => ({
        ...entry,
        obligation: entry.obligation
          ? {
              ...toApi(entry.obligation),
              beneficiaryAccount: maskAccount(
                String(
                  (entry.obligation as { beneficiaryAccount?: string }).beneficiaryAccount ?? '',
                ),
              ),
            }
          : null,
      })),
    });
  }),
);

/**
 * Confirms a match — this is what marks a payment as actually made (PRD §27).
 */
reconciliationRouter.post(
  '/confirm',
  requirePermission('reconciliation:confirm'),
  validateBody(schemas.confirmMatchRequest),
  asyncHandler(async (req, res) => {
    const principal = requirePrincipal(req);
    const payload = req.body as schemas.ConfirmMatchRequest;

    // Both sides must be inside the caller's scope, or a user could settle
    // another company's payable against their own bank line.
    const [transaction, obligation] = await Promise.all([
      BankTransaction.findOne({
        _id: new Types.ObjectId(payload.bankTransactionId),
        ...scopeFilter(principal),
      }).lean(),
      PaymentObligation.findOne({
        _id: new Types.ObjectId(payload.obligationId),
        ...scopeFilter(principal),
      }).lean(),
    ]);
    if (!transaction) throw ApiError.notFound('Bank transaction');
    if (!obligation) throw ApiError.notFound('Payment');

    const existingSuggestion = await Reconciliation.findOne({
      bankTransactionId: transaction._id,
      obligationId: obligation._id,
      status: ReconciliationStatus.SUGGESTED,
    }).lean();

    const result = await reconciliationService.confirmMatch(
      {
        bankTransactionId: transaction._id,
        obligationId: obligation._id,
        confirmedBy: principal.userId,
        confirmedByName: principal.name,
        note: payload.note,
        // Distinguish confirming the engine's suggestion from a manual link,
        // which matters for measuring suggestion quality (PRD §40).
        method: existingSuggestion ? 'AUTO_SUGGESTED' : 'MANUAL',
      },
      auditContext(req),
    );

    res.json({ reconciliationId: String(result.reconciliationId), status: 'MATCHED' });
  }),
);

reconciliationRouter.post(
  '/ignore',
  requirePermission('reconciliation:ignore'),
  validateBody(schemas.ignoreTransactionRequest),
  asyncHandler(async (req, res) => {
    const principal = requirePrincipal(req);
    const payload = req.body as { bankTransactionId: string; note: string };

    const transaction = await BankTransaction.findOne({
      _id: new Types.ObjectId(payload.bankTransactionId),
      ...scopeFilter(principal),
    }).lean();
    if (!transaction) throw ApiError.notFound('Bank transaction');

    await reconciliationService.ignoreTransaction(
      transaction._id,
      payload.note,
      principal.userId,
      auditContext(req),
    );
    res.json({ status: 'IGNORED' });
  }),
);

/** Reverses a confirmed match. Requires the confirm permission. */
reconciliationRouter.post(
  '/unmatch',
  requirePermission('reconciliation:confirm'),
  validateBody(schemas.unmatchRequest),
  asyncHandler(async (req, res) => {
    const principal = requirePrincipal(req);
    const payload = req.body as { reconciliationId: string; note: string };

    const reconciliation = await Reconciliation.findOne({
      _id: new Types.ObjectId(payload.reconciliationId),
      ...scopeFilter(principal),
    }).lean();
    if (!reconciliation) throw ApiError.notFound('Reconciliation');

    await reconciliationService.unmatch(reconciliation._id, payload.note, auditContext(req));
    res.json({ status: 'UNMATCHED' });
  }),
);

function objectId(value: string | undefined): Types.ObjectId {
  if (!value || !Types.ObjectId.isValid(value)) throw ApiError.badRequest('Invalid id');
  return new Types.ObjectId(value);
}
