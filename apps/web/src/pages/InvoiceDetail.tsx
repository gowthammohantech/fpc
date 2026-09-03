import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Invoice, ValidationFinding } from '@fpc/shared';
import { api, apiClient } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { formatDate, formatDateTime, humanize, rupeesToMinor } from '@/lib/format';
import { fromMinor } from '@fpc/shared';
import {
  Card,
  ConfidenceBadge,
  ConfirmWithReason,
  ErrorState,
  Modal,
  Money,
  PageHeader,
  Spinner,
  StatusBadge,
} from '@/components/ui';

/**
 * Invoice review and detail — PRD §12, §13.
 *
 * The document sits beside the extracted fields so a reviewer can check a
 * value against the page without switching context, and every field shows the
 * confidence it was extracted with, so attention goes where the machine was
 * unsure rather than being spread evenly.
 */
export function InvoiceDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const [resolving, setResolving] = useState<ValidationFinding | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const { data: invoice, isLoading, error } = useQuery({
    queryKey: ['invoice', id],
    queryFn: () => api.invoices.get(id),
  });

  const { data: audit } = useQuery({
    queryKey: ['audit', 'INVOICE', id],
    queryFn: () => api.audit.forEntity('INVOICE', id),
    enabled: can('audit:read'),
  });

  const { data: vendors } = useQuery({
    queryKey: ['vendors', invoice?.companyId],
    queryFn: () => api.settings.vendors({ companyId: invoice!.companyId, pageSize: 200 }),
    enabled: !!invoice?.companyId && can('vendor:read'),
  });

  const submit = useMutation({
    mutationFn: () => api.invoices.submit(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['invoice', id] });
      void queryClient.invalidateQueries({ queryKey: ['invoices'] });
    },
  });

  const cancel = useMutation({
    mutationFn: (reason: string) => api.invoices.cancel(id, reason),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['invoice', id] });
      void queryClient.invalidateQueries({ queryKey: ['invoices'] });
      setCancelling(false);
    },
  });

  // Re-running extraction discards reviewer edits, so it is offered only
  // where those edits do not exist yet or have already failed.
  const reextract = useMutation({
    mutationFn: () => api.invoices.reextract(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['invoice', id] });
    },
  });

  if (isLoading) return <Spinner />;
  if (error) return <ErrorState error={error} />;
  if (!invoice) return null;

  const blocking = (invoice.findings ?? []).filter(
    (finding) => !finding.resolved && finding.severity !== 'INFO',
  );
  const editable = ['REVIEW_REQUIRED', 'VALIDATED', 'FAILED', 'REJECTED'].includes(invoice.status);

  return (
    <>
      <PageHeader
        title={invoice.invoiceNumber ?? 'Invoice'}
        subtitle={
          <span className="flex flex-wrap items-center gap-3">
            <StatusBadge status={invoice.status} />
            <span>{invoice.vendorName ?? 'Vendor not set'}</span>
            <span>·</span>
            <span>Received {formatDateTime(invoice.receivedAt)}</span>
          </span>
        }
        actions={
          <>
            <button className="btn-secondary" onClick={() => navigate(-1)}>Back</button>
            {editable && can('invoice:update') ? (
              <button
                className="btn-secondary"
                disabled={reextract.isPending}
                title="Read the document again, discarding any manual corrections"
                onClick={() => reextract.mutate()}
              >
                {reextract.isPending ? 'Queued…' : 'Re-run extraction'}
              </button>
            ) : null}
            {can('invoice:cancel') && !['PAID', 'RECONCILED', 'CANCELLED'].includes(invoice.status) ? (
              <button className="btn-secondary" onClick={() => setCancelling(true)}>
                Cancel invoice
              </button>
            ) : null}
            {editable && can('invoice:submit') ? (
              <button
                className="btn-primary"
                disabled={blocking.length > 0 || submit.isPending}
                title={blocking.length ? 'Resolve the findings below first' : undefined}
                onClick={() => submit.mutate()}
              >
                {submit.isPending ? 'Submitting…' : 'Submit for approval'}
              </button>
            ) : null}
          </>
        }
      />

      {submit.error ? (
        <div className="mb-4">
          <ErrorState error={submit.error} />
        </div>
      ) : null}

      {submit.data?.autoApprovedReason ? (
        <div className="mb-4 rounded-md border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
          Approved automatically: {submit.data.autoApprovedReason}. Configure an approval rule in
          Settings if this should have required sign-off.
        </div>
      ) : null}

      {invoice.findings?.length ? (
        <div className="mb-6 space-y-2">
          {invoice.findings.map((finding) => (
            <FindingBanner
              key={`${finding.code}-${finding.field ?? ''}`}
              finding={finding}
              canResolve={can('invoice:resolve_duplicate') && editable}
              onResolve={() => setResolving(finding)}
            />
          ))}
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <InvoiceFields
          invoice={invoice}
          editable={editable && can('invoice:update')}
          vendors={vendors?.items ?? []}
        />
        <DocumentViewer invoiceId={invoice.id} fileName={invoice.documentFileName} />
      </div>

      {invoice.lines?.length ? (
        <Card className="mt-6">
          <div className="border-b border-slate-200 px-5 py-3">
            <h2 className="font-semibold">Line items</h2>
          </div>
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr>
                <th className="th">Description</th>
                <th className="th text-right">Qty</th>
                <th className="th text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {invoice.lines.map((line, index) => (
                <tr key={index}>
                  <td className="td whitespace-normal">{line.description}</td>
                  <td className="td text-right">{line.quantity ?? '—'}</td>
                  <td className="td text-right"><Money minor={line.amount} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : null}

      {audit?.items.length ? (
        <Card className="mt-6">
          <div className="border-b border-slate-200 px-5 py-3">
            <h2 className="font-semibold">Audit trail</h2>
          </div>
          <ol className="divide-y divide-slate-100">
            {audit.items.map((event) => (
              <li key={event.id} className="flex gap-4 px-5 py-3 text-sm">
                <span className="w-40 shrink-0 text-slate-500">{formatDateTime(event.timestamp)}</span>
                <span className="flex-1">
                  <span className="font-medium">{humanize(event.event.split('.').pop())}</span>
                  {event.userName ? <span className="text-slate-500"> · {event.userName}</span> : null}
                  {event.metadata?.comment ? (
                    <p className="mt-1 text-slate-600">“{String(event.metadata.comment)}”</p>
                  ) : null}
                </span>
              </li>
            ))}
          </ol>
        </Card>
      ) : null}

      {cancelling ? (
        <ConfirmWithReason
          title="Cancel this invoice"
          actionLabel="Cancel invoice"
          description={
            <>
              <p>
                {invoice.vendorName ?? 'This invoice'} {invoice.invoiceNumber ?? ''} will be
                cancelled and can no longer be paid. Any approval still in progress is withdrawn.
              </p>
              <p className="mt-2">This cannot be undone.</p>
            </>
          }
          pending={cancel.isPending}
          error={cancel.error}
          onClose={() => setCancelling(false)}
          onConfirm={(reason) => cancel.mutate(reason)}
        />
      ) : null}

      {resolving ? (
        <ResolveFindingModal
          invoiceId={invoice.id}
          finding={resolving}
          onClose={() => setResolving(null)}
        />
      ) : null}
    </>
  );
}

function FindingBanner({
  finding,
  canResolve,
  onResolve,
}: {
  finding: ValidationFinding;
  canResolve: boolean;
  onResolve(): void;
}) {
  if (finding.resolved) {
    return (
      <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-600">
        <span className="font-medium">Resolved:</span> {finding.message}
        {finding.resolutionNote ? <span className="text-slate-500"> — “{finding.resolutionNote}”</span> : null}
      </div>
    );
  }

  const tone =
    finding.severity === 'ERROR' ? 'border-red-200 bg-red-50 text-red-800'
    : finding.severity === 'WARNING' ? 'border-amber-200 bg-amber-50 text-amber-900'
    : 'border-blue-200 bg-blue-50 text-blue-900';

  return (
    <div className={`flex items-start justify-between gap-4 rounded-md border px-4 py-3 text-sm ${tone}`}>
      <span>
        <span className="font-medium">{humanize(finding.code)}</span> — {finding.message}
      </span>
      {canResolve && finding.severity !== 'INFO' ? (
        <button className="btn-secondary shrink-0" onClick={onResolve}>
          Resolve
        </button>
      ) : null}
    </div>
  );
}

function InvoiceFields({
  invoice,
  editable,
  vendors,
}: {
  invoice: Invoice;
  editable: boolean;
  vendors: Array<{ id: string; name: string }>;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState({
    vendorId: invoice.vendorId ?? '',
    invoiceNumber: invoice.invoiceNumber ?? '',
    invoiceDate: invoice.invoiceDate?.slice(0, 10) ?? '',
    dueDate: invoice.dueDate?.slice(0, 10) ?? '',
    subtotal: invoice.subtotal !== undefined ? String(fromMinor(invoice.subtotal)) : '',
    taxAmount: invoice.taxAmount !== undefined ? String(fromMinor(invoice.taxAmount)) : '',
    totalAmount: invoice.totalAmount !== undefined ? String(fromMinor(invoice.totalAmount)) : '',
  });

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {};
      if (draft.vendorId) body.vendorId = draft.vendorId;
      if (draft.invoiceNumber) body.invoiceNumber = draft.invoiceNumber;
      if (draft.invoiceDate) body.invoiceDate = draft.invoiceDate;
      if (draft.dueDate) body.dueDate = draft.dueDate;
      for (const field of ['subtotal', 'taxAmount', 'totalAmount'] as const) {
        const minor = rupeesToMinor(draft[field]);
        if (minor !== null) body[field] = minor;
      }
      return api.invoices.update(invoice.id, body);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['invoice', invoice.id] }),
  });

  const confidence = (field: string): number | undefined =>
    invoice.extraction?.fields?.[field]?.confidence;

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-semibold">Invoice details</h2>
        {invoice.extraction ? (
          <span className="text-xs text-slate-500">
            Extracted by {invoice.extraction.provider}
            {invoice.extraction.model ? ` (${invoice.extraction.model})` : ''}
          </span>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Vendor" confidence={confidence('vendorName')}>
          {editable ? (
            <select
              className="input"
              value={draft.vendorId}
              onChange={(event) => setDraft({ ...draft, vendorId: event.target.value })}
            >
              <option value="">Select a vendor…</option>
              {vendors.map((vendor) => (
                <option key={vendor.id} value={vendor.id}>{vendor.name}</option>
              ))}
            </select>
          ) : (
            <p className="text-sm">{invoice.vendorName ?? '—'}</p>
          )}
        </Field>

        <Field label="Invoice number" confidence={confidence('invoiceNumber')}>
          {editable ? (
            <input
              className="input"
              value={draft.invoiceNumber}
              onChange={(event) => setDraft({ ...draft, invoiceNumber: event.target.value })}
            />
          ) : (
            <p className="text-sm">{invoice.invoiceNumber ?? '—'}</p>
          )}
        </Field>

        <Field label="Invoice date" confidence={confidence('invoiceDate')}>
          {editable ? (
            <input
              type="date"
              className="input"
              value={draft.invoiceDate}
              onChange={(event) => setDraft({ ...draft, invoiceDate: event.target.value })}
            />
          ) : (
            <p className="text-sm">{formatDate(invoice.invoiceDate)}</p>
          )}
        </Field>

        <Field label="Due date" confidence={confidence('dueDate')}>
          {editable ? (
            <input
              type="date"
              className="input"
              value={draft.dueDate}
              onChange={(event) => setDraft({ ...draft, dueDate: event.target.value })}
            />
          ) : (
            <p className="text-sm">{formatDate(invoice.dueDate)}</p>
          )}
        </Field>

        <Field label="Subtotal" confidence={confidence('subtotal')}>
          {editable ? (
            <input
              className="input tabular"
              inputMode="decimal"
              value={draft.subtotal}
              onChange={(event) => setDraft({ ...draft, subtotal: event.target.value })}
            />
          ) : (
            <Money minor={invoice.subtotal} />
          )}
        </Field>

        <Field label="Tax" confidence={confidence('taxAmount')}>
          {editable ? (
            <input
              className="input tabular"
              inputMode="decimal"
              value={draft.taxAmount}
              onChange={(event) => setDraft({ ...draft, taxAmount: event.target.value })}
            />
          ) : (
            <Money minor={invoice.taxAmount} />
          )}
        </Field>

        <Field label="Total" confidence={confidence('totalAmount')}>
          {editable ? (
            <input
              className="input tabular font-semibold"
              inputMode="decimal"
              value={draft.totalAmount}
              onChange={(event) => setDraft({ ...draft, totalAmount: event.target.value })}
            />
          ) : (
            <Money minor={invoice.totalAmount} className="font-semibold" />
          )}
        </Field>

        <Field label="GSTIN" confidence={confidence('gstin')}>
          <p className="text-sm">{invoice.gstin ?? '—'}</p>
        </Field>
      </div>

      {editable ? (
        <div className="mt-5 flex items-center gap-3">
          <button className="btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Saving…' : 'Save changes'}
          </button>
          {save.isSuccess ? <span className="text-sm text-emerald-700">Saved</span> : null}
          {save.error ? <span className="text-sm text-red-700">{(save.error as Error).message}</span> : null}
        </div>
      ) : null}
    </Card>
  );
}

function Field({
  label,
  confidence,
  children,
}: {
  label: string;
  confidence?: number;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <span className="text-sm font-medium text-slate-700">{label}</span>
        {confidence !== undefined ? <ConfidenceBadge value={confidence} /> : null}
      </div>
      {children}
    </div>
  );
}

/**
 * Renders the source document.
 *
 * The API either returns a signed URL (Azure) or streams the bytes (local
 * disk), so the viewer fetches through the authenticated client and falls
 * back to an object URL when there is no direct link.
 */
function DocumentViewer({ invoiceId, fileName }: { invoiceId: string; fileName?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;

    apiClient
      .download(`/invoices/${invoiceId}/document`)
      .then((blob) => {
        if (cancelled) return;
        // A JSON body means the driver issued a signed URL instead of bytes.
        if (blob.type.includes('json')) {
          return blob.text().then((text) => {
            const parsed = JSON.parse(text) as { url?: string };
            if (parsed.url) setUrl(parsed.url);
          });
        }
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => setFailed(true));

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [invoiceId]);

  return (
    <Card className="flex flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
        <h2 className="font-semibold">Document</h2>
        <span className="truncate text-xs text-slate-500">{fileName}</span>
      </div>
      {failed ? (
        <p className="p-6 text-sm text-slate-500">The original document could not be loaded.</p>
      ) : !url ? (
        <Spinner label="Loading document…" />
      ) : (
        <iframe title="Invoice document" src={url} className="h-[640px] w-full" />
      )}
    </Card>
  );
}

function ResolveFindingModal({
  invoiceId,
  finding,
  onClose,
}: {
  invoiceId: string;
  finding: ValidationFinding;
  onClose(): void;
}) {
  const queryClient = useQueryClient();
  const [resolution, setResolution] = useState<'KEEP' | 'DUPLICATE'>('KEEP');
  const [note, setNote] = useState('');

  const mutation = useMutation({
    mutationFn: () => api.invoices.resolveFinding(invoiceId, { code: finding.code, resolution, note }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['invoice', invoiceId] });
      onClose();
    },
  });

  const isDuplicate = finding.code.includes('DUPLICATE');

  return (
    <Modal
      title="Resolve finding"
      onClose={onClose}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button
            className="btn-primary"
            disabled={note.trim().length < 3 || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? 'Saving…' : 'Record decision'}
          </button>
        </>
      }
    >
      <p className="mb-4 text-sm text-slate-600">{finding.message}</p>

      {isDuplicate ? (
        <div className="mb-4 space-y-2">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              className="mt-1"
              checked={resolution === 'KEEP'}
              onChange={() => setResolution('KEEP')}
            />
            <span>
              <span className="font-medium">This is not a duplicate</span>
              <span className="block text-slate-500">Continue processing this invoice.</span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              className="mt-1"
              checked={resolution === 'DUPLICATE'}
              onChange={() => setResolution('DUPLICATE')}
            />
            <span>
              <span className="font-medium">This is a duplicate</span>
              <span className="block text-slate-500">
                Mark it as such so it can never be paid.
              </span>
            </span>
          </label>
        </div>
      ) : null}

      <label className="label" htmlFor="note">Reason (recorded in the audit trail)</label>
      <textarea
        id="note"
        className="input"
        rows={3}
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="Why is this being resolved this way?"
      />
      {mutation.error ? (
        <div className="mt-3"><ErrorState error={mutation.error} /></div>
      ) : null}
    </Modal>
  );
}
