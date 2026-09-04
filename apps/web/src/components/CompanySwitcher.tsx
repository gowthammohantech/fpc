import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Check, ChevronsUpDown, Search } from 'lucide-react';
import type { Company } from '@fpc/shared';

/** Beyond this many companies, scanning the list beats reading it. */
const SEARCHABLE_FROM = 6;

/** Two letters is all the tile has room for, and all it needs to be told apart. */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '—';
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[words.length - 1]![0]!).toUpperCase();
}

/** The line under the name: whatever identifies the entity, if anything does. */
function subtitle(company: Company): string | null {
  return company.gstin ?? company.legalName ?? null;
}

/**
 * Company switcher as a listbox rather than a native `<select>`.
 *
 * A native select paints its own popup from the OS, so the one list in the app
 * that scopes every screen was also the one control the design system could not
 * reach. This owns the popup: the same tiles, the same type, a tick on the
 * company in force, and a filter once the list outgrows a glance.
 */
export function CompanySwitcher({
  companies,
  value,
  onChange,
}: {
  companies: Company[];
  value: string | null;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selected = companies.find((company) => company.id === value) ?? null;
  const searchable = companies.length >= SEARCHABLE_FROM;

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return companies;
    return companies.filter((company) =>
      [company.name, company.legalName, company.gstin]
        .filter(Boolean)
        .some((field) => field!.toLowerCase().includes(needle)),
    );
  }, [companies, query]);

  // Opening lands on the company in force, so Enter is always a no-op escape.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setCursor(Math.max(0, companies.findIndex((company) => company.id === value)));
    const frame = requestAnimationFrame(() => {
      if (searchable) searchRef.current?.focus();
      else listRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [open, companies, value, searchable]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    return () => document.removeEventListener('mousedown', onPointer);
  }, [open]);

  // Arrowing past the fold has to bring the row with it.
  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${cursor}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [cursor, open]);

  const commit = (id: string) => {
    onChange(id);
    setOpen(false);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      setOpen(false);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (matches.length === 0) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setCursor((index) => (index + step + matches.length) % matches.length);
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      setCursor(event.key === 'Home' ? 0 : matches.length - 1);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const company = matches[cursor];
      if (company) commit(company.id);
    }
  };

  return (
    <div className="relative" ref={rootRef} onKeyDown={onKeyDown}>
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-xl border border-ink-200 bg-white p-2
                   text-left transition-colors hover:border-ink-300 hover:bg-ink-50"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={selected?.name ?? undefined}
      >
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-100 text-[11px] font-semibold text-brand-800">
          {initials(selected?.name ?? '')}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-400">
            Company
          </span>
          <span className="block truncate text-[13px] font-medium leading-tight text-ink-900">
            {selected?.name ?? 'Select a company'}
          </span>
        </span>
        <ChevronsUpDown className="h-4 w-4 shrink-0 text-ink-400" aria-hidden="true" />
      </button>

      {open ? (
        <div className="menu absolute bottom-full left-0 z-30 mb-2 w-[min(19rem,calc(100vw-1.5rem))] min-w-full py-0">
          {searchable ? (
            <div className="relative border-b border-ink-100 p-2">
              <Search
                className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400"
                aria-hidden="true"
              />
              <input
                ref={searchRef}
                className="input py-1.5 pl-8"
                placeholder="Find a company…"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setCursor(0);
                }}
                aria-label="Find a company"
              />
            </div>
          ) : null}

          <div
            ref={listRef}
            role="listbox"
            aria-label="Company"
            tabIndex={-1}
            className="max-h-64 overflow-y-auto py-1 focus:outline-none"
          >
            {matches.map((company, index) => {
              const active = company.id === value;
              const line = subtitle(company);
              return (
                <button
                  key={company.id}
                  type="button"
                  role="option"
                  aria-selected={active}
                  data-index={index}
                  className={`flex w-full items-center gap-2.5 px-2 py-1.5 text-left ${
                    index === cursor ? 'bg-ink-50' : ''
                  }`}
                  onMouseEnter={() => setCursor(index)}
                  onClick={() => commit(company.id)}
                >
                  <span
                    className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[11px] font-semibold ${
                      active ? 'bg-brand-700 text-white' : 'bg-ink-100 text-ink-600'
                    }`}
                  >
                    {initials(company.name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={`block truncate text-sm leading-tight ${
                        active ? 'font-semibold text-brand-800' : 'text-ink-900'
                      }`}
                    >
                      {company.name}
                    </span>
                    {line ? (
                      <span className="block truncate text-[11px] leading-tight text-ink-500">
                        {line}
                      </span>
                    ) : null}
                  </span>
                  {active ? (
                    <Check className="h-4 w-4 shrink-0 text-brand-700" aria-hidden="true" />
                  ) : null}
                </button>
              );
            })}

            {matches.length === 0 ? (
              <p className="px-3 py-4 text-center text-sm text-ink-500">No company matches.</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
