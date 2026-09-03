import { Router } from 'express';
import ExcelJS from 'exceljs';
import { Types } from 'mongoose';
import { hasPermission } from '@fpc/shared';
import { z } from 'zod';
import { asyncHandler } from '../../core/asyncHandler.js';
import { ApiError } from '../../core/errors.js';
import { query, validateQuery } from '../../core/validate.js';
import { requirePrincipal } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/requirePermission.js';
import { audit, auditContext } from '../audit/audit.service.js';
import { REPORTS, formatCell, type ReportFilters } from './registry.js';

const MAX_ROWS = 50_000;

const reportQuery = z.object({
  format: z.enum(['json', 'xlsx']).default('json'),
  companyId: z.string().optional(),
  locationId: z.string().optional(),
  vendorId: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  status: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(MAX_ROWS).default(1000),
});

export const reportRouter: Router = Router();

/** The catalogue, filtered to what this caller may actually run. */
reportRouter.get(
  '/',
  requirePermission('report:read'),
  asyncHandler(async (req, res) => {
    const principal = requirePrincipal(req);
    res.json({
      items: Object.values(REPORTS)
        .filter((report) => hasPermission(principal.permissions, report.permission))
        .map((report) => ({
          key: report.key,
          name: report.name,
          description: report.description,
          filters: report.filters,
          columns: report.columns,
        })),
    });
  }),
);

/**
 * Runs one report — PRD §32.
 *
 * `format=json` feeds the on-screen table and `format=xlsx` the export, from
 * exactly the same query, so the two can never drift apart.
 */
reportRouter.get(
  '/:key',
  requirePermission('report:read'),
  validateQuery(reportQuery),
  asyncHandler(async (req, res) => {
    const principal = requirePrincipal(req);
    const q = query<typeof reportQuery>(req);

    const report = REPORTS[req.params.key ?? ''];
    if (!report) throw ApiError.notFound('Report');

    // Each report also names the data permission it reads, so report:read
    // alone cannot be used to see payroll or audit data.
    if (!hasPermission(principal.permissions, report.permission)) {
      throw ApiError.forbidden(`This report requires ${report.permission}`);
    }
    if (q.format === 'xlsx' && !hasPermission(principal.permissions, 'report:export')) {
      throw ApiError.forbidden('Exporting reports requires report:export');
    }

    const filters: ReportFilters = {
      tenantId: principal.tenantId,
      companyIds: principal.companyIds.length ? principal.companyIds : undefined,
      companyId: q.companyId ? assertScoped(principal.companyIds, q.companyId) : undefined,
      locationId: q.locationId ? new Types.ObjectId(q.locationId) : undefined,
      vendorId: q.vendorId ? new Types.ObjectId(q.vendorId) : undefined,
      dateFrom: q.dateFrom ? new Date(q.dateFrom) : undefined,
      dateTo: q.dateTo ? new Date(q.dateTo) : undefined,
      status: q.status,
    };

    const rows = await report.run(filters, q.limit);

    if (q.format === 'json') {
      res.json({
        key: report.key,
        name: report.name,
        columns: report.columns,
        rowCount: rows.length,
        truncated: rows.length >= q.limit,
        rows: rows.map((row) => project(row, report.columns.map((column) => column.key))),
      });
      return;
    }

    await audit.record(
      {
        event: 'report.exported',
        entityType: 'COMPANY',
        entityId: filters.companyId ?? principal.tenantId,
        entityLabel: report.name,
        tenantId: principal.tenantId,
        companyId: filters.companyId,
        metadata: { report: report.key, rowCount: rows.length, filters: q },
      },
      auditContext(req),
    );

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Finance Operations';
    workbook.created = new Date();
    const sheet = workbook.addWorksheet(report.name.slice(0, 31));

    sheet.columns = report.columns.map((column) => ({
      header: column.header,
      key: column.key,
      width: column.width ?? 18,
    }));
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];

    for (const row of rows) {
      sheet.addRow(
        Object.fromEntries(
          report.columns.map((column) => [column.key, formatCell(row[column.key], column.format)]),
        ),
      );
    }

    // Money as a summable number with two decimals; dates as dates.
    report.columns.forEach((column, index) => {
      if (column.format === 'money') sheet.getColumn(index + 1).numFmt = '#,##0.00';
      if (column.format === 'date') sheet.getColumn(index + 1).numFmt = 'dd-mmm-yyyy';
    });

    const fileName = `${report.key}-${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(Buffer.from(await workbook.xlsx.writeBuffer()));
  }),
);

function project(row: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const output: Record<string, unknown> = { id: row._id ? String(row._id) : undefined };
  for (const key of keys) output[key] = row[key] ?? null;
  return output;
}

function assertScoped(allowed: Types.ObjectId[], companyId: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(companyId)) throw ApiError.badRequest('Invalid companyId');
  const id = new Types.ObjectId(companyId);
  if (allowed.length && !allowed.some((entry) => entry.equals(id))) {
    throw ApiError.forbidden('You do not have access to this company');
  }
  return id;
}
