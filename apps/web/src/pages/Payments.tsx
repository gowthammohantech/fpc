import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, downloadBlob } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { formatCompactINR, formatDate, formatDateTime, humanize } from '@/lib/format';
import {
  Card,
  ConfirmWithReason,
  EmptyState,
  ErrorState,
  Modal,
  Money,
  PageHeader,
  Pagination,
  Spinner,
  StatusBadge,
  Table,
} from '@/components/ui';

/**
 * Payment queue — PRD §21.
 *
 * Payroll appears as a single aggregated row for anyone without payroll
 * visibility; the row is selectable as a unit but never expands into
 * individual salaries.
 */
export function PaymentQueuePage() {
  const { companyId, can } = useAuth();
  const [page, setPage] = useState(1);
  const [type, setType] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchOpen, setBatchOpen] = useState(false);
  const [status, setStatus] = useState('');
  const [holding, setHolding] = useState<{ id: string; payee: string } | null>(null);
  const queryClient = useQueryClient();

  const setHold = useMutation({
    mutationFn: ({ id, hold, reason }: { id: string; hold: boolean; reason?: string }) =>
      api.payments.hold(id, hold, reason),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['payment-queue'] });
      setHolding(null);
    },
  });

  const { data, isLoading, error } = useQuery({
    queryKey: ['payment-queue', companyId, page, type, status],
    queryFn: () =>
      api.payments.queue({
        companyId,
        page,
        pageSize: 50,
        type: type || undefined,
        paymentStatus: status || undefined,
      }),
  });

  const rows = data?.items ?? [];
  const selectable = rows.filter((row) => !(row as { aggregate?: boolean }).aggregate);

  const selectedTotal = useMemo(
    () => rows.filter((row) => selected.has(row.id)).reduce((sum, row) => sum + row.amount, 0),
    [rows, selected],
  );

  const toggle = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <>
      <PageHeader
        title="Payment Queue"
        subtitle="Approved payments waiting to be batched"
        actions={
          can('payment_batch:create') ? (
            <button
              className="btn-primary"
              disabled={selected.size === 0}
              onClick={() => setBatchOpen(true)}
            >
              Create batch ({selected.size})
            </button>
          ) : null
        }
      />

      {data?.payrollAggregated ? (
        <div className="mb-4 rounded-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
          Payroll is shown as a single total. Individual salary rows require payroll access.
        </div>
      ) : null}

      <div className="card">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-4 py-3">
          <select className="input w-auto" value={type} onChange={(event) => setType(event.target.value)}>
            <option value="">All payment types</option>
            <option value="VENDOR">Vendor</option>
            <option value="PAYROLL">Payroll</option>
          </select>
          <select
            className="input w-auto"
            value={status}
            onChange={(event) => { setStatus(event.target.value); setPage(1); }}
          >
            <option value="">Ready to pay</option>
            <option value="ON_HOLD">On hold</option>
            <option value="BATCHED">Batched</option>
            <option value="PROCESSING">With the bank</option>
          </select>
          {selected.size > 0 ? (
            <span className="text-sm text-slate-600">
              {selected.size} selected · <Money minor={selectedTotal} className="font-medium" />
            </span>
          ) : null}
        </div>

        {isLoading ? (
          <Spinner />
        ) : error ? (
          <div className="p-4"><ErrorState error={error} /></div>
        ) : !rows.length ? (
          <EmptyState title="Nothing waiting to be paid" hint="Approved invoices and payroll appear here." />
        ) : (
          <>
            <Table>
              <thead className="bg-slate-50">
                <tr>
                  <th className="th w-10">
                    <input
                      type="checkbox"
                      aria-label="Select all"
                      checked={selectable.length > 0 && selectable.every((row) => selected.has(row.id))}
                      onChange={(event) =>
                        setSelected(
                          event.target.checked ? new Set(selectable.map((row) => row.id)) : new Set(),
                        )
                      }
                    />
                  </th>
                  <th className="th">Payee</th>
                  <th className="th">Type</th>
                  <th className="th">Reference</th>
                  <th className="th">Due</th>
                  <th className="th text-right">Amount</th>
                  <th className="th">Status</th>
                  <th className="th" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {rows.map((row) => {
                  const aggregate = (row as { aggregate?: boolean }).aggregate;
                  return (
                    <tr key={row.id} className="hover:bg-slate-50">
                      <td className="td">
                        {aggregate ? (
                          <span title="Payroll totals cannot be batched without payroll access">—</span>
                        ) : (
                          <input
                            type="checkbox"
                            aria-label={`Select ${row.payeeName}`}
                            checked={selected.has(row.id)}
                            onChange={() => toggle(row.id)}
                          />
                        )}
                      </td>
                      <td className="td font-medium">
                        {row.payeeName}
                        {aggregate ? (
                          <span className="ml-2 text-xs text-slate-500">
                            {(row as { employeeCount?: number }).employeeCount} employees
                          </span>
                        ) : null}
                      </td>
                      <td className="td text-xs text-slate-500">{humanize(row.type)}</td>
                      <td className="td font-mono text-xs">{row.reference}</td>
                      <td className="td">{formatDate(row.dueDate)}</td>
                      <td className="td text-right"><Money minor={row.amount} /></td>
                      <td className="td">
                        <StatusBadge status={row.paymentStatus} />
                        {row.holdReason ? (
                          <p className="mt-1 text-xs text-slate-500">{row.holdReason}</p>
                        ) : null}
                      </td>
                      <td className="td text-right">
                        {!aggregate && can('obligation:update') ? (
                          row.paymentStatus === 'ON_HOLD' ? (
                            <button
                              className="text-sm text-brand-600"
                              disabled={setHold.isPending}
                              onClick={() => setHold.mutate({ id: row.id, hold: false })}
                            >
                              Release
                            </button>
                          ) : (
                            <button
                              className="text-sm text-slate-500 hover:text-slate-800"
                              onClick={() => setHolding({ id: row.id, payee: row.payeeName })}
                            >
                              Hold
                            </button>
                          )
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
            <Pagination
              page={data?.page ?? 1}
              pageSize={data?.pageSize ?? 50}
              total={data?.total ?? 0}
              onChange={setPage}
            />
          </>
        )}
      </div>

      {holding ? (
        <ConfirmWithReason
          title="Put this payment on hold"
          actionLabel="Hold payment"
          description={
            <p>
              {holding.payee} will stay approved but will be excluded from payment batches until
              it is released.
            </p>
          }
          pending={setHold.isPending}
          error={setHold.error}
          onClose={() => setHolding(null)}
          onConfirm={(reason) => setHold.mutate({ id: holding.id, hold: true, reason })}
        />
      ) : null}

      {batchOpen ? (
        <CreateBatchModal
          obligationIds={[...selected]}
          total={selectedTotal}
          onClose={() => setBatchOpen(false)}
          onCreated={() => setSelected(new Set())}
        />
      ) : null}
    </>
  );
}

function CreateBatchModal({
  obligationIds,
  total,
  onClose,
  onCreated,
}: {
  obligationIds: string[];
  total: number;
  onClose(): void;
  onCreated(): void;
}) {
  const { companyId } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [bankAccountId, setBankAccountId] = useState('');
  const [notes, setNotes] = useState('');

  const { data: accounts } = useQuery({
    queryKey: ['bank-accounts', companyId],
    queryFn: () => api.settings.bankAccounts({ companyId, pageSize: 50 }),
  });

  const create = useMutation({
    mutationFn: () =>
      api.payments.createBatch({
        companyId,
        paymentDate,
        bankAccountId: bankAccountId || undefined,
        obligationIds,
        notes: notes || undefined,
      }),
    onSuccess: (batch) => {
      void queryClient.invalidateQueries({ queryKey: ['payment-queue'] });
      void queryClient.invalidateQueries({ queryKey: ['payment-batches'] });
      onCreated();
      navigate(`/payments/batches/${batch.id}`);
    },
  });

  return (
    <Modal
      title="Create payment batch"
      onClose={onClose}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? 'Creating…' : 'Create batch'}
          </button>
        </>
      }
    >
      <p className="mb-4 text-sm text-slate-600">
        {obligationIds.length} payments totalling <Money minor={total} className="font-medium" />.
      </p>

      <div className="space-y-4">
        <div>
          <label className="label" htmlFor="paymentDate">Payment date</label>
          <input
            id="paymentDate"
            type="date"
            className="input"
            value={paymentDate}
            onChange={(event) => setPaymentDate(event.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="account">Debit account</label>
          <select
            id="account"
            className="input"
            value={bankAccountId}
            onChange={(event) => setBankAccountId(event.target.value)}
          >
            <option value="">Select an account…</option>
            {accounts?.items.map((account) => (
              <option key={account.id} value={account.id}>
                {account.label} · {account.bankName} · {account.bankFileFormat}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-slate-500">
            The account's bank determines the file format generated for upload.
          </p>
        </div>
        <div>
          <label className="label" htmlFor="notes">Notes</label>
          <input id="notes" className="input" value={notes} onChange={(event) => setNotes(event.target.value)} />
        </div>
      </div>

      {create.error ? <div className="mt-4"><ErrorState error={create.error} /></div> : null}
    </Modal>
  );
}

/** Payment batch list — PRD §36 `/payments/batches`. */
export function PaymentBatchesPage() {
  const { companyId } = useAuth();
  const [page, setPage] = useState(1);

  const { data, isLoading, error } = useQuery({
    queryKey: ['payment-batches', companyId, page],
    queryFn: () => api.payments.batches({ companyId, page, pageSize: 25 }),
  });

  return (
    <>
      <PageHeader title="Payment Batches" subtitle="Files prepared for the bank" />

      <div className="card">
        {isLoading ? (
          <Spinner />
        ) : error ? (
          <div className="p-4"><ErrorState error={error} /></div>
        ) : !data?.items.length ? (
          <EmptyState title="No payment batches yet" hint="Select payments in the queue to create one." />
        ) : (
          <>
            <Table>
              <thead className="bg-slate-50">
                <tr>
                  <th className="th">Batch</th>
                  <th className="th">Payment date</th>
                  <th className="th text-right">Payments</th>
                  <th className="th text-right">Vendor</th>
                  <th className="th text-right">Payroll</th>
                  <th className="th text-right">Total</th>
                  <th className="th text-right">Reconciled</th>
                  <th className="th">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {data.items.map((batch) => (
                  <tr key={batch.id} className="hover:bg-slate-50">
                    <td className="td">
                      <Link className="font-mono font-medium text-brand-700" to={`/payments/batches/${batch.id}`}>
                        {batch.reference}
                      </Link>
                    </td>
                    <td className="td">{formatDate(batch.paymentDate)}</td>
                    <td className="td text-right tabular">{batch.itemCount}</td>
                    <td className="td text-right">{formatCompactINR(batch.vendorAmount)}</td>
                    <td className="td text-right">{formatCompactINR(batch.payrollAmount)}</td>
                    <td className="td text-right font-medium"><Money minor={batch.totalAmount} /></td>
                    <td className="td text-right text-slate-500">
                      {batch.itemCount ? `${batch.reconciledCount}/${batch.itemCount}` : '—'}
                    </td>
                    <td className="td"><StatusBadge status={batch.status} /></td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} />
          </>
        )}
      </div>
    </>
  );
}

/** Payment batch detail — PRD §22, §23. */
export function PaymentBatchDetailPage() {
  const { id = '' } = useParams();
  const queryClient = useQueryClient();
  const { can } = useAuth();

  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null);

  const { data: batch, isLoading, error } = useQuery({
    queryKey: ['payment-batch', id],
    queryFn: () => api.payments.batch(id),
  });

  const exportBatch = useMutation({
    mutationFn: () => api.payments.exportBatch(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['payment-batch', id] });
      void queryClient.invalidateQueries({ queryKey: ['payment-batches'] });
    },
  });

  const download = useMutation({
    mutationFn: async () => {
      const blob = await api.payments.downloadFile(id);
      downloadBlob(blob, batch?.exportFileName ?? `${batch?.reference ?? 'batch'}.xlsx`);
    },
  });

  // Only a draft batch can be changed — once the file is with the bank,
  // removing a line here would not stop the payment.
  const removeItems = useMutation({
    mutationFn: (obligationIds: string[]) =>
      api.payments.updateBatch(id, { removeObligationIds: obligationIds }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['payment-batch', id] });
      void queryClient.invalidateQueries({ queryKey: ['payment-queue'] });
      setRemoving(null);
    },
  });

  if (isLoading) return <Spinner />;
  if (error) return <ErrorState error={error} />;
  if (!batch) return null;

  const isDraft = batch.status === 'DRAFT';

  return (
    <>
      {removing ? (
        <ConfirmWithReason
          title="Remove this payment from the batch"
          actionLabel="Remove"
          requireReason={false}
          description={
            <p>
              {removing.name} returns to the payment queue and can be included in a later batch.
            </p>
          }
          pending={removeItems.isPending}
          error={removeItems.error}
          onClose={() => setRemoving(null)}
          onConfirm={() => removeItems.mutate([removing.id])}
        />
      ) : null}

      <PageHeader
        title={batch.reference}
        subtitle={
          <span className="flex flex-wrap items-center gap-3">
            <StatusBadge status={batch.status} />
            <span>Payment date {formatDate(batch.paymentDate)}</span>
            {batch.exportedAt ? <span>· Exported {formatDateTime(batch.exportedAt)}</span> : null}
          </span>
        }
        actions={
          <>
            {batch.exportFileId ? (
              <button className="btn-secondary" onClick={() => download.mutate()}>
                Download bank file
              </button>
            ) : null}
            {can('payment_batch:export') && !batch.exportFileId ? (
              <button
                className="btn-primary"
                disabled={exportBatch.isPending}
                onClick={() => exportBatch.mutate()}
              >
                {exportBatch.isPending ? 'Generating…' : 'Generate bank file'}
              </button>
            ) : null}
          </>
        }
      />

      {exportBatch.error ? <div className="mb-4"><ErrorState error={exportBatch.error} /></div> : null}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Vendor payments</p>
          <p className="mt-1 text-xl font-semibold tabular"><Money minor={batch.vendorAmount} /></p>
          <p className="text-xs text-slate-500">{batch.vendorCount} payments</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Payroll</p>
          <p className="mt-1 text-xl font-semibold tabular"><Money minor={batch.payrollAmount} /></p>
          <p className="text-xs text-slate-500">{batch.payrollCount} payments</p>
        </Card>
        <Card className="bg-slate-900 p-4 text-white">
          <p className="text-xs uppercase tracking-wide text-slate-300">Batch total</p>
          <p className="mt-1 text-xl font-semibold tabular"><Money minor={batch.totalAmount} /></p>
          <p className="text-xs text-slate-300">{batch.itemCount} payments</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Reconciled</p>
          <p className="mt-1 text-xl font-semibold tabular text-emerald-700">
            <Money minor={batch.reconciledAmount} />
          </p>
          <p className="text-xs text-slate-500">{batch.reconciledCount} of {batch.itemCount}</p>
        </Card>
      </div>

      {batch.status === 'EXPORTED' || batch.status === 'PROCESSING' ? (
        <div className="mb-6 rounded-md border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
          The bank file has been generated. Upload it to the corporate banking portal, then import the
          resulting bank statement to reconcile these payments.
        </div>
      ) : null}

      <Card>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h2 className="font-semibold">
            Payments in this batch
            {isDraft ? (
              <span className="ml-2 text-xs font-normal text-slate-500">
                draft — items can still be removed
              </span>
            ) : null}
          </h2>
          {batch.payrollItemsHidden > 0 ? (
            <span className="text-xs text-slate-500">
              {batch.payrollItemsHidden} payroll rows hidden — requires payroll access
            </span>
          ) : null}
        </div>
        <Table>
          <thead className="bg-slate-50">
            <tr>
              <th className="th">Beneficiary</th>
              <th className="th">Account</th>
              <th className="th">IFSC</th>
              <th className="th">Type</th>
              <th className="th">Reference</th>
              <th className="th text-right">Amount</th>
              <th className="th">Reconciliation</th>
              <th className="th" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {batch.items.map((item) => (
              <tr key={item.id}>
                <td className="td font-medium">{item.beneficiaryName}</td>
                <td className="td font-mono text-xs">{item.beneficiaryAccount}</td>
                <td className="td font-mono text-xs">{item.ifsc}</td>
                <td className="td text-xs text-slate-500">{humanize(item.type)}</td>
                <td className="td font-mono text-xs">{item.reference}</td>
                <td className="td text-right"><Money minor={item.amount} /></td>
                <td className="td"><StatusBadge status={item.reconciliationStatus} /></td>
                <td className="td text-right">
                  {isDraft && can('payment_batch:update') ? (
                    <button
                      className="text-sm text-red-600"
                      onClick={() => setRemoving({ id: item.obligationId, name: item.beneficiaryName })}
                    >
                      Remove
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
