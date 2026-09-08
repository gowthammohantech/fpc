import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatINR, type FinanceRequestAction } from '@fpc/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { formatDateTime, relativeDays } from '@/lib/format';
import {
  Card,
  EmptyState,
  ErrorState,
  Money,
  PageHeader,
  Spinner,
  StatusBadge,
  Table,
  Tabs,
} from '@/components/ui';

/**
 * The Treasury inbox.
 *
 * Priority first, then age — a P1 raised this morning outranks a P2 from last
 * week, which is the whole reason finance attaches one.
 */
export function FinanceRequestsPage() {
  const { id } = useParams();
  const { companyId, verticalId, can } = useAuth();
  const [scope, setScope] = useState<'MINE' | 'ALL'>(can('finance_request:act') ? 'MINE' : 'ALL');

  const { data, isLoading, error } = useQuery({
    queryKey: ['finance-requests', companyId, verticalId, scope],
    queryFn: () => api.financeRequests.list({ companyId, verticalId, scope, pageSize: 50 }),
  });

  const rows = data?.items ?? [];
  const selectedId = id ?? rows[0]?.id;

  const tabs: Array<{ key: 'MINE' | 'ALL'; label: string }> = [
    ...(can('finance_request:act') ? [{ key: 'MINE' as const, label: 'Waiting on me' }] : []),
    ...(can('finance_request:read_all') ? [{ key: 'ALL' as const, label: 'All requests' }] : []),
  ];

  return (
    <>
      <PageHeader
        title="Treasury requests"
        subtitle="Payments finance has escalated for a Treasury decision"
      />

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          {tabs.length > 1 ? (
            <Tabs tabs={tabs} active={scope} onChange={(key) => setScope(key as 'MINE' | 'ALL')} />
          ) : null}

          {isLoading ? (
            <Spinner />
          ) : error ? (
            <div className="p-4">
              <ErrorState error={error} />
            </div>
          ) : !rows.length ? (
            <EmptyState
              illustration="approved"
              title="Nothing to decide"
              hint="Requests raised by the accounting team appear here."
            />
          ) : (
            <Table>
              <thead className="thead">
                <tr>
                  <th className="th">Reference</th>
                  <th className="th">Priority</th>
                  <th className="th text-right">Net</th>
                </tr>
              </thead>
              <tbody className="tbody">
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className={row.id === selectedId ? 'bg-brand-50' : 'hover:bg-slate-50'}
                  >
                    <td className="td">
                      <Link
                        className="font-mono text-xs font-medium text-brand-700"
                        to={`/finance-requests/${row.id}`}
                      >
                        {row.reference}
                      </Link>
                      <p className="text-xs text-slate-500">{row.vendorName ?? row.subjectLabel}</p>
                    </td>
                    <td className="td">
                      <StatusBadge status={row.priority} />
                    </td>
                    <td className="td text-right">
                      <Money minor={row.netPayable} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <div className="lg:col-span-3">
          {selectedId ? <RequestPanel requestId={selectedId} /> : null}
        </div>
      </div>
    </>
  );
}

/**
 * One escalation, with its remark thread.
 *
 * The remarks are the record of the conversation, so they are shown in full
 * rather than summarised — Treasury deciding a P1 needs the reason it was
 * raised, not a count.
 */
function RequestPanel({ requestId }: { requestId: string }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [remarks, setRemarks] = useState('');

  const {
    data: request,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['finance-request', requestId],
    queryFn: () => api.financeRequests.get(requestId),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['finance-requests'] });
    void queryClient.invalidateQueries({ queryKey: ['finance-request', requestId] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const act = useMutation({
    mutationFn: (action: FinanceRequestAction) =>
      api.financeRequests.act(requestId, action, remarks || undefined),
    onSuccess: () => {
      invalidate();
      navigate('/finance-requests');
    },
  });

  const comment = useMutation({
    mutationFn: () => api.financeRequests.addRemark(requestId, remarks),
    onSuccess: () => {
      setRemarks('');
      invalidate();
    },
  });

  if (isLoading) return <Spinner />;
  if (error) return <ErrorState error={error} />;
  if (!request) return null;

  const open = request.status === 'PENDING';

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-5 py-3">
        <div>
          <p className="font-mono text-xs text-slate-500">{request.reference}</p>
          <h2 className="font-semibold">{request.vendorName ?? request.subjectLabel}</h2>
          <p className="text-sm text-slate-500">
            Raised by {request.requestedByName} · {relativeDays(request.requestedAt)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={request.priority} />
          <StatusBadge status={request.status} />
          <Link className="btn-secondary" to={`/invoices/${request.invoiceId}`}>
            Open invoice
          </Link>
        </div>
      </div>

      <dl className="grid grid-cols-3 gap-4 border-b border-slate-200 px-5 py-4">
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-500">Gross billed</dt>
          <dd className="text-lg font-semibold">
            <Money minor={request.grossAmount} />
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-500">TDS withheld</dt>
          <dd className="text-lg font-semibold text-amber-700">{formatINR(request.tdsAmount)}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-500">Net payable</dt>
          <dd className="text-lg font-semibold text-emerald-700">
            {formatINR(request.netPayable)}
          </dd>
        </div>
      </dl>

      <ol className="divide-y divide-slate-100">
        {request.remarks.map((remark, index) => (
          <li key={index} className="px-5 py-3">
            <p className="text-sm">{remark.text}</p>
            <p className="mt-1 text-xs text-slate-500">
              {remark.userName}
              {remark.action ? ` · ${remark.action.toLowerCase()}` : ''} ·{' '}
              {formatDateTime(remark.at)}
            </p>
          </li>
        ))}
      </ol>

      {open ? (
        <div className="space-y-3 border-t border-slate-200 px-5 py-4">
          <label className="block">
            <span className="label">Remarks</span>
            <textarea
              className="input"
              rows={2}
              value={remarks}
              placeholder="Required to reject or return."
              onChange={(event) => setRemarks(event.target.value)}
            />
          </label>

          {act.error ? <ErrorState error={act.error} /> : null}
          {comment.error ? <ErrorState error={comment.error} /> : null}

          <div className="flex flex-wrap gap-2">
            {request.canAct ? (
              <>
                <button
                  className="btn-primary"
                  disabled={act.isPending}
                  onClick={() => act.mutate('APPROVE')}
                >
                  Approve for payment
                </button>
                <button
                  className="btn-secondary"
                  disabled={act.isPending}
                  onClick={() => act.mutate('RETURN')}
                >
                  Return to accounting
                </button>
                <button
                  className="btn-danger"
                  disabled={act.isPending}
                  onClick={() => act.mutate('REJECT')}
                >
                  Reject
                </button>
              </>
            ) : (
              <p className="text-sm text-slate-500">
                You raised this request, so someone else in Treasury has to decide it.
              </p>
            )}
            <button
              className="btn-secondary"
              disabled={!remarks || comment.isPending}
              onClick={() => comment.mutate()}
            >
              Add remark
            </button>
          </div>
        </div>
      ) : (
        <p className="border-t border-slate-200 px-5 py-3 text-sm text-slate-600">
          Decided by {request.decidedByName ?? 'Treasury'}
          {request.decidedAt ? ` on ${formatDateTime(request.decidedAt)}` : ''}.
        </p>
      )}
    </Card>
  );
}
