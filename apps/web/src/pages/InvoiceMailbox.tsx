import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';
import { MAIL_SKIP_REASON_LABELS, type MailSkipReason } from '@fpc/shared';
import type { MailConnectionView, MailIngestionRow } from '@fpc/api-client';
import { api } from '@/lib/api';
import { formatDate, formatDateTime, relativeDays } from '@/lib/format';
import { useAuth } from '@/hooks/useAuth';
import {
  Card,
  ConfirmWithReason,
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
import { MailRulesModal } from './InvoiceMailboxRules';

/**
 * The Invoice Mailbox.
 *
 * Answers three questions for someone who connected their own Outlook: which
 * emails were pulled, what the extractor made of each attachment, and what is
 * still in flight. Messages that produced nothing are shown too — a skipped
 * email with a reason is the only thing that explains an invoice that never
 * arrived.
 */

type View = 'ALL' | 'IN_PROGRESS' | 'READY' | 'SKIPPED' | 'FAILED';

const VIEWS: Array<{ key: View; label: string }> = [
  { key: 'ALL', label: 'All' },
  { key: 'IN_PROGRESS', label: 'In progress' },
  { key: 'READY', label: 'Ready for review' },
  { key: 'SKIPPED', label: 'Skipped' },
  { key: 'FAILED', label: 'Failed' },
];

/** Fast enough to feel live, slow enough not to hammer a background run. */
const POLL_MS = 3_000;

/**
 * A tab left open against a server that died must not poll forever. The
 * server-side sweep marks an abandoned run failed within ten minutes anyway.
 */
const POLL_CEILING_MS = 5 * 60 * 1000;

export function InvoiceMailboxPage() {
  const { can, companyId } = useAuth();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const view = (params.get('view') as View) ?? 'ALL';
  const page = Number(params.get('page') ?? 1);
  const search = params.get('q') ?? '';
  const connectOutcome = params.get('connect');

  const canManage = can('mail_connection:manage');

  const connectionQuery = useQuery({
    queryKey: ['mail', 'connection'],
    queryFn: () => api.mail.connection(),
    staleTime: 0,
  });
  const connection = connectionQuery.data ?? null;
  const running = connection?.syncState === 'RUNNING';

  // Polling is bounded on both ends: it only runs while a sync is claimed, and
  // it gives up after the ceiling rather than spinning against a dead server.
  const startedRef = useRef<number | null>(null);
  if (running && startedRef.current === null) startedRef.current = Date.now();
  if (!running) startedRef.current = null;
  const stalled =
    running && startedRef.current !== null
      ? Date.now() - startedRef.current >= POLL_CEILING_MS
      : false;
  const pollInterval = () => (running && !stalled ? POLL_MS : (false as const));

  const ingestionsQuery = useQuery({
    queryKey: ['mail', 'ingestions', companyId, view, page, search],
    queryFn: () =>
      api.mail.ingestions({
        companyId,
        view,
        page,
        pageSize: 25,
        q: search || undefined,
      }),
    refetchInterval: pollInterval,
  });

  // Both queries follow the same clock, so the run's end stops them together.
  useEffect(() => {
    connectionQuery.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  const syncNow = useMutation({
    mutationFn: () => api.mail.sync(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mail'] });
    },
  });

  const disconnect = useMutation({
    mutationFn: () => api.mail.disconnect(),
    onSuccess: () => {
      setDisconnecting(false);
      queryClient.invalidateQueries({ queryKey: ['mail'] });
    },
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

  /** Clears the callback flag once shown, so a refresh does not repeat it. */
  const dismissOutcome = () => {
    const merged = new URLSearchParams(params);
    merged.delete('connect');
    merged.delete('reason');
    setParams(merged, { replace: true });
  };

  const items = useMemo(() => ingestionsQuery.data?.items ?? [], [ingestionsQuery.data?.items]);
  const runProgress = useMemo(() => {
    if (!running || !connection?.syncRunId) return null;
    const inRun = items.filter((item) => item.syncRunId === connection.syncRunId);
    return {
      done: inRun.filter((item) => item.status !== 'PROCESSING' && item.status !== 'PENDING')
        .length,
      total: inRun.length,
    };
  }, [running, connection?.syncRunId, items]);

  return (
    <>
      <PageHeader
        title="Invoice Mailbox"
        subtitle="Invoices pulled from your connected Outlook"
        actions={
          connection && canManage && connection.status === 'CONNECTED' ? (
            <div className="flex gap-2">
              <button className="btn-secondary" onClick={() => setRulesOpen(true)}>
                Sync rules
              </button>
              <button
                className="btn-primary"
                disabled={running || syncNow.isPending}
                onClick={() => syncNow.mutate()}
              >
                {running || syncNow.isPending ? 'Syncing…' : 'Sync now'}
              </button>
            </div>
          ) : null
        }
      />

      {connectOutcome ? (
        <ConnectOutcomeNotice outcome={connectOutcome} onDismiss={dismissOutcome} />
      ) : null}

      {connectionQuery.isLoading ? (
        <Spinner />
      ) : connectionQuery.error ? (
        <ErrorState error={connectionQuery.error} />
      ) : !connection ? (
        <NotConnectedCard canManage={canManage} />
      ) : (
        <ConnectionCard
          connection={connection}
          canManage={canManage}
          onDisconnect={() => setDisconnecting(true)}
        />
      )}

      {syncNow.error ? (
        <div className="mt-4">
          <ErrorState error={syncNow.error} compact />
        </div>
      ) : null}

      {running ? (
        <div className="notice-info mt-4 flex items-center gap-3" role="status">
          <span
            className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
            aria-hidden
          />
          <span>
            {stalled
              ? 'Still working — refresh to check on it.'
              : runProgress && runProgress.total
                ? `Syncing your mailbox — ${runProgress.done} of ${runProgress.total} emails processed`
                : 'Syncing your mailbox — looking for new invoices'}
          </span>
          {stalled ? (
            <button className="btn-secondary ml-auto" onClick={() => connectionQuery.refetch()}>
              Refresh
            </button>
          ) : null}
        </div>
      ) : null}

      {connection ? (
        <div className="card mt-6">
          <Tabs tabs={VIEWS} active={view} onChange={(key) => update({ view: key })} />

          <div className="flex flex-wrap gap-3 border-b border-slate-200 px-4 py-3">
            <input
              className="input max-w-xs"
              placeholder="Subject or sender…"
              defaultValue={search}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  update({ q: (event.target as HTMLInputElement).value });
                }
              }}
            />
          </div>

          {ingestionsQuery.isLoading ? (
            <Spinner />
          ) : ingestionsQuery.error ? (
            <div className="p-4">
              <ErrorState error={ingestionsQuery.error} />
            </div>
          ) : !items.length ? (
            <EmptyState
              illustration={connection.lastSyncAt ? 'inbox-zero' : 'sync'}
              title={connection.lastSyncAt ? 'Nothing matched your rules' : 'No emails pulled yet'}
              hint={
                connection.lastSyncAt
                  ? 'Widen the sender allow list or the subject keywords in Sync rules, then sync again.'
                  : 'Press Sync now to read your mailbox for the first time.'
              }
            />
          ) : (
            <>
              <Table>
                <thead className="thead">
                  <tr>
                    <th className="th w-8" aria-label="Expand" />
                    <th className="th">Received</th>
                    <th className="th">From</th>
                    <th className="th">Subject</th>
                    <th className="th">Attachments</th>
                    <th className="th">Status</th>
                    <th className="th">Invoices</th>
                    <th className="th" aria-label="Open in Outlook" />
                  </tr>
                </thead>
                <tbody className="tbody">
                  {items.map((row) => (
                    <IngestionRows
                      key={row.id}
                      row={row}
                      expanded={expanded === row.id}
                      canManage={canManage}
                      onToggle={() => setExpanded(expanded === row.id ? null : row.id)}
                    />
                  ))}
                </tbody>
              </Table>
              <Pagination
                page={ingestionsQuery.data!.page}
                pageSize={ingestionsQuery.data!.pageSize}
                total={ingestionsQuery.data!.total}
                onChange={(next) => update({ page: String(next) })}
              />
            </>
          )}
        </div>
      ) : null}

      {rulesOpen && connection ? (
        <MailRulesModal connection={connection} onClose={() => setRulesOpen(false)} />
      ) : null}

      {disconnecting && connection ? (
        <ConfirmWithReason
          title="Disconnect Outlook"
          description={
            <>
              <p>
                We will stop reading {connection.accountEmail}. Emails already pulled stay in the
                log, and the invoices they created are untouched.
              </p>
              <p className="mt-2 text-sm text-ink-500">
                This stops us using the access. To withdraw the permission itself, remove this
                application at{' '}
                <a
                  className="text-brand-700 underline"
                  href="https://myapplications.microsoft.com"
                  target="_blank"
                  rel="noreferrer"
                >
                  myapplications.microsoft.com
                </a>
                .
              </p>
            </>
          }
          actionLabel="Disconnect"
          requireReason={false}
          onClose={() => setDisconnecting(false)}
          onConfirm={() => disconnect.mutate()}
          pending={disconnect.isPending}
          error={disconnect.error}
        />
      ) : null}
    </>
  );
}

/** The one-line result of coming back from Microsoft. */
function ConnectOutcomeNotice({ outcome, onDismiss }: { outcome: string; onDismiss(): void }) {
  const message =
    outcome === 'success'
      ? 'Outlook connected. Press Sync now to pull your first invoices.'
      : outcome === 'conflict'
        ? 'That mailbox is already connected by someone else in your organisation.'
        : 'Outlook was not connected. Nothing has changed — you can try again.';

  return (
    <div
      className={`mt-4 flex items-center gap-3 ${
        outcome === 'success' ? 'notice-info' : 'notice-danger'
      }`}
      role="status"
    >
      <span>{message}</span>
      <button className="btn-ghost ml-auto" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  );
}

function NotConnectedCard({ canManage }: { canManage: boolean }) {
  return (
    <Card>
      <EmptyState
        illustration="sign-in"
        title={canManage ? 'Connect your Outlook' : 'No mailbox connected'}
        hint={
          canManage
            ? 'We read only messages with attachments that match your rules. Nothing in your mailbox is changed or marked as read.'
            : 'Nobody has connected a mailbox that you can see yet.'
        }
        action={canManage ? <ConnectButton label="Connect Outlook" /> : undefined}
      />
    </Card>
  );
}

function ConnectionCard({
  connection,
  canManage,
  onDisconnect,
}: {
  connection: MailConnectionView;
  canManage: boolean;
  onDisconnect(): void;
}) {
  const healthy = connection.status === 'CONNECTED';

  return (
    <Card>
      <div className="grid gap-6 p-4 sm:grid-cols-2">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-ink-900">{connection.accountEmail}</span>
            <StatusBadge status={connection.status} />
          </div>
          <p className="text-sm text-ink-500">
            {connection.ownerName} · connected {formatDate(connection.connectedAt)}
          </p>
          <p className="text-sm text-ink-500">
            Invoices go to <span className="font-medium">{connection.defaultCompanyName}</span>{' '}
            unless a routing rule says otherwise.
          </p>
        </div>

        <div className="space-y-2 sm:text-right">
          <p className="text-sm text-ink-500">
            {connection.lastSyncAt
              ? `Last sync ${relativeDays(connection.lastSyncAt)} · ${connection.totalMessagesSeen} emails · ${connection.totalInvoicesCreated} invoices`
              : 'Not synced yet'}
          </p>
          {canManage ? (
            <button className="btn-ghost" onClick={onDisconnect}>
              Disconnect
            </button>
          ) : null}
        </div>
      </div>

      {!healthy ? (
        <div
          className={`mx-4 mb-4 flex items-center gap-3 ${
            connection.status === 'REVOKED' ? 'notice-danger' : 'notice-warning'
          }`}
        >
          <span>
            {connection.statusMessage ?? 'This mailbox needs reconnecting before it can sync.'}
          </span>
          {canManage ? (
            <span className="ml-auto">
              <ConnectButton label="Reconnect" defaultCompanyId={connection.defaultCompanyId} />
            </span>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

/**
 * Starts the consent flow.
 *
 * A company must be chosen before connecting: the connection is per-user and
 * global, so there is no company to infer, and every invoice it creates needs
 * one.
 */
function ConnectButton({ label, defaultCompanyId }: { label: string; defaultCompanyId?: string }) {
  const { companyId } = useAuth();
  const target = defaultCompanyId ?? companyId;

  const connect = useMutation({
    mutationFn: () => api.mail.connect(target!),
    onSuccess: (result) => {
      window.location.assign(result.authorizeUrl);
    },
  });

  return (
    <>
      <button
        className="btn-primary"
        disabled={!target || connect.isPending}
        onClick={() => connect.mutate()}
      >
        {connect.isPending ? 'Opening Microsoft…' : label}
      </button>
      {connect.error ? (
        <div className="mt-2">
          <ErrorState error={connect.error} compact />
        </div>
      ) : null}
    </>
  );
}

/** One email, plus its per-attachment detail when expanded. */
function IngestionRows({
  row,
  expanded,
  canManage,
  onToggle,
}: {
  row: MailIngestionRow;
  expanded: boolean;
  canManage: boolean;
  onToggle(): void;
}) {
  const created = row.attachments.filter((attachment) => attachment.invoice).length;

  return (
    <>
      <tr className="cursor-pointer hover:bg-slate-50" onClick={onToggle}>
        <td className="td">
          <button
            className="btn-icon"
            aria-label={expanded ? 'Collapse' : 'Expand'}
            aria-expanded={expanded}
          >
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        </td>
        <td className="td">
          <div>{formatDate(row.receivedAt)}</div>
          <div className="text-xs text-ink-500">{relativeDays(row.receivedAt)}</div>
        </td>
        <td className="td">
          <div className="font-medium">{row.fromName ?? row.fromAddress}</div>
          {row.fromName ? <div className="text-xs text-ink-500">{row.fromAddress}</div> : null}
        </td>
        <td className="td max-w-xs truncate">{row.subject}</td>
        <td className="td text-xs text-ink-500">
          {row.attachmentCount === 1 ? '1 file' : `${row.attachmentCount} files`}
        </td>
        <td className="td">
          <StatusBadge status={row.status} />
        </td>
        <td className="td text-xs text-ink-500">
          {created ? (created === 1 ? '1 created' : `${created} created`) : '—'}
        </td>
        <td className="td">
          {row.webLink ? (
            <a
              className="btn-icon"
              href={row.webLink}
              target="_blank"
              rel="noreferrer"
              title="Open in Outlook"
              aria-label="Open in Outlook"
              onClick={(event) => event.stopPropagation()}
            >
              <ExternalLink className="h-4 w-4" />
            </a>
          ) : null}
        </td>
      </tr>

      {expanded ? (
        <tr>
          <td className="td bg-slate-50" colSpan={8}>
            <IngestionDetail row={row} canManage={canManage} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function IngestionDetail({ row, canManage }: { row: MailIngestionRow; canManage: boolean }) {
  const queryClient = useQueryClient();

  const retry = useMutation({
    mutationFn: () => api.mail.retry(row.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['mail', 'ingestions'] }),
  });

  const addSender = useMutation({
    mutationFn: () => api.mail.updateConnection({ rules: { senderAllowlist: [row.fromAddress] } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['mail'] }),
  });

  const retryable = row.attachments.some(
    (attachment) => attachment.status === 'FAILED' && attachment.invoiceId,
  );

  return (
    <div className="space-y-3 py-2">
      {row.skipReason ? (
        <div className="notice-warning flex flex-wrap items-center gap-3 text-sm">
          <span>{MAIL_SKIP_REASON_LABELS[row.skipReason as MailSkipReason] ?? row.skipReason}</span>
          {/* Turns the log from a read-only explanation into a one-click fix. */}
          {canManage && row.skipReason === 'SENDER_NOT_ALLOWED' ? (
            <button
              className="btn-secondary ml-auto"
              disabled={addSender.isPending}
              onClick={() => addSender.mutate()}
            >
              {addSender.isPending ? 'Adding…' : `Allow ${row.fromAddress}`}
            </button>
          ) : null}
        </div>
      ) : null}

      {row.error ? <div className="notice-danger text-sm">{row.error}</div> : null}

      {row.attachments.length ? (
        <ul className="space-y-2">
          {row.attachments.map((attachment) => (
            <li key={attachment.name} className="text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{attachment.name}</span>
                <span className="text-xs text-ink-500">{formatBytes(attachment.size)}</span>
                <StatusBadge status={attachment.status} />
                {attachment.invoice ? (
                  <Link className="text-brand-700" to={`/invoices/${attachment.invoice.id}`}>
                    {attachment.invoice.invoiceNumber ?? 'Open invoice'}
                    {attachment.invoice.vendorName ? ` · ${attachment.invoice.vendorName}` : ''}
                  </Link>
                ) : null}
                {attachment.invoice?.totalAmount ? (
                  <Money minor={attachment.invoice.totalAmount} />
                ) : null}
                {attachment.invoice ? <StatusBadge status={attachment.invoice.status} /> : null}
              </div>
              {attachment.error ? (
                <div className="notice-danger mt-1 text-xs">{attachment.error}</div>
              ) : null}
              {attachment.skipReason ? (
                <div className="mt-1 text-xs text-ink-500">
                  Skipped: {humanizeSkip(attachment.skipReason)}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-ink-500">This email carried no attachments.</p>
      )}

      <div className="flex flex-wrap items-center gap-3 text-xs text-ink-500">
        <span>Pulled {formatDateTime(row.startedAt)}</span>
        {row.completedAt ? <span>Finished {formatDateTime(row.completedAt)}</span> : null}
        {canManage && retryable ? (
          <button
            className="btn-secondary ml-auto"
            disabled={retry.isPending}
            onClick={() => retry.mutate()}
          >
            {retry.isPending ? 'Retrying…' : 'Retry'}
          </button>
        ) : null}
      </div>

      {retry.error ? <ErrorState error={retry.error} compact /> : null}
      {addSender.error ? <ErrorState error={addSender.error} compact /> : null}
    </div>
  );
}

function humanizeSkip(reason: string): string {
  if (reason === 'UNSUPPORTED_TYPE') return 'not a PDF, JPEG or PNG';
  if (reason === 'TOO_LARGE') return 'too large to read';
  if (reason === 'INLINE') return 'an inline image, such as a signature logo';
  if (reason === 'COMPANY_ACCESS_LOST') return 'you no longer have access to the target company';
  return reason.toLowerCase().replace(/_/g, ' ');
}

function formatBytes(bytes: number): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
