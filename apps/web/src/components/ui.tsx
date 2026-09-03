import type { ReactNode } from 'react';
import { formatCompactINR, formatINR } from '@/lib/format';
import { humanize } from '@/lib/format';

/** Coloured status pill. Colour is derived from meaning, not from a lookup. */
export function StatusBadge({ status }: { status: string | null | undefined }) {
  if (!status) return <span className="text-slate-400">—</span>;
  const tone = toneFor(status);
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}
    >
      {humanize(status)}
    </span>
  );
}

function toneFor(status: string): string {
  const value = status.toUpperCase();
  if (['PAID', 'RECONCILED', 'APPROVED', 'MATCHED', 'ACTIVE', 'COMPLETED', 'SENT'].includes(value)) {
    return 'bg-emerald-100 text-emerald-800';
  }
  if (['REJECTED', 'FAILED', 'CANCELLED', 'BLOCKED', 'DUPLICATE', 'SUSPENDED'].includes(value)) {
    return 'bg-red-100 text-red-800';
  }
  if (['PENDING_APPROVAL', 'REVIEW_REQUIRED', 'SUGGESTED', 'IN_PROGRESS', 'PENDING'].includes(value)) {
    return 'bg-amber-100 text-amber-800';
  }
  if (['PAYMENT_PROCESSING', 'PROCESSING', 'EXPORTED', 'BATCHED', 'PARTIALLY_RECONCILED'].includes(value)) {
    return 'bg-blue-100 text-blue-800';
  }
  if (['UNMATCHED', 'IGNORED', 'DRAFT'].includes(value)) return 'bg-slate-100 text-slate-700';
  return 'bg-slate-100 text-slate-700';
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
  if (minor === null || minor === undefined) return <span className="text-slate-400">—</span>;
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
        <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-slate-500">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`card ${className}`}>{children}</div>;
}

export function StatCard({
  label,
  value,
  sub,
  tone = 'default',
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: 'default' | 'warning' | 'danger' | 'success';
}) {
  const accent = {
    default: 'text-slate-900',
    warning: 'text-amber-700',
    danger: 'text-red-700',
    success: 'text-emerald-700',
  }[tone];

  return (
    <div className="card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-2 text-2xl font-semibold ${accent}`}>{value}</p>
      {sub ? <p className="mt-1 text-xs text-slate-500">{sub}</p> : null}
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="px-4 py-16 text-center">
      <p className="text-sm font-medium text-slate-600">{title}</p>
      {hint ? <p className="mt-1 text-sm text-slate-400">{hint}</p> : null}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-12 text-sm text-slate-500">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600" />
      {label ?? 'Loading…'}
    </div>
  );
}

/**
 * Error display. A 403 is shown as a permission message rather than a failure,
 * because it is an expected outcome of the role model, not a bug.
 */
export function ErrorState({ error }: { error: unknown }) {
  const apiError = error as { status?: number; message?: string; isForbidden?: boolean };
  if (apiError?.status === 403) {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        You do not have permission to view this. Contact your administrator if you need access.
      </div>
    );
  }
  return (
    <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
      {apiError?.message ?? 'Something went wrong.'}
    </div>
  );
}

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-200">{children}</table>
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
    <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-sm text-slate-600">
      <span>
        {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total.toLocaleString('en-IN')}
      </span>
      <div className="flex gap-2">
        <button className="btn-secondary" disabled={page <= 1} onClick={() => onChange(page - 1)}>
          Previous
        </button>
        <button
          className="btn-secondary"
          disabled={page >= totalPages}
          onClick={() => onChange(page + 1)}
        >
          Next
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
    <div className="flex flex-wrap gap-1 border-b border-slate-200">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          onClick={() => onChange(tab.key)}
          className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition ${
            active === tab.key
              ? 'border-brand-600 text-brand-700'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          {tab.label}
          {tab.count !== undefined ? (
            <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
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
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className={`card w-full ${wide ? 'max-w-4xl' : 'max-w-lg'} max-h-[90vh] overflow-y-auto`}>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button className="text-slate-400 hover:text-slate-700" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer ? (
          <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">{footer}</div>
        ) : null}
      </div>
    </div>
  );
}

/** Confidence chip used by the review and reconciliation screens. */
export function ConfidenceBadge({ value }: { value: number }) {
  const percent = value <= 1 ? Math.round(value * 100) : Math.round(value);
  const tone =
    percent >= 90 ? 'bg-emerald-100 text-emerald-800'
    : percent >= 75 ? 'bg-amber-100 text-amber-800'
    : 'bg-red-100 text-red-800';
  return <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${tone}`}>{percent}%</span>;
}
