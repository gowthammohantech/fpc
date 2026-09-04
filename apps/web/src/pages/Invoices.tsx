import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { INVOICE_STATUSES } from '@fpc/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { formatDate, humanize, isOverdue } from '@/lib/format';
import {
  EmptyState,
  ErrorState,
  FileField,
  Modal,
  Money,
  PageHeader,
  Pagination,
  Spinner,
  StatusBadge,
  Table,
  Tabs,
} from '@/components/ui';

type View =
  'ALL' | 'REVIEW' | 'PENDING_APPROVAL' | 'APPROVED' | 'PAYMENT_PENDING' | 'PAID' | 'OVERDUE';

const VIEWS: Array<{ key: View; label: string }> = [
  { key: 'ALL', label: 'All' },
  { key: 'REVIEW', label: 'Needs review' },
  { key: 'PENDING_APPROVAL', label: 'Pending approval' },
  { key: 'APPROVED', label: 'Approved' },
  { key: 'PAYMENT_PENDING', label: 'Payment pending' },
  { key: 'PAID', label: 'Paid' },
  { key: 'OVERDUE', label: 'Overdue' },
];

/** Invoice register and review queue — PRD §36 `/invoices`, `/invoices/review`. */
export function InvoicesPage({ initialView = 'ALL' }: { initialView?: View }) {
  const { companyId, can } = useAuth();
  const [params, setParams] = useSearchParams();
  // Opened by the shell's "Upload invoice" action, which can only reach this
  // page-local state through the URL.
  const [uploadOpen, setUploadOpen] = useState(params.get('upload') === '1');

  const view = (params.get('view') as View) ?? initialView;
  const page = Number(params.get('page') ?? 1);
  const search = params.get('q') ?? '';
  const status = params.get('status') ?? '';

  const { data, isLoading, error } = useQuery({
    queryKey: ['invoices', companyId, view, page, search, status],
    queryFn: () =>
      api.invoices.list({
        companyId,
        view,
        page,
        pageSize: 25,
        q: search || undefined,
        status: status || undefined,
      }),
  });

  const update = (next: Record<string, string>) => {
    const merged = new URLSearchParams(params);
    for (const [key, value] of Object.entries(next)) {
      if (value) merged.set(key, value);
      else merged.delete(key);
    }
    if (!('page' in next)) merged.set('page', '1');
    setParams(merged);
  };

  return (
    <>
      <PageHeader
        title="Invoices"
        subtitle="Everything received, from any source"
        actions={
          can('invoice:create') ? (
            <>
              {/* Discovery only — the mailbox screen owns the connection. */}
              {can('mail_connection:manage') ? (
                <Link className="btn-secondary mr-2" to="/integrations/outlook">
                  Invoice Mailbox
                </Link>
              ) : null}
              <button className="btn-primary" onClick={() => setUploadOpen(true)}>
                Upload invoice
              </button>
            </>
          ) : null
        }
      />

      <div className="card">
        <Tabs tabs={VIEWS} active={view} onChange={(key) => update({ view: key })} />

        <div className="flex flex-wrap gap-3 border-b border-slate-200 px-4 py-3">
          <input
            className="input max-w-xs"
            placeholder="Invoice number or vendor…"
            defaultValue={search}
            onKeyDown={(event) => {
              if (event.key === 'Enter') update({ q: (event.target as HTMLInputElement).value });
            }}
          />
          <select
            className="input w-auto"
            value={status}
            onChange={(event) => update({ status: event.target.value })}
          >
            <option value="">Any status</option>
            {INVOICE_STATUSES.map((entry) => (
              <option key={entry} value={entry}>
                {humanize(entry)}
              </option>
            ))}
          </select>
        </div>

        {isLoading ? (
          <Spinner />
        ) : error ? (
          <div className="p-4">
            <ErrorState error={error} />
          </div>
        ) : !data?.items.length ? (
          <EmptyState
            illustration="review"
            title="No invoices here"
            hint={
              view === 'REVIEW'
                ? 'Invoices appear here once extraction completes.'
                : 'Upload an invoice, or forward one to the company invoice mailbox.'
            }
          />
        ) : (
          <>
            <Table>
              <thead className="thead">
                <tr>
                  <th className="th">Invoice</th>
                  <th className="th">Vendor</th>
                  <th className="th">Invoice date</th>
                  <th className="th">Due</th>
                  <th className="th text-right">Amount</th>
                  <th className="th">Status</th>
                  <th className="th">Source</th>
                </tr>
              </thead>
              <tbody className="tbody">
                {data.items.map((invoice) => (
                  <tr key={invoice.id} className="hover:bg-slate-50">
                    <td className="td">
                      <Link className="font-medium text-brand-700" to={`/invoices/${invoice.id}`}>
                        {invoice.invoiceNumber ?? invoice.documentFileName ?? 'Untitled'}
                      </Link>
                      {invoice.findings?.some(
                        (finding) => !finding.resolved && finding.severity !== 'INFO',
                      ) ? (
                        <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
                          Needs attention
                        </span>
                      ) : null}
                    </td>
                    <td className="td">{invoice.vendorName ?? '—'}</td>
                    <td className="td">{formatDate(invoice.invoiceDate)}</td>
                    <td className={`td ${isOverdue(invoice.dueDate) ? 'text-red-600' : ''}`}>
                      {formatDate(invoice.dueDate)}
                    </td>
                    <td className="td text-right">
                      <Money minor={invoice.totalAmount} />
                    </td>
                    <td className="td">
                      <StatusBadge status={invoice.status} />
                    </td>
                    <td className="td text-xs text-slate-500">{humanize(invoice.source)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination
              page={data.page}
              pageSize={data.pageSize}
              total={data.total}
              onChange={(next) => update({ page: String(next) })}
            />
          </>
        )}
      </div>

      {uploadOpen ? <UploadInvoiceModal onClose={() => setUploadOpen(false)} /> : null}
    </>
  );
}

function UploadInvoiceModal({ onClose }: { onClose(): void }) {
  const { companyId } = useAuth();
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);

  const mutation = useMutation({
    mutationFn: () => api.invoices.upload(file!, companyId!),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['invoices'] });
      onClose();
    },
  });

  return (
    <Modal
      title="Upload invoice"
      onClose={onClose}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn-primary"
            disabled={!file || !companyId || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? 'Uploading…' : 'Upload'}
          </button>
        </>
      }
    >
      <p className="mb-4 text-sm text-slate-600">
        PDF, JPG or PNG. Extraction starts automatically; the invoice will appear in the review
        queue once its fields have been read.
      </p>
      <FileField
        id="invoice-file"
        file={file}
        accept="application/pdf,image/jpeg,image/png"
        onChange={setFile}
      />
      {mutation.error ? (
        <div className="mt-3">
          <ErrorState error={mutation.error} />
        </div>
      ) : null}
    </Modal>
  );
}
