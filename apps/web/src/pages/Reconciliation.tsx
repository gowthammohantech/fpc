import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MatchSignalsView, ReconciliationRow } from '@fpc/api-client';
import { api } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { formatDate } from '@/lib/format';
import {
  ConfidenceBadge,
  EmptyState,
  ErrorState,
  Modal,
  Money,
  PageHeader,
  Pagination,
  Spinner,
  Tabs,
} from '@/components/ui';

type Tab = 'SUGGESTED' | 'UNMATCHED' | 'MATCHED' | 'IGNORED';

/**
 * Reconciliation workspace — PRD §25, §26.
 *
 * The suggested tab shows the engine's proposal beside the bank line, with the
 * individual signals that produced the score, so a reviewer confirms on
 * evidence rather than on a number they cannot interrogate.
 */
export function ReconciliationPage() {
  const { companyId, can } = useAuth();
  const [tab, setTab] = useState<Tab>('SUGGESTED');
  const [page, setPage] = useState(1);
  const [matching, setMatching] = useState<ReconciliationRow | null>(null);
  const [ignoring, setIgnoring] = useState<ReconciliationRow | null>(null);
  const queryClient = useQueryClient();

  const { data: summary } = useQuery({
    queryKey: ['reconciliation', 'summary', companyId],
    queryFn: () => api.reconciliation.summary({ companyId }),
  });

  const { data, isLoading, error } = useQuery({
    queryKey: ['reconciliation', companyId, tab, page],
    queryFn: () => api.reconciliation.list({ companyId, tab, page, pageSize: 25 }),
  });

  const confirm = useMutation({
    mutationFn: (row: ReconciliationRow) =>
      api.reconciliation.confirm(row.id, row.match!.obligation!.id),
    onSuccess: () => invalidate(),
  });

  const unmatch = useMutation({
    mutationFn: (row: ReconciliationRow) =>
      api.reconciliation.unmatch(row.match!.id, 'Reversed from the reconciliation screen'),
    onSuccess: () => invalidate(),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['reconciliation'] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    void queryClient.invalidateQueries({ queryKey: ['payment-batch'] });
  };

  const tabs: Array<{ key: Tab; label: string; count?: number }> = [
    { key: 'SUGGESTED', label: 'Suggested', count: summary?.SUGGESTED?.count },
    { key: 'UNMATCHED', label: 'Unmatched', count: summary?.UNMATCHED?.count },
    { key: 'MATCHED', label: 'Matched', count: summary?.MATCHED?.count },
    { key: 'IGNORED', label: 'Ignored', count: summary?.IGNORED?.count },
  ];

  return (
    <>
      <PageHeader
        title="Reconciliation"
        subtitle="Match bank debits against the payments we made"
      />

      <div className="card">
        <Tabs
          tabs={tabs}
          active={tab}
          onChange={(key) => {
            setTab(key);
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
            title={
              tab === 'SUGGESTED'
                ? 'No suggestions waiting'
                : tab === 'UNMATCHED'
                  ? 'Everything is accounted for'
                  : tab === 'MATCHED'
                    ? 'Nothing reconciled yet'
                    : 'Nothing ignored'
            }
            hint={
              tab === 'SUGGESTED' ? 'Import a bank statement to generate suggestions.' : undefined
            }
          />
        ) : (
          <>
            <ul className="divide-y divide-slate-100">
              {data.items.map((row) => (
                <li key={row.id} className="p-5">
                  <div className="grid gap-4 lg:grid-cols-[1fr_auto_1fr] lg:items-center">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-slate-500">
                        Bank transaction
                      </p>
                      <p className="mt-1 font-medium">{row.description}</p>
                      <p className="mt-1 text-sm text-slate-500">
                        {formatDate(row.transactionDate)}
                        {row.reference ? ` · ${row.reference}` : ''}
                      </p>
                      <p className="mt-2 text-lg font-semibold tabular text-red-700">
                        <Money minor={row.amount} />
                      </p>
                    </div>

                    <div className="flex flex-col items-center justify-center gap-1">
                      {row.match ? <ConfidenceBadge value={row.match.confidence} /> : null}
                      <span className="text-slate-300">→</span>
                    </div>

                    <div>
                      {row.match?.obligation ? (
                        <>
                          <p className="text-xs uppercase tracking-wide text-slate-500">Payment</p>
                          <p className="mt-1 font-medium">{row.match.obligation.payeeName}</p>
                          <p className="mt-1 text-sm text-slate-500">
                            {row.match.obligation.reference}
                            {row.match.obligation.paymentBatchReference
                              ? ` · ${row.match.obligation.paymentBatchReference}`
                              : ''}
                          </p>
                          <p className="mt-2 text-lg font-semibold tabular">
                            <Money minor={row.match.obligation.amount} />
                          </p>
                        </>
                      ) : (
                        <p className="text-sm text-slate-500">
                          No payment matched. Link one manually, or ignore this line if it is not a
                          payment we made.
                        </p>
                      )}
                    </div>
                  </div>

                  {row.match?.signals ? <Signals signals={row.match.signals} /> : null}

                  <div className="mt-4 flex flex-wrap gap-2">
                    {tab === 'SUGGESTED' && can('reconciliation:confirm') ? (
                      <button
                        className="btn-primary"
                        disabled={confirm.isPending}
                        onClick={() => confirm.mutate(row)}
                      >
                        Confirm match
                      </button>
                    ) : null}
                    {tab !== 'MATCHED' && can('reconciliation:match') ? (
                      <button className="btn-secondary" onClick={() => setMatching(row)}>
                        {row.match ? 'Choose a different payment' : 'Find a payment'}
                      </button>
                    ) : null}
                    {tab !== 'MATCHED' && tab !== 'IGNORED' && can('reconciliation:ignore') ? (
                      <button className="btn-secondary" onClick={() => setIgnoring(row)}>
                        Ignore
                      </button>
                    ) : null}
                    {tab === 'MATCHED' && can('reconciliation:confirm') ? (
                      <button
                        className="btn-secondary"
                        disabled={unmatch.isPending}
                        onClick={() => unmatch.mutate(row)}
                      >
                        Reverse match
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
            <Pagination
              page={data.page}
              pageSize={data.pageSize}
              total={data.total}
              onChange={setPage}
            />
          </>
        )}
      </div>

      {confirm.error ? (
        <div className="mt-4">
          <ErrorState error={confirm.error} />
        </div>
      ) : null}

      {matching ? (
        <ManualMatchModal
          row={matching}
          onClose={() => setMatching(null)}
          onMatched={() => {
            setMatching(null);
            invalidate();
          }}
        />
      ) : null}

      {ignoring ? (
        <IgnoreModal
          row={ignoring}
          onClose={() => setIgnoring(null)}
          onIgnored={() => {
            setIgnoring(null);
            invalidate();
          }}
        />
      ) : null}
    </>
  );
}

/** Why the engine proposed this match — PRD §25's matching signals. */
function Signals({ signals }: { signals: MatchSignalsView }) {
  const entries = [
    {
      label: 'Amount',
      ok: signals.amountScore > 0,
      detail: signals.amountExact ? 'Exact' : signals.amountScore ? 'Within tolerance' : 'No match',
    },
    {
      label: 'Beneficiary',
      ok: signals.nameSimilarity > 0.6,
      detail: `${Math.round(signals.nameSimilarity * 100)}% similar`,
    },
    {
      label: 'Date',
      ok: signals.dateScore > 0,
      detail:
        signals.dayGap < 0
          ? 'Unknown'
          : signals.dayGap === 0
            ? 'Same day'
            : `${signals.dayGap} days apart`,
    },
    {
      label: 'Reference',
      ok: signals.referenceHit,
      detail: signals.referenceHit ? 'Found in narration' : 'Not present',
    },
  ];

  return (
    <div className="mt-4 flex flex-wrap gap-3 rounded-md bg-slate-50 px-4 py-2 text-xs">
      {entries.map((entry) => (
        <span key={entry.label} className="flex items-center gap-1.5">
          <span className={entry.ok ? 'text-emerald-600' : 'text-slate-400'}>
            {entry.ok ? '✓' : '·'}
          </span>
          <span className="font-medium text-slate-700">{entry.label}</span>
          <span className="text-slate-500">{entry.detail}</span>
        </span>
      ))}
    </div>
  );
}

function ManualMatchModal({
  row,
  onClose,
  onMatched,
}: {
  row: ReconciliationRow;
  onClose(): void;
  onMatched(): void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [note, setNote] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['reconciliation', 'candidates', row.id],
    queryFn: () => api.reconciliation.candidates(row.id),
  });

  const confirm = useMutation({
    mutationFn: () => api.reconciliation.confirm(row.id, selected!, note || undefined),
    onSuccess: onMatched,
  });

  return (
    <Modal
      title="Link this transaction to a payment"
      wide
      onClose={onClose}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn-primary"
            disabled={!selected || confirm.isPending}
            onClick={() => confirm.mutate()}
          >
            {confirm.isPending ? 'Confirming…' : 'Confirm match'}
          </button>
        </>
      }
    >
      <div className="mb-4 rounded-md bg-slate-50 p-4">
        <p className="font-medium">{row.description}</p>
        <p className="mt-1 text-sm text-slate-500">
          {formatDate(row.transactionDate)} · <Money minor={row.amount} />
        </p>
      </div>

      {isLoading ? (
        <Spinner label="Finding candidate payments…" />
      ) : !data?.candidates.length ? (
        <p className="text-sm text-slate-500">
          No open payments of a similar amount were found. This transaction may not be one of ours —
          consider ignoring it.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
          {data.candidates.map((candidate) => (
            <li key={candidate.obligationId}>
              <label className="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-slate-50">
                <input
                  type="radio"
                  name="candidate"
                  checked={selected === candidate.obligationId}
                  onChange={() => setSelected(candidate.obligationId)}
                />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{candidate.obligation?.payeeName}</span>
                  <span className="block text-sm text-slate-500">
                    {candidate.obligation?.reference}
                    {candidate.obligation?.paymentBatchReference
                      ? ` · ${candidate.obligation.paymentBatchReference}`
                      : ''}
                  </span>
                </span>
                <Money minor={candidate.obligation?.amount} className="text-sm" />
                <ConfidenceBadge value={candidate.confidence} />
              </label>
            </li>
          ))}
        </ul>
      )}

      <label className="label mt-4" htmlFor="note">
        Note (optional)
      </label>
      <input
        id="note"
        className="input"
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />

      {confirm.error ? (
        <div className="mt-3">
          <ErrorState error={confirm.error} />
        </div>
      ) : null}
    </Modal>
  );
}

function IgnoreModal({
  row,
  onClose,
  onIgnored,
}: {
  row: ReconciliationRow;
  onClose(): void;
  onIgnored(): void;
}) {
  const [note, setNote] = useState('');
  const mutation = useMutation({
    mutationFn: () => api.reconciliation.ignore(row.id, note),
    onSuccess: onIgnored,
  });

  return (
    <Modal
      title="Ignore this transaction"
      onClose={onClose}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn-primary"
            disabled={note.trim().length < 3 || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            Ignore
          </button>
        </>
      }
    >
      <p className="mb-4 text-sm text-slate-600">
        Use this for bank charges, transfers and anything else that is not one of our payments. The
        reason is recorded in the audit trail.
      </p>
      <p className="mb-4 rounded-md bg-slate-50 p-3 text-sm">
        {row.description} · <Money minor={row.amount} />
      </p>
      <label className="label" htmlFor="reason">
        Reason
      </label>
      <input
        id="reason"
        className="input"
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />
      {mutation.error ? (
        <div className="mt-3">
          <ErrorState error={mutation.error} />
        </div>
      ) : null}
    </Modal>
  );
}
