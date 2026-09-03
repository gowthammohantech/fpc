import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { formatCompactINR, formatINR } from '@/lib/format';
import { Card, ErrorState, Money, PageHeader, Spinner, StatCard, StatusBadge } from '@/components/ui';

/**
 * CFO dashboard — PRD §30 and §31.
 *
 * Laid out to answer the §45 questions in order: what have we received, what
 * needs approval, what do we owe, what is ready to pay, and what remains
 * unreconciled.
 */
export function DashboardPage() {
  const { companyId, can } = useAuth();
  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboard', companyId],
    queryFn: () => api.dashboard.summary({ companyId }),
  });

  if (isLoading) return <Spinner />;
  if (error) return <ErrorState error={error} />;
  if (!data) return null;

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle="Where the money is, right now"
        actions={
          can('report:read') ? (
            <Link className="btn-secondary" to="/reports">
              Reports
            </Link>
          ) : null
        }
      />

      <div className="card mb-6 bg-gradient-to-r from-brand-700 to-brand-500 p-6 text-white">
        <p className="text-sm uppercase tracking-wide text-brand-100">Total payables</p>
        <p className="mt-1 text-4xl font-semibold tabular">{formatINR(data.totalPayables)}</p>
        {data.payrollHidden ? (
          <p className="mt-2 text-xs text-brand-100">
            Excludes payroll — your role does not include payroll visibility.
          </p>
        ) : null}
      </div>

      <section className="mb-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Invoices</h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Invoices received" value={data.invoices.received} />
          <StatCard
            label="Pending review"
            value={data.invoices.pendingReview}
            sub={<Link className="text-brand-600" to="/invoices/review">Open review queue</Link>}
            tone={data.invoices.pendingReview > 0 ? 'warning' : 'default'}
          />
          <StatCard
            label="Pending approval"
            value={data.invoices.pendingApproval}
            sub={formatCompactINR(data.invoices.pendingApprovalAmount)}
            tone={data.invoices.pendingApproval > 0 ? 'warning' : 'default'}
          />
          <StatCard
            label="Approved / unpaid"
            value={data.invoices.approvedUnpaid}
            sub={formatCompactINR(data.invoices.approvedUnpaidAmount)}
          />
        </div>
        {data.invoices.overdue > 0 ? (
          <div className="mt-4">
            <StatCard
              label="Overdue"
              value={data.invoices.overdue}
              sub={`${formatCompactINR(data.invoices.overdueAmount)} past due date`}
              tone="danger"
            />
          </div>
        ) : null}
      </section>

      {data.payroll ? (
        <section className="mb-6">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Payroll</h2>
          <Card className="p-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <Link className="text-lg font-semibold text-brand-700" to={`/payroll/${data.payroll.batchId}`}>
                  {data.payroll.label}
                </Link>
                <p className="mt-1 text-sm text-slate-500">
                  {data.payroll.employeeCount.toLocaleString('en-IN')} employees
                </p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-semibold tabular">{formatINR(data.payroll.amount)}</p>
                {data.payroll.difference !== null && data.payroll.difference !== undefined ? (
                  <p
                    className={`text-sm tabular ${
                      data.payroll.difference >= 0 ? 'text-amber-700' : 'text-emerald-700'
                    }`}
                  >
                    {data.payroll.difference >= 0 ? '+' : '−'}
                    {formatCompactINR(Math.abs(data.payroll.difference))} vs previous month
                  </p>
                ) : null}
              </div>
              <StatusBadge status={data.payroll.status} />
            </div>
          </Card>
        </section>
      ) : null}

      <section className="mb-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Payments</h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Ready for payment"
            value={formatCompactINR(data.payments.readyForPayment)}
            sub={<Link className="text-brand-600" to="/payments">Open payment queue</Link>}
          />
          <StatCard label="Batched / in flight" value={formatCompactINR(data.payments.batched)} />
          <StatCard
            label="Reconciled today"
            value={formatCompactINR(data.payments.reconciledToday)}
            tone="success"
          />
          <StatCard
            label="Unreconciled"
            value={formatCompactINR(data.payments.unreconciled)}
            sub={<Link className="text-brand-600" to="/reconciliation">Reconcile</Link>}
            tone={data.payments.unreconciled > 0 ? 'warning' : 'default'}
          />
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Cash visibility
        </h2>
        <Card className="divide-y divide-slate-200">
          <Row label="Current bank balance" value={data.cash.bankBalance} />
          <Row label="Approved vendor payables" value={data.cash.approvedVendorPayables} negative />
          {!data.cash.payrollExcluded ? (
            <Row label="Approved payroll" value={data.cash.approvedPayroll} negative />
          ) : null}
          <div className="flex items-center justify-between px-5 py-4">
            <span className="font-semibold">Known upcoming outflow</span>
            <Money minor={data.cash.knownUpcomingOutflow} className="text-lg font-semibold" />
          </div>
        </Card>
        {data.cash.payrollExcluded ? (
          <p className="mt-2 text-xs text-slate-500">
            Payroll is excluded from this figure because your role does not include payroll access.
          </p>
        ) : null}
      </section>
    </>
  );
}

function Row({ label, value, negative }: { label: string; value: number; negative?: boolean }) {
  return (
    <div className="flex items-center justify-between px-5 py-3">
      <span className="text-sm text-slate-600">{label}</span>
      <Money minor={value} className={negative ? 'text-slate-700' : 'text-emerald-700'} />
    </div>
  );
}
