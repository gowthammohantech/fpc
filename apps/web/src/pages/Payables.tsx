import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { formatCompactINR, formatDate, isOverdue } from '@/lib/format';
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

type View =
  'ALL' | 'DUE_TODAY' | 'DUE_THIS_WEEK' | 'OVERDUE' | 'APPROVED' | 'PAYMENT_PENDING' | 'PAID';

const VIEWS: Array<{ key: View; label: string }> = [
  { key: 'ALL', label: 'All' },
  { key: 'DUE_TODAY', label: 'Due today' },
  { key: 'DUE_THIS_WEEK', label: 'Due this week' },
  { key: 'OVERDUE', label: 'Overdue' },
  { key: 'APPROVED', label: 'Approved' },
  { key: 'PAYMENT_PENDING', label: 'Payment pending' },
  { key: 'PAID', label: 'Paid' },
];

/** Accounts payable — PRD §16, with the ageing summary from §32. */
export function PayablesPage() {
  const { companyId } = useAuth();
  const [view, setView] = useState<View>('ALL');
  const [page, setPage] = useState(1);

  const { data: summary } = useQuery({
    queryKey: ['payables', 'summary', companyId],
    queryFn: () => api.payables.summary({ companyId }),
  });

  const { data: ageing } = useQuery({
    queryKey: ['payables', 'ageing', companyId],
    queryFn: () => api.payables.ageing({ companyId }),
  });

  const { data, isLoading, error } = useQuery({
    queryKey: ['payables', companyId, view, page],
    queryFn: () => api.payables.list({ companyId, view, page, pageSize: 25 }),
  });

  return (
    <>
      <PageHeader title="Accounts Payable" subtitle="What we owe, and when it is due" />

      {ageing ? (
        <div className="mb-6 grid gap-4 sm:grid-cols-3 xl:grid-cols-6">
          {(['NOT_DUE', '1_30', '31_60', '61_90', '90_PLUS'] as const).map((bucket) => (
            <Card key={bucket} className="p-4">
              <p className="stat-label">
                {bucket === 'NOT_DUE'
                  ? 'Not due'
                  : `${bucket.replace('_', '–').replace('PLUS', '+')} days`}
              </p>
              <p
                className={`mt-1 text-xl font-semibold tabular ${bucket === '90_PLUS' ? 'text-red-700' : ''}`}
              >
                {formatCompactINR(ageing[bucket]?.amount ?? 0)}
              </p>
              <p className="text-xs text-slate-500">{ageing[bucket]?.count ?? 0} invoices</p>
            </Card>
          ))}
          <Card variant="dark" className="p-4">
            <p className="stat-label text-ink-300">Total open</p>
            <p className="mt-1 text-xl font-semibold tabular">
              {formatCompactINR(ageing.total?.amount ?? 0)}
            </p>
            <p className="text-xs text-ink-300">{ageing.total?.count ?? 0} invoices</p>
          </Card>
        </div>
      ) : null}

      <div className="card">
        <Tabs
          tabs={VIEWS.map((entry) => ({ ...entry, count: summary?.[entry.key]?.count }))}
          active={view}
          onChange={(key) => {
            setView(key);
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
          <EmptyState illustration="wallet" title="Nothing in this view" />
        ) : (
          <>
            <Table>
              <thead className="thead">
                <tr>
                  <th className="th">Vendor</th>
                  <th className="th">Invoice</th>
                  <th className="th">Due</th>
                  <th className="th text-right">Amount</th>
                  <th className="th">Status</th>
                </tr>
              </thead>
              <tbody className="tbody">
                {data.items.map((invoice) => (
                  <tr key={invoice.id} className="hover:bg-slate-50">
                    <td className="td font-medium">{invoice.vendorName ?? '—'}</td>
                    <td className="td">
                      <Link className="text-brand-700" to={`/invoices/${invoice.id}`}>
                        {invoice.invoiceNumber ?? '—'}
                      </Link>
                    </td>
                    <td
                      className={`td ${isOverdue(invoice.dueDate) && invoice.status !== 'PAID' ? 'text-red-600' : ''}`}
                    >
                      {formatDate(invoice.dueDate)}
                    </td>
                    <td className="td text-right">
                      <Money minor={invoice.totalAmount} />
                    </td>
                    <td className="td">
                      <StatusBadge status={invoice.status} />
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
