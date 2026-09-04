import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { formatDateTime, humanize, relativeDays } from '@/lib/format';
import {
  Card,
  EmptyState,
  ErrorState,
  Money,
  PageHeader,
  Pagination,
  Spinner,
  StatusBadge,
  Table,
  Tabs,
} from '@/components/ui';

/** Approvals inbox — PRD §36 `/approvals`. */
export function ApprovalsPage() {
  const { companyId, can } = useAuth();
  const [scope, setScope] = useState<'MINE' | 'ALL'>('MINE');
  const [page, setPage] = useState(1);

  const { data, isLoading, error } = useQuery({
    queryKey: ['approvals', companyId, scope, page],
    queryFn: () => api.approvals.list({ companyId, scope, page, pageSize: 25 }),
  });

  const tabs: Array<{ key: 'MINE' | 'ALL'; label: string }> = [
    { key: 'MINE', label: 'Waiting on me' },
    ...(can('approval:read_all') ? [{ key: 'ALL' as const, label: 'All approvals' }] : []),
  ];

  return (
    <>
      <PageHeader title="Approvals" subtitle="Items awaiting a decision" />

      <div className="card">
        <Tabs
          tabs={tabs}
          active={scope}
          onChange={(key) => {
            setScope(key);
            setPage(1);
          }}
        />

        {isLoading ? (
          <Spinner />
        ) : error ? (
          <div className="p-4">
            <ErrorState error={error} />
          </div>
        ) : !data?.items.length ? (
          <EmptyState
            illustration="approved"
            title={scope === 'MINE' ? 'Nothing is waiting on you' : 'No approval requests'}
            hint={scope === 'MINE' ? 'Approvals routed to you will appear here.' : undefined}
          />
        ) : (
          <>
            <Table>
              <thead className="thead">
                <tr>
                  <th className="th">Item</th>
                  <th className="th">Type</th>
                  <th className="th text-right">Amount</th>
                  <th className="th">Current level</th>
                  <th className="th">Waiting</th>
                  <th className="th">Status</th>
                </tr>
              </thead>
              <tbody className="tbody">
                {data.items.map((request) => {
                  const step = request.steps.find(
                    (entry) => entry.order === request.currentStepOrder,
                  );
                  return (
                    <tr key={request.id} className="hover:bg-slate-50">
                      <td className="td">
                        <Link
                          className="font-medium text-brand-700"
                          to={`/approvals/${request.id}`}
                        >
                          {request.subjectLabel}
                        </Link>
                      </td>
                      <td className="td text-xs text-slate-500">{humanize(request.subjectType)}</td>
                      <td className="td text-right">
                        <Money minor={request.amount} />
                      </td>
                      <td className="td">{step?.label ?? '—'}</td>
                      <td className="td">
                        <span title={formatDateTime(request.requestedAt)}>
                          {request.waitingDays === 0
                            ? 'today'
                            : `${request.waitingDays} day${request.waitingDays === 1 ? '' : 's'}`}
                        </span>
                        {request.overdue ? (
                          <span
                            className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-800"
                            title={`SLA expired ${relativeDays(request.dueAt)}`}
                          >
                            Overdue
                          </span>
                        ) : null}
                      </td>
                      <td className="td">
                        <StatusBadge status={request.status} />
                      </td>
                    </tr>
                  );
                })}
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

/**
 * Approval detail — PRD §15.
 *
 * Shows the whole chain, not just the current step, so an approver can see who
 * has already signed off and who comes after them.
 */
export function ApprovalDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [comment, setComment] = useState('');

  const {
    data: request,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['approval', id],
    queryFn: () => api.approvals.get(id),
  });

  const act = useMutation({
    mutationFn: (action: 'APPROVE' | 'REJECT') =>
      api.approvals.act(id, action, comment || undefined),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['approval', id] });
      void queryClient.invalidateQueries({ queryKey: ['approvals'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  if (isLoading) return <Spinner />;
  if (error) return <ErrorState error={error} />;
  if (!request) return null;

  const subjectLink =
    request.subjectType === 'PAYROLL_BATCH'
      ? `/payroll/${request.subjectId}`
      : `/invoices/${request.subjectId}`;

  return (
    <>
      <PageHeader
        title={request.subjectLabel}
        subtitle={
          <span className="flex flex-wrap items-center gap-3">
            <StatusBadge status={request.status} />
            <span>{humanize(request.subjectType)}</span>
            {request.ruleName ? <span>· Rule: {request.ruleName}</span> : null}
          </span>
        }
        actions={
          <>
            <button className="btn-secondary" onClick={() => navigate(-1)}>
              Back
            </button>
            <Link className="btn-secondary" to={subjectLink}>
              Open item
            </Link>
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="border-b border-slate-200 px-5 py-3">
            <h2 className="font-semibold">Approval chain</h2>
          </div>
          <ol className="divide-y divide-slate-100">
            {request.steps.map((step) => (
              <li key={step.order} className="flex items-start gap-4 px-5 py-4">
                <span
                  className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                    step.status === 'APPROVED'
                      ? 'bg-emerald-100 text-emerald-700'
                      : step.status === 'REJECTED'
                        ? 'bg-red-100 text-red-700'
                        : step.status === 'ACTIVE'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {step.status === 'APPROVED' ? '✓' : step.status === 'REJECTED' ? '✕' : step.order}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{step.label}</p>
                  <p className="text-sm text-slate-500">
                    {step.status === 'ACTIVE'
                      ? 'Awaiting decision'
                      : step.actedByName
                        ? `${humanize(step.status)} by ${step.actedByName} · ${formatDateTime(step.actedAt)}`
                        : humanize(step.status)}
                  </p>
                  {step.comment ? (
                    <p className="mt-1 rounded bg-slate-50 px-3 py-2 text-sm text-slate-700">
                      “{step.comment}”
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        </Card>

        <div className="space-y-6">
          <Card className="p-5">
            <p className="stat-label">Amount</p>
            <p className="mt-1 text-3xl font-semibold tabular">
              <Money minor={request.amount} />
            </p>
            <p className="mt-3 text-sm text-slate-500">
              Submitted {formatDateTime(request.requestedAt)}
            </p>
          </Card>

          {request.canAct ? (
            <Card className="p-5">
              <h2 className="font-semibold">Your decision</h2>
              <textarea
                className="input mt-3"
                rows={3}
                placeholder="Comment (optional for approval, recommended for rejection)"
                value={comment}
                onChange={(event) => setComment(event.target.value)}
              />
              <div className="mt-3 flex gap-2">
                <button
                  className="btn-primary flex-1"
                  disabled={act.isPending}
                  onClick={() => act.mutate('APPROVE')}
                >
                  Approve
                </button>
                <button
                  className="btn-danger flex-1"
                  disabled={act.isPending}
                  onClick={() => act.mutate('REJECT')}
                >
                  Reject
                </button>
              </div>
              {act.error ? (
                <div className="mt-3">
                  <ErrorState error={act.error} />
                </div>
              ) : null}
            </Card>
          ) : request.status === 'IN_PROGRESS' ? (
            <div className="rounded-md border border-slate-200 bg-white p-4 text-sm text-slate-600">
              This is not currently waiting on you. You may be a later approver, or you submitted it
              yourself — a submitter cannot approve their own item.
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
