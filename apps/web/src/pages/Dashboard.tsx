import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  TriangleAlert,
  CircleCheck,
  FileSearch,
  FileText,
  Layers,
  RefreshCcw,
  SendHorizontal,
  Wallet,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { formatCompactINR, formatINR } from '@/lib/format';
import { Donut, type DonutSegment } from '@/components/Donut';
import {
  Card,
  ErrorState,
  Money,
  PageHeader,
  Spinner,
  StatCard,
  StatusBadge,
} from '@/components/ui';

/** How the ageing buckets read, from settled to alarming. */
const AGEING_BUCKETS: Array<{ key: string; label: string; colour: string }> = [
  { key: 'NOT_DUE', label: 'Not due', colour: '#105261' },
  { key: '1_30', label: '1–30 days', colour: '#18778B' },
  { key: '31_60', label: '31–60 days', colour: '#40B1C9' },
  { key: '61_90', label: '61–90 days', colour: '#F59E0B' },
  { key: '90_PLUS', label: '90+ days', colour: '#DC2626' },
];

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

  // Shares its key with the payables screen, so whichever loads second is free.
  const { data: ageing } = useQuery({
    queryKey: ['payables', 'ageing', companyId],
    queryFn: () => api.payables.ageing({ companyId }),
    enabled: can('payable:read'),
  });

  if (isLoading) return <Spinner />;
  if (error) return <ErrorState error={error} />;
  if (!data) return null;

  const segments: DonutSegment[] = AGEING_BUCKETS.map((bucket) => ({
    key: bucket.key,
    label: bucket.label,
    colour: bucket.colour,
    amount: ageing?.[bucket.key]?.amount ?? 0,
    count: ageing?.[bucket.key]?.count,
  }));

  // The only period-over-period figure the API actually reports. Every other
  // card shows a real sub-figure instead of an invented percentage.
  const payrollDelta =
    data.payroll?.previousAmount && data.payroll.difference !== null
      ? { percent: Math.round((data.payroll.difference / data.payroll.previousAmount) * 100) }
      : undefined;

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

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <div className="grid gap-4 sm:grid-cols-3">
            <Card variant="hero" className="p-6 sm:col-span-2">
              <p className="stat-label text-brand-100">Total payables</p>
              <p className="mt-2 text-4xl font-semibold tracking-tight tabular">
                {formatINR(data.totalPayables)}
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <span className="delta-on-dark">
                  {formatCompactINR(data.payments.readyForPayment)} ready to pay
                </span>
                {can('obligation:read') ? (
                  <Link className="btn-accent" to="/payments">
                    <SendHorizontal className="h-4 w-4" aria-hidden="true" />
                    Payment queue
                  </Link>
                ) : null}
              </div>
              {data.payrollHidden ? (
                <p className="mt-4 text-xs text-brand-100">
                  Excludes payroll — your role does not include payroll visibility.
                </p>
              ) : null}
            </Card>

            <StatCard
              label="Unreconciled"
              value={formatCompactINR(data.payments.unreconciled)}
              icon={RefreshCcw}
              tone={data.payments.unreconciled > 0 ? 'warning' : 'default'}
              sub={
                <Link className="text-brand-700" to="/reconciliation">
                  Reconcile
                </Link>
              }
            />
          </div>

          <section>
            <h2 className="section-title">Invoices</h2>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard label="Received" value={data.invoices.received} icon={FileText} />
              <StatCard
                label="Pending review"
                value={data.invoices.pendingReview}
                icon={FileSearch}
                tone={data.invoices.pendingReview > 0 ? 'warning' : 'default'}
                sub={
                  <Link className="text-brand-700" to="/invoices/review">
                    Open review queue
                  </Link>
                }
              />
              <StatCard
                label="Pending approval"
                value={data.invoices.pendingApproval}
                icon={CircleCheck}
                sub={formatCompactINR(data.invoices.pendingApprovalAmount)}
                tone={data.invoices.pendingApproval > 0 ? 'warning' : 'default'}
              />
              <StatCard
                label="Approved / unpaid"
                value={data.invoices.approvedUnpaid}
                icon={Wallet}
                sub={formatCompactINR(data.invoices.approvedUnpaidAmount)}
              />
              {data.invoices.overdue > 0 ? (
                <StatCard
                  label="Overdue"
                  value={data.invoices.overdue}
                  icon={TriangleAlert}
                  sub={`${formatCompactINR(data.invoices.overdueAmount)} past due date`}
                  tone="danger"
                />
              ) : null}
            </div>
          </section>

          {data.payroll ? (
            <section>
              <h2 className="section-title">Payroll</h2>
              <Card className="p-5">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <Link
                      className="text-lg font-semibold text-brand-800"
                      to={`/payroll/${data.payroll.batchId}`}
                    >
                      {data.payroll.label}
                    </Link>
                    <p className="mt-1 text-sm text-ink-500">
                      {data.payroll.employeeCount.toLocaleString('en-IN')} employees
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-semibold tabular">
                      {formatINR(data.payroll.amount)}
                    </p>
                    {payrollDelta ? (
                      <span
                        className={`mt-1 ${payrollDelta.percent >= 0 ? 'delta-warn' : 'delta-up'}`}
                        title="Compared with the previous month"
                      >
                        {payrollDelta.percent >= 0 ? '+' : '−'}
                        {Math.abs(payrollDelta.percent)}% vs last month
                      </span>
                    ) : null}
                  </div>
                  <StatusBadge status={data.payroll.status} />
                </div>
              </Card>
            </section>
          ) : null}

          <section>
            <h2 className="section-title">Payments</h2>
            <div className="grid gap-4 sm:grid-cols-3">
              <StatCard
                label="Ready for payment"
                value={formatCompactINR(data.payments.readyForPayment)}
                icon={SendHorizontal}
              />
              <StatCard
                label="Batched / in flight"
                value={formatCompactINR(data.payments.batched)}
                icon={Layers}
              />
              <StatCard
                label="Reconciled today"
                value={formatCompactINR(data.payments.reconciledToday)}
                icon={CircleCheck}
                tone="success"
              />
            </div>
          </section>
        </div>

        <div className="space-y-6">
          {can('payable:read') ? (
            <Card>
              <div className="panel-head">
                <h2 className="font-semibold text-ink-900">Payables ageing</h2>
                <Link className="text-sm text-brand-700" to="/payables">
                  View all
                </Link>
              </div>
              <Donut segments={segments} caption="open" emptyLabel="Nothing outstanding" />
            </Card>
          ) : null}

          <Card>
            <div className="panel-head">
              <h2 className="font-semibold text-ink-900">Cash visibility</h2>
            </div>
            <div className="divide-y divide-ink-100">
              <Row label="Current bank balance" value={data.cash.bankBalance} />
              <Row
                label="Approved vendor payables"
                value={data.cash.approvedVendorPayables}
                negative
              />
              {!data.cash.payrollExcluded ? (
                <Row label="Approved payroll" value={data.cash.approvedPayroll} negative />
              ) : null}
              <div className="flex items-center justify-between px-5 py-4">
                <span className="font-semibold text-ink-900">Known upcoming outflow</span>
                <Money minor={data.cash.knownUpcomingOutflow} className="text-lg font-semibold" />
              </div>
            </div>
            {data.cash.payrollExcluded ? (
              <p className="px-5 pb-4 text-xs text-ink-500">
                Payroll is excluded from this figure because your role does not include payroll
                access.
              </p>
            ) : null}
          </Card>
        </div>
      </div>
    </>
  );
}

function Row({ label, value, negative }: { label: string; value: number; negative?: boolean }) {
  return (
    <div className="flex items-center justify-between px-5 py-3">
      <span className="text-sm text-ink-600">{label}</span>
      <Money minor={value} className={negative ? 'text-ink-700' : 'text-emerald-700'} />
    </div>
  );
}
