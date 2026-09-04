import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { formatDateTime, humanize } from '@/lib/format';
import { EmptyState, ErrorState, PageHeader, Pagination, Spinner, Table } from '@/components/ui';

const ENTITY_TYPES = [
  'INVOICE',
  'PAYROLL_BATCH',
  'PAYMENT_OBLIGATION',
  'PAYMENT_BATCH',
  'APPROVAL_REQUEST',
  'BANK_STATEMENT',
  'RECONCILIATION',
  'USER',
  'VENDOR',
  'AUTH',
];

/** Audit trail — PRD §29. Read-only by construction: there is no write path. */
export function AuditPage() {
  const { companyId } = useAuth();
  const [page, setPage] = useState(1);
  const [entityType, setEntityType] = useState('');
  const [dateFrom, setDateFrom] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['audit', companyId, page, entityType, dateFrom],
    queryFn: () =>
      api.audit.list({
        companyId,
        page,
        pageSize: 50,
        entityType: entityType || undefined,
        dateFrom: dateFrom || undefined,
      }),
  });

  return (
    <>
      <PageHeader
        title="Audit Trail"
        subtitle="Every recorded action. Records cannot be edited or deleted."
      />

      <div className="card">
        <div className="flex flex-wrap gap-3 border-b border-slate-200 px-4 py-3">
          <select
            className="input w-auto"
            value={entityType}
            onChange={(event) => {
              setEntityType(event.target.value);
              setPage(1);
            }}
          >
            <option value="">All entity types</option>
            {ENTITY_TYPES.map((type) => (
              <option key={type} value={type}>
                {humanize(type)}
              </option>
            ))}
          </select>
          <div>
            <input
              type="date"
              className="input"
              value={dateFrom}
              onChange={(event) => {
                setDateFrom(event.target.value);
                setPage(1);
              }}
              aria-label="From date"
            />
          </div>
        </div>

        {isLoading ? (
          <Spinner />
        ) : error ? (
          <div className="p-4">
            <ErrorState error={error} />
          </div>
        ) : !data?.items.length ? (
          <EmptyState title="No audit records for these filters" />
        ) : (
          <>
            <Table>
              <thead className="thead">
                <tr>
                  <th className="th">When</th>
                  <th className="th">Event</th>
                  <th className="th">Entity</th>
                  <th className="th">Reference</th>
                  <th className="th">User</th>
                  <th className="th">Change</th>
                </tr>
              </thead>
              <tbody className="tbody">
                {data.items.map((event) => (
                  <tr key={event.id} className="hover:bg-slate-50">
                    <td className="td text-slate-500">{formatDateTime(event.timestamp)}</td>
                    <td className="td font-medium">{humanize(event.event.split('.').pop())}</td>
                    <td className="td text-xs text-slate-500">{humanize(event.entityType)}</td>
                    <td className="td">{event.entityLabel ?? '—'}</td>
                    <td className="td">{event.userName ?? 'System'}</td>
                    <td className="td max-w-md truncate text-xs text-slate-500">
                      {describeChange(event.oldValue, event.newValue, event.metadata)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination
              page={data.page}
              pageSize={data.pageSize}
              total={data.total}
              onChange={setPage}
            />
          </>
        )}
      </div>
    </>
  );
}

function describeChange(oldValue: unknown, newValue: unknown, metadata: unknown): string {
  const before = (oldValue as { status?: string })?.status;
  const after = (newValue as { status?: string })?.status;
  if (before && after) return `${humanize(before)} → ${humanize(after)}`;

  const meta = metadata as Record<string, unknown> | undefined;
  if (meta?.comment) return `“${String(meta.comment)}”`;
  if (meta?.reason) return String(meta.reason);
  if (newValue && typeof newValue === 'object') return Object.keys(newValue).join(', ');
  return '—';
}
