import { Router } from 'express';
import multer from 'multer';
import { Types } from 'mongoose';
import { StatementImportStatus, schemas } from '@fpc/shared';
import { asyncHandler } from '../../core/asyncHandler.js';
import { ApiError } from '../../core/errors.js';
import { paginate } from '../../core/paginate.js';
import { query, validateQuery } from '../../core/validate.js';
import { logger } from '../../config/logger.js';
import { requirePrincipal } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/requirePermission.js';
import { resolveWriteCompany, scopeFilter } from '../../middleware/tenantScope.js';
import { storage } from '../../integrations/storage/index.js';
import { toApi } from '../../models/base.js';
import { BankAccount } from '../../models/bankAccount.model.js';
import { BankStatement, BankTransaction } from '../../models/banking.model.js';
import { DocumentFile } from '../../models/documentFile.model.js';
import { audit, auditContext } from '../audit/audit.service.js';
import { suggestMatchesForStatement } from '../reconciliation/reconciliation.service.js';
import { parseStatement } from './statement.import.js';
import { escapeRegex } from '../organization/crudFactory.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (!/\.(xlsx|xls|csv)$/i.test(file.originalname)) {
      callback(ApiError.badRequest('Upload a bank statement as .xlsx or .csv'));
      return;
    }
    callback(null, true);
  },
});

const statementListQuery = schemas.paginationQuery.merge(schemas.scopeQuery);

export const bankingRouter: Router = Router();

bankingRouter.get(
  '/statements',
  requirePermission('bank_statement:read'),
  validateQuery(statementListQuery),
  asyncHandler(async (req, res) => {
    const principal = requirePrincipal(req);
    const q = query<typeof statementListQuery>(req);

    res.json(
      await paginate(BankStatement, scopeFilter(principal, q.companyId) as Record<string, unknown>, {
        page: q.page,
        pageSize: q.pageSize,
        sort: q.sort,
        order: q.order,
        defaultSort: { createdAt: -1 },
      }, toApi),
    );
  }),
);

/**
 * Statement upload — PRD §24.
 *
 * Parsing, storing and match suggestion happen in one request so the
 * reconciliation screen is ready the moment the upload returns; a statement
 * is a few thousand rows at most.
 */
bankingRouter.post(
  '/statements',
  requirePermission('bank_statement:create'),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const principal = requirePrincipal(req);
    if (!req.file) throw ApiError.badRequest('A statement file is required');

    const body = req.body as { companyId?: string; bankAccountId?: string; mapping?: string };
    if (!body.bankAccountId || !Types.ObjectId.isValid(body.bankAccountId)) {
      throw ApiError.badRequest('bankAccountId is required');
    }

    const companyId = resolveWriteCompany(principal, body.companyId);
    const bankAccount = await BankAccount.findOne({
      _id: new Types.ObjectId(body.bankAccountId),
      tenantId: principal.tenantId,
      companyId,
    }).lean();
    if (!bankAccount) throw ApiError.notFound('Bank account');

    const stored = await storage().put({
      key: `statements/${String(companyId)}/${Date.now()}-${req.file.originalname}`,
      body: req.file.buffer,
      contentType: req.file.mimetype,
    });
    const file = await DocumentFile.create({
      tenantId: principal.tenantId,
      companyId,
      key: stored.key,
      fileName: req.file.originalname,
      contentType: stored.contentType,
      size: stored.size,
      checksum: stored.checksum,
      driver: storage().name,
      uploadedBy: principal.userId,
      kind: 'BANK_STATEMENT',
    });

    const statement = await BankStatement.create({
      tenantId: principal.tenantId,
      companyId,
      bankAccountId: bankAccount._id,
      fileId: file._id,
      fileName: req.file.originalname,
      status: StatementImportStatus.PARSING,
      uploadedBy: principal.userId,
    });

    try {
      const parsed = await parseStatement(
        req.file.buffer,
        req.file.originalname,
        String(bankAccount._id),
        body.mapping ? (JSON.parse(body.mapping) as Record<string, string>) : undefined,
      );

      // Re-importing an overlapping statement is routine, so rows already
      // held are skipped rather than duplicated or rejected.
      const hashes = parsed.transactions.map((entry) => entry.dedupeHash);
      const existing = await BankTransaction.find({
        tenantId: principal.tenantId,
        bankAccountId: bankAccount._id,
        dedupeHash: { $in: hashes },
      })
        .select('dedupeHash')
        .lean();
      const known = new Set(existing.map((entry) => entry.dedupeHash));
      const fresh = parsed.transactions.filter((entry) => !known.has(entry.dedupeHash));

      if (fresh.length) {
        await BankTransaction.insertMany(
          fresh.map((entry) => ({
            tenantId: principal.tenantId,
            companyId,
            bankAccountId: bankAccount._id,
            bankStatementId: statement._id,
            transactionDate: entry.transactionDate,
            valueDate: entry.valueDate,
            description: entry.description,
            reference: entry.reference,
            utr: entry.utr,
            direction: entry.direction,
            amount: entry.amount,
            balance: entry.balance,
            dedupeHash: entry.dedupeHash,
          })),
          { ordered: false },
        );
      }

      statement.status = StatementImportStatus.PARSED;
      statement.transactionCount = fresh.length;
      statement.duplicateCount = parsed.transactions.length - fresh.length;
      statement.periodStart = parsed.periodStart;
      statement.periodEnd = parsed.periodEnd;
      statement.totalDebit = parsed.totalDebit;
      statement.totalCredit = parsed.totalCredit;
      statement.closingBalance = parsed.closingBalance;
      await statement.save();

      // Keep the account balance current for the CFO's cash view (PRD §31).
      if (parsed.closingBalance !== undefined && parsed.periodEnd) {
        await BankAccount.updateOne(
          { _id: bankAccount._id },
          { currentBalance: parsed.closingBalance, balanceAsOf: parsed.periodEnd },
        );
      }

      await audit.record(
        {
          event: 'bank_statement.imported',
          entityType: 'BANK_STATEMENT',
          entityId: statement._id,
          entityLabel: statement.fileName,
          tenantId: principal.tenantId,
          companyId,
          metadata: {
            imported: fresh.length,
            duplicates: statement.duplicateCount,
            skipped: parsed.skipped.length,
            totalDebit: parsed.totalDebit,
            totalCredit: parsed.totalCredit,
          },
        },
        auditContext(req),
      );

      const suggestions = await suggestMatchesForStatement(statement._id, auditContext(req));

      res.status(201).json({
        statement: toApi((await BankStatement.findById(statement._id).lean())!),
        imported: fresh.length,
        duplicates: statement.duplicateCount,
        skipped: parsed.skipped.slice(0, 50),
        mapping: parsed.mapping,
        ...suggestions,
      });
    } catch (error) {
      logger.error({ err: error, statementId: String(statement._id) }, 'statement import failed');
      statement.status = StatementImportStatus.FAILED;
      statement.error = (error as Error).message;
      await statement.save();
      throw ApiError.unprocessable(`Could not read this statement: ${(error as Error).message}`);
    }
  }),
);

/** The normalised transaction register — PRD §36 `/banking/transactions`. */
bankingRouter.get(
  '/transactions',
  requirePermission('bank_transaction:read'),
  validateQuery(schemas.transactionListQuery),
  asyncHandler(async (req, res) => {
    const principal = requirePrincipal(req);
    const q = query<typeof schemas.transactionListQuery>(req);

    const filter = scopeFilter(principal, q.companyId) as Record<string, unknown>;
    if (q.bankAccountId) filter.bankAccountId = new Types.ObjectId(q.bankAccountId);
    if (q.bankStatementId) filter.bankStatementId = new Types.ObjectId(q.bankStatementId);
    if (q.direction) filter.direction = q.direction;
    if (q.reconciliationStatus) filter.reconciliationStatus = q.reconciliationStatus;
    if (q.dateFrom || q.dateTo) {
      filter.transactionDate = {
        ...(q.dateFrom ? { $gte: new Date(q.dateFrom) } : {}),
        ...(q.dateTo ? { $lte: new Date(q.dateTo) } : {}),
      };
    }
    if (q.minAmount !== undefined || q.maxAmount !== undefined) {
      filter.amount = {
        ...(q.minAmount !== undefined ? { $gte: q.minAmount } : {}),
        ...(q.maxAmount !== undefined ? { $lte: q.maxAmount } : {}),
      };
    }
    if (q.q) {
      const pattern = { $regex: escapeRegex(q.q), $options: 'i' };
      filter.$or = [{ description: pattern }, { reference: pattern }, { utr: pattern }];
    }

    res.json(
      await paginate(BankTransaction, filter, {
        page: q.page,
        pageSize: q.pageSize,
        sort: q.sort,
        order: q.order,
        defaultSort: { transactionDate: -1 },
      }, toApi),
    );
  }),
);

bankingRouter.delete(
  '/statements/:id',
  requirePermission('bank_statement:delete'),
  asyncHandler(async (req, res) => {
    const principal = requirePrincipal(req);
    const statement = await BankStatement.findOne({
      _id: new Types.ObjectId(req.params.id),
      ...scopeFilter(principal),
    });
    if (!statement) throw ApiError.notFound('Bank statement');

    // Removing transactions that already settled a payment would leave
    // invoices marked paid with no supporting evidence.
    const reconciled = await BankTransaction.countDocuments({
      bankStatementId: statement._id,
      reconciliationStatus: 'MATCHED',
    });
    if (reconciled > 0) {
      throw ApiError.conflict(
        `${reconciled} transactions from this statement are already reconciled. Reverse those matches first.`,
      );
    }

    await BankTransaction.deleteMany({ bankStatementId: statement._id });
    await BankStatement.deleteOne({ _id: statement._id });

    await audit.record(
      {
        event: 'bank_statement.deleted',
        entityType: 'BANK_STATEMENT',
        entityId: statement._id,
        entityLabel: statement.fileName,
        tenantId: statement.tenantId,
        companyId: statement.companyId,
        metadata: { transactionCount: statement.transactionCount },
      },
      auditContext(req),
    );

    res.status(204).send();
  }),
);
