import { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Money } from './ui';

/**
 * Global search — PRD §33.
 *
 * Debounced so typing an invoice number does not fire a request per keystroke.
 * The server decides what each result links to, so this component needs no
 * knowledge of the routing table.
 */
export function GlobalSearch() {
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(term.trim()), 250);
    return () => clearTimeout(timer);
  }, [term]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const { data, isFetching } = useQuery({
    queryKey: ['search', debounced],
    queryFn: () => api.dashboard.search(debounced),
    enabled: debounced.length >= 2,
  });

  return (
    <div
      ref={containerRef}
      className="relative order-last w-full min-w-0 max-w-xl sm:order-none sm:flex-1"
    >
      <Search
        className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400"
        aria-hidden="true"
      />
      <input
        className="input-search"
        placeholder="Search invoices, vendors, batches, employees…"
        value={term}
        onChange={(event) => {
          setTerm(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
      />

      {open && debounced.length >= 2 ? (
        <div className="menu absolute z-30 mt-1 max-h-96 w-full overflow-y-auto">
          {isFetching && !data ? (
            <p className="px-4 py-3 text-sm text-ink-500">Searching…</p>
          ) : !data?.items.length ? (
            <p className="px-4 py-3 text-sm text-ink-500">No matches for “{debounced}”.</p>
          ) : (
            data.items.map((item) => (
              <button
                key={`${item.type}-${item.id}`}
                className="flex w-full items-center justify-between gap-3 px-4 py-2 text-left hover:bg-ink-50"
                onClick={() => {
                  setOpen(false);
                  setTerm('');
                  navigate(item.link);
                }}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{item.title}</span>
                  <span className="block truncate text-xs text-ink-500">
                    {item.type.replace(/_/g, ' ').toLowerCase()}
                    {item.subtitle ? ` · ${item.subtitle}` : ''}
                  </span>
                </span>
                {item.amount !== undefined ? (
                  <Money minor={item.amount} compact className="text-sm text-ink-600" />
                ) : null}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
