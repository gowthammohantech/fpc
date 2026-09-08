import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  TDS_SECTIONS,
  basisPointsToPercent,
  computeTds,
  formatINR,
  percentToBasisPoints,
  tdsBaseFor,
  type Invoice,
  type TdsSection,
} from '@fpc/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { formatDate } from '@/lib/format';
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

type View = 'ACCOUNTING' | 'TRUSTEE';

/**
 * The accounting workbench.
 *
 * Everything that has cleared business approval and is waiting on the
 * accounting team, alongside what has been escalated. Selecting a row opens
 * the verification panel beside it, so the queue stays visible while a
 * deduction is keyed.
 */
export function AccountingPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { companyId, verticalId } = useAuth();
  const [view, setView] = useState<View>('ACCOUNTING');

  const { data, isLoading, error } = useQuery({
    queryKey: ['accounting-queue', companyId, verticalId, view],
    queryFn: () => api.invoices.list({ companyId, verticalId, view, pageSize: 50 }),
  });

  const rows = data?.items ?? [];
  const selectedId = id ?? rows[0]?.id;

  return (
    <>
      <PageHeader
        title="Accounting"
        subtitle="Verify approved invoices, apply TDS, and release them for payment"
      />

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <Tabs
            tabs={[
              { key: 'ACCOUNTING', label: 'To verify' },
              { key: 'TRUSTEE', label: 'With the trustee' },
            ]}
            active={view}
            onChange={(key) => {
              setView(key);
              navigate('/accounting');
            }}
          />

          {isLoading ? (
            <Spinner />
          ) : error ? (
            <div className="p-4">
              <ErrorState error={error} />
            </div>
          ) : !rows.length ? (
            <EmptyState
              illustration="approved"
              title={view === 'ACCOUNTING' ? 'Nothing to verify' : 'Nothing with the trustee'}
              hint={
                view === 'ACCOUNTING'
                  ? 'Invoices arrive here once the business approvers have signed off.'
                  : undefined
              }
            />
          ) : (
            <Table>
              <thead className="thead">
                <tr>
                  <th className="th">Tracking ID</th>
                  <th className="th">Vendor</th>
                  <th className="th text-right">Gross</th>
                </tr>
              </thead>
              <tbody className="tbody">
                {rows.map((invoice) => (
                  <tr
                    key={invoice.id}
                    className={invoice.id === selectedId ? 'bg-brand-50' : 'hover:bg-slate-50'}
                  >
                    <td className="td">
                      <Link
                        className="font-mono text-xs font-medium text-brand-700"
                        to={`/accounting/${invoice.id}`}
                      >
                        {invoice.trackingId}
                      </Link>
                    </td>
                    <td className="td">{invoice.vendorName ?? '—'}</td>
                    <td className="td text-right">
                      <Money minor={invoice.totalAmount ?? 0} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <div className="lg:col-span-3">
          {selectedId ? (
            <VerificationPanel invoiceId={selectedId} readOnly={view === 'TRUSTEE'} />
          ) : null}
        </div>
      </div>
    </>
  );
}

/**
 * The verification form for one invoice.
 *
 * The three figures are always shown together — gross, TDS, net — because the
 * whole point of the stage is that the vendor bills one amount and the bank
 * pays another.
 */
function VerificationPanel({ invoiceId, readOnly }: { invoiceId: string; readOnly: boolean }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const {
    data: invoice,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['invoice', invoiceId],
    queryFn: () => api.invoices.get(invoiceId),
  });

  const [tdsApplicable, setTdsApplicable] = useState(false);
  const [section, setSection] = useState('');
  const [ratePercent, setRatePercent] = useState('');
  const [glCode, setGlCode] = useState('');
  const [notes, setNotes] = useState('');
  const [remarks, setRemarks] = useState('');
  const [priority, setPriority] = useState<'P1' | 'P2'>('P2');

  // Seeded from the vendor master by the extractor, then owned by this form.
  useEffect(() => {
    if (!invoice) return;
    setTdsApplicable(invoice.tdsApplicable);
    setSection(invoice.tdsSection ?? '');
    setRatePercent(
      invoice.tdsRateBasisPoints ? String(basisPointsToPercent(invoice.tdsRateBasisPoints)) : '',
    );
    setGlCode(invoice.accounting?.glCode ?? '');
    setNotes(invoice.accounting?.notes ?? '');
  }, [invoice]);

  const verify = useMutation({
    mutationFn: (action: 'RELEASE' | 'ESCALATE' | 'RETURN') =>
      api.invoices.verify(invoiceId, {
        action,
        tdsApplicable,
        tdsSection: tdsApplicable ? (section as TdsSection) : '',
        tdsRateBasisPoints: tdsApplicable
          ? percentToBasisPoints(Number(ratePercent || 0))
          : undefined,
        glCode: glCode || undefined,
        notes: notes || undefined,
        priority: action === 'ESCALATE' ? priority : undefined,
        remarks: action === 'RELEASE' ? undefined : remarks,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['accounting-queue'] });
      void queryClient.invalidateQueries({ queryKey: ['invoice', invoiceId] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      navigate('/accounting');
    },
  });

  if (isLoading) return <Spinner />;
  if (error) return <ErrorState error={error} />;
  if (!invoice) return null;

  const preview = previewOf(invoice, tdsApplicable, ratePercent);

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-5 py-3">
        <div>
          <p className="font-mono text-xs text-slate-500">{invoice.trackingId}</p>
          <h2 className="font-semibold">{invoice.vendorName ?? 'Invoice'}</h2>
          <p className="text-sm text-slate-500">
            {invoice.invoiceNumber ?? '—'} · {formatDate(invoice.invoiceDate)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={invoice.status} />
          <Link className="btn-secondary" to={`/invoices/${invoice.id}`}>
            Open invoice
          </Link>
        </div>
      </div>

      <dl className="grid grid-cols-3 gap-4 border-b border-slate-200 px-5 py-4">
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-500">Gross billed</dt>
          <dd className="text-lg font-semibold">
            <Money minor={invoice.totalAmount ?? 0} />
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-500">TDS withheld</dt>
          <dd className="text-lg font-semibold text-amber-700">{formatINR(preview.tdsAmount)}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-500">Net payable</dt>
          <dd className="text-lg font-semibold text-emerald-700">
            {formatINR(preview.netPayable)}
          </dd>
        </div>
      </dl>

      {readOnly ? (
        <div className="px-5 py-4 text-sm text-slate-600">
          This invoice is with the trustee. Its decision is made on the{' '}
          <Link className="text-brand-700" to="/finance-requests">
            trustee requests
          </Link>{' '}
          screen.
        </div>
      ) : (
        <div className="space-y-4 px-5 py-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="block">
              <span className="label">Deduct TDS</span>
              <select
                className="input"
                value={tdsApplicable ? 'yes' : 'no'}
                onChange={(event) => setTdsApplicable(event.target.value === 'yes')}
              >
                <option value="no">No</option>
                <option value="yes">Yes</option>
              </select>
            </label>
            <label className="block">
              <span className="label">Section</span>
              <select
                className="input"
                value={section}
                disabled={!tdsApplicable}
                onChange={(event) => setSection(event.target.value)}
              >
                <option value="">—</option>
                {TDS_SECTIONS.map((entry) => (
                  <option key={entry} value={entry}>
                    {entry}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="label">Rate %</span>
              <input
                className="input"
                type="number"
                step="0.01"
                min="0"
                max="100"
                value={ratePercent}
                disabled={!tdsApplicable}
                onChange={(event) => setRatePercent(event.target.value)}
              />
            </label>
          </div>

          <p className="text-xs text-slate-500">
            TDS is calculated on the taxable value ({formatINR(tdsBaseFor(invoice))}), not on the
            GST charged over it.
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="label">GL code</span>
              <input
                className="input"
                value={glCode}
                onChange={(event) => setGlCode(event.target.value)}
              />
            </label>
            <label className="block">
              <span className="label">Accounting notes</span>
              <input
                className="input"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
              />
            </label>
          </div>

          <label className="block">
            <span className="label">Remarks</span>
            <textarea
              className="input"
              rows={2}
              value={remarks}
              placeholder="Required when escalating or returning — say why, so the next person does not have to guess."
              onChange={(event) => setRemarks(event.target.value)}
            />
          </label>

          {verify.error ? <ErrorState error={verify.error} /> : null}

          <div className="flex flex-wrap items-center gap-2">
            <button
              className="btn-primary"
              disabled={verify.isPending}
              onClick={() => verify.mutate('RELEASE')}
            >
              Verify &amp; release for payment
            </button>

            <select
              className="input w-auto"
              value={priority}
              onChange={(event) => setPriority(event.target.value as 'P1' | 'P2')}
            >
              <option value="P1">Priority 1</option>
              <option value="P2">Priority 2</option>
            </select>
            <button
              className="btn-secondary"
              disabled={verify.isPending}
              onClick={() => verify.mutate('ESCALATE')}
            >
              Escalate to trustee
            </button>

            <button
              className="btn-secondary"
              disabled={verify.isPending}
              onClick={() => verify.mutate('RETURN')}
            >
              Return for correction
            </button>
          </div>
        </div>
      )}

      {invoice.accounting?.verifiedAt ? (
        <p className="border-t border-slate-200 px-5 py-3 text-xs text-slate-500">
          Last verified {formatDate(invoice.accounting.verifiedAt)}
          {invoice.accounting.notes ? ` — ${invoice.accounting.notes}` : ''}
        </p>
      ) : null}
    </Card>
  );
}

/**
 * What the deduction would be with the values currently in the form.
 *
 * Uses the same pure function the server does, so the figure shown before
 * submitting is the figure that gets stored.
 */
function previewOf(invoice: Invoice, tdsApplicable: boolean, ratePercent: string) {
  const baseAmount = tdsBaseFor(invoice);
  const tdsAmount = computeTds({
    tdsApplicable,
    baseAmount,
    rateBasisPoints: percentToBasisPoints(Number(ratePercent || 0)),
  });
  const capped = Math.min(tdsAmount, invoice.totalAmount ?? 0);
  return { tdsAmount: capped, netPayable: (invoice.totalAmount ?? 0) - capped };
}
