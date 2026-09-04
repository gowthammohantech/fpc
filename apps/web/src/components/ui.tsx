import { useEffect, useState, type ReactNode } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  TrendingDown,
  TrendingUp,
  X,
  type LucideIcon,
} from 'lucide-react';
import { formatCompactINR, formatINR } from '@/lib/format';
import { humanize } from '@/lib/format';
import { Illustration, type IllustrationName } from './Illustration';

/**
 * What a status means, independent of what colour currently expresses it.
 *
 * The tone is the contract — it is what the badges expose as `data-tone` and
 * what the tests assert on — so the palette underneath can be restyled without
 * rewriting a single assertion.
 */
export type Tone = 'positive' | 'negative' | 'attention' | 'progress' | 'neutral';

/**
 * Tone to classes, written out in full.
 *
 * Tailwind generates CSS by scanning source text for literal class names, so
 * a composed `badge-${tone}` would name a rule that was never built.
 */
const BADGE: Record<Tone, string> = {
  positive: 'badge badge-positive',
  negative: 'badge badge-negative',
  attention: 'badge badge-attention',
  progress: 'badge badge-progress',
  neutral: 'badge badge-neutral',
};

/** Coloured status pill. Colour is derived from meaning, not from a lookup. */
export function StatusBadge({ status }: { status: string | null | undefined }) {
  if (!status)
    return (
      <span data-tone="neutral" className="muted">
        —
      </span>
    );
  const tone = toneFor(status);
  return (
    <span data-tone={tone} className={BADGE[tone]}>
      {humanize(status)}
    </span>
  );
}

function toneFor(status: string): Tone {
  const value = status.toUpperCase();
  if (
    ['PAID', 'RECONCILED', 'APPROVED', 'MATCHED', 'ACTIVE', 'COMPLETED', 'SENT'].includes(value)
  ) {
    return 'positive';
  }
  if (['REJECTED', 'FAILED', 'CANCELLED', 'BLOCKED', 'DUPLICATE', 'SUSPENDED'].includes(value)) {
    return 'negative';
  }
  if (
    ['PENDING_APPROVAL', 'REVIEW_REQUIRED', 'SUGGESTED', 'IN_PROGRESS', 'PENDING'].includes(value)
  ) {
    return 'attention';
  }
  if (
    ['PAYMENT_PROCESSING', 'PROCESSING', 'EXPORTED', 'BATCHED', 'PARTIALLY_RECONCILED'].includes(
      value,
    )
  ) {
    return 'progress';
  }
  return 'neutral';
}

/** Right-aligned monetary cell with tabular figures. */
export function Money({
  minor,
  compact = false,
  className = '',
}: {
  minor: number | null | undefined;
  compact?: boolean;
  className?: string;
}) {
  if (minor === null || minor === undefined) return <span className="muted">—</span>;
  return (
    <span className={`tabular ${className}`} title={formatINR(minor)}>
      {compact ? formatCompactINR(minor) : formatINR(minor)}
    </span>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink-900">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-ink-500">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Card({
  children,
  className = '',
  variant = 'default',
}: {
  children: ReactNode;
  className?: string;
  /** `hero` is the dark teal panel; `dark` the Black Steel total card. */
  variant?: 'default' | 'hero' | 'dark';
}) {
  const base = { default: 'card', hero: 'card-hero', dark: 'card-dark' }[variant];
  return <div className={`${base} ${className}`}>{children}</div>;
}

export function StatCard({
  label,
  value,
  sub,
  tone = 'default',
  icon: IconGlyph,
  delta,
  variant = 'default',
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: 'default' | 'warning' | 'danger' | 'success';
  icon?: LucideIcon;
  /**
   * A real period-over-period movement.
   *
   * Deliberately optional and deliberately rare: inventing a percentage the
   * API does not report would put a number a CFO might act on in front of
   * them. Only pass this where the server actually supplies a comparison.
   */
  delta?: { percent: number; label?: string };
  variant?: 'default' | 'hero';
}) {
  const hero = variant === 'hero';
  const accent = hero
    ? 'text-white'
    : {
        default: 'text-ink-900',
        warning: 'text-amber-700',
        danger: 'text-red-700',
        success: 'text-emerald-700',
      }[tone];

  const chip = hero
    ? 'chip-on-dark'
    : {
        default: 'chip-brand',
        warning: 'chip-amber',
        danger: 'chip-danger',
        success: 'chip-brand',
      }[tone];

  const rising = (delta?.percent ?? 0) >= 0;
  const DeltaGlyph = rising ? TrendingUp : TrendingDown;

  return (
    <Card variant={hero ? 'hero' : 'default'} className="p-5">
      {IconGlyph || delta ? (
        <div className="mb-3 flex items-start justify-between gap-3">
          {IconGlyph ? (
            <span className={chip}>
              <IconGlyph className="h-5 w-5" aria-hidden="true" />
            </span>
          ) : (
            <span />
          )}
          {delta ? (
            <span className={hero ? 'delta-on-dark' : rising ? 'delta-up' : 'delta-down'}>
              <DeltaGlyph className="h-3 w-3" aria-hidden="true" />
              {rising ? '+' : '−'}
              {Math.abs(delta.percent)}%
            </span>
          ) : null}
        </div>
      ) : null}

      <p className={hero ? 'stat-label text-brand-100' : 'stat-label'}>{label}</p>
      <p className={`stat-value ${accent}`}>{value}</p>
      {sub ? (
        <p className={`mt-1 text-xs ${hero ? 'text-brand-100' : 'text-ink-500'}`}>{sub}</p>
      ) : null}
      {delta?.label ? (
        <p className={`mt-1 text-xs ${hero ? 'text-brand-100' : 'text-ink-400'}`}>{delta.label}</p>
      ) : null}
    </Card>
  );
}

export function EmptyState({
  title,
  hint,
  illustration = 'no-documents',
  action,
}: {
  title: string;
  hint?: string;
  illustration?: IllustrationName;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-4 py-12 text-center">
      <Illustration name={illustration} className="h-36" />
      <p className="mt-4 text-sm font-semibold text-ink-700">{title}</p>
      {hint ? <p className="mt-1 text-sm text-ink-500">{hint}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div
      role="status"
      className="flex items-center justify-center gap-3 py-12 text-sm text-ink-500"
    >
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-100 border-t-brand-700" />
      {label ?? 'Loading…'}
    </div>
  );
}

/**
 * Error display. A 403 is shown as a permission message rather than a failure,
 * because it is an expected outcome of the role model, not a bug.
 */
export function ErrorState({ error, compact = false }: { error: unknown; compact?: boolean }) {
  const apiError = error as { status?: number; message?: string; isForbidden?: boolean };
  const forbidden = apiError?.status === 403;

  const message = forbidden
    ? 'You do not have permission to view this. Contact your administrator if you need access.'
    : (apiError?.message ?? 'Something went wrong.');

  // Inside a dialog or a table cell an illustration would dominate the message.
  if (compact) {
    return <div className={forbidden ? 'notice-warning' : 'notice-danger'}>{message}</div>;
  }

  return (
    <div className={forbidden ? 'notice-warning' : 'notice-danger'}>
      <div className="flex flex-col items-center gap-3 py-4 text-center sm:flex-row sm:text-left">
        <Illustration
          name={forbidden ? 'no-access' : 'broken'}
          className="h-24 shrink-0"
          credit={false}
        />
        <p>{message}</p>
      </div>
    </div>
  );
}

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-ink-200">{children}</table>
    </div>
  );
}

export function Pagination({
  page,
  pageSize,
  total,
  onChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onChange(page: number): void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;

  return (
    <div className="flex items-center justify-between border-t border-ink-100 px-5 py-3.5 text-sm text-ink-600">
      <span>
        {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of{' '}
        {total.toLocaleString('en-IN')}
      </span>
      <div className="flex gap-2">
        <button className="btn-secondary" disabled={page <= 1} onClick={() => onChange(page - 1)}>
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          Previous
        </button>
        <button
          className="btn-secondary"
          disabled={page >= totalPages}
          onClick={() => onChange(page + 1)}
        >
          Next
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: Array<{ key: T; label: string; count?: number }>;
  active: T;
  onChange(key: T): void;
}) {
  return (
    <div role="tablist" className="flex flex-wrap gap-1 border-b border-ink-100 px-2 pt-2">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          role="tab"
          aria-selected={active === tab.key}
          onClick={() => onChange(tab.key)}
          className={`rounded-t-lg px-4 py-2 text-sm font-medium transition-colors ${
            active === tab.key
              ? 'bg-brand-50 text-brand-800'
              : 'text-ink-500 hover:bg-ink-50 hover:text-ink-900'
          }`}
        >
          {tab.label}
          {tab.count !== undefined ? (
            <span className="ml-2 rounded-full bg-ink-100 px-2 py-0.5 text-xs text-ink-600">
              {tab.count}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

export function Modal({
  title,
  children,
  onClose,
  footer,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose(): void;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="scrim" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`card relative z-10 w-full ${wide ? 'max-w-4xl' : 'max-w-lg'} max-h-[90vh] overflow-y-auto`}
      >
        <div className="panel-head">
          <h2 className="text-lg font-semibold text-ink-900">{title}</h2>
          <button
            className="text-ink-400 transition-colors hover:text-ink-900"
            onClick={onClose}
            aria-label="Close"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer ? (
          <div className="flex justify-end gap-2 border-t border-ink-100 px-5 py-3">{footer}</div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Destructive action guarded by a typed reason.
 *
 * Cancelling an invoice, deleting a statement or voiding a payroll batch all
 * need the same shape: explain the consequence, capture a reason for the
 * audit trail, and refuse to submit without one.
 */
export function ConfirmWithReason({
  title,
  description,
  actionLabel,
  requireReason = true,
  onClose,
  onConfirm,
  pending,
  error,
}: {
  title: string;
  description: ReactNode;
  actionLabel: string;
  requireReason?: boolean;
  onClose(): void;
  onConfirm(reason: string): void;
  pending?: boolean;
  error?: unknown;
}) {
  const [reason, setReason] = useState('');
  const tooShort = requireReason && reason.trim().length < 3;

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn-danger"
            disabled={tooShort || pending}
            onClick={() => onConfirm(reason.trim())}
          >
            {pending ? 'Working…' : actionLabel}
          </button>
        </>
      }
    >
      <div className="text-sm text-ink-600">{description}</div>
      <label className="label mt-4" htmlFor="confirm-reason">
        Reason{requireReason ? '' : ' (optional)'}
      </label>
      <textarea
        id="confirm-reason"
        className="input"
        rows={3}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        placeholder="Recorded in the audit trail"
      />
      {error ? (
        <div className="mt-3">
          <ErrorState error={error} compact />
        </div>
      ) : null}
    </Modal>
  );
}

/** Confidence chip used by the review and reconciliation screens. */
export function ConfidenceBadge({ value }: { value: number }) {
  const percent = value <= 1 ? Math.round(value * 100) : Math.round(value);
  const tone: Tone = percent >= 90 ? 'positive' : percent >= 75 ? 'attention' : 'negative';
  return (
    <span data-tone={tone} className={`${BADGE[tone]} rounded-md px-1.5`}>
      {percent}%
    </span>
  );
}
