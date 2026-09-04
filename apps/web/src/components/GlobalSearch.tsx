import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { CornerDownLeft, Search, type LucideIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { NAV_GROUPS } from '@/lib/navigation';
import { useAuth } from '@/hooks/useAuth';
import { Money } from './ui';

/** One selectable row, whatever section it came from. */
interface Command {
  key: string;
  label: string;
  hint: string;
  link: string;
  icon?: LucideIcon;
  amount?: number;
}

const IS_MAC =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.userAgent ?? '');

/** The shortcut as the keyboard in front of the user actually spells it. */
const SHORTCUT = IS_MAC ? '⌘K' : 'Ctrl K';

/**
 * Global search — PRD §33 — as a command palette.
 *
 * The header carries only the trigger; the palette itself is a modal, so the
 * same ⌘K/Ctrl-K opens it from any page without the header holding focus.
 */
export function GlobalSearch() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'k') return;
      // Without this the browser's own ⌘K would take the address bar instead.
      event.preventDefault();
      setOpen((value) => !value);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <button
        type="button"
        className="input-search relative flex items-center gap-2 pr-2 text-left text-ink-400 hover:border-ink-300"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-keyshortcuts="Meta+K Control+K"
      >
        <Search
          className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400"
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1 truncate">Search or jump to…</span>
        <kbd className="kbd hidden sm:inline-flex">{SHORTCUT}</kbd>
      </button>

      {open ? <CommandPalette onClose={() => setOpen(false)} /> : null}
    </>
  );
}

/**
 * The palette proper.
 *
 * Pages come from the navigation table, filtered by the same permissions the
 * sidebar uses; records come from the server, which decides what each result
 * links to, so this component needs no knowledge of the routing table.
 */
function CommandPalette({ onClose }: { onClose(): void }) {
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { canAny } = useAuth();

  // Debounced so typing an invoice number does not fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(term.trim()), 250);
    return () => clearTimeout(timer);
  }, [term]);

  const { data, isFetching } = useQuery({
    queryKey: ['search', debounced],
    queryFn: () => api.dashboard.search(debounced),
    enabled: debounced.length >= 2,
  });

  const pages = useMemo<Command[]>(() => {
    const needle = term.trim().toLowerCase();
    return NAV_GROUPS.flatMap((group) =>
      group.items
        .filter((item) => canAny(...item.permissions))
        .filter(
          (item) =>
            !needle ||
            item.label.toLowerCase().includes(needle) ||
            (group.title ?? '').toLowerCase().includes(needle),
        )
        .map((item) => ({
          key: `page-${item.to}`,
          label: item.label,
          hint: group.title ?? 'Overview',
          link: item.to,
          icon: item.icon,
        })),
    );
  }, [term, canAny]);

  const records = useMemo<Command[]>(
    () =>
      (data?.items ?? []).map((item) => ({
        key: `${item.type}-${item.id}`,
        label: item.title,
        hint: `${item.type.replace(/_/g, ' ').toLowerCase()}${
          item.subtitle ? ` · ${item.subtitle}` : ''
        }`,
        link: item.link,
        amount: item.amount,
      })),
    [data],
  );

  // One flat list, so the arrow keys run straight through both sections.
  const commands = useMemo(() => [...pages, ...records], [pages, records]);

  // Any change to the list invalidates the old position.
  useEffect(() => {
    setActive(0);
  }, [commands]);

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const run = (command: Command | undefined) => {
    if (!command) return;
    onClose();
    navigate(command.link);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((index) => (commands.length ? (index + 1) % commands.length : 0));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => (commands.length ? (index - 1 + commands.length) % commands.length : 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      run(commands[active]);
    }
  };

  const searching = debounced.length >= 2 && isFetching && !data;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[12vh]">
      <div className="scrim" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="card relative z-10 flex w-full max-w-xl flex-col overflow-hidden"
        onKeyDown={onKeyDown}
      >
        <div className="relative border-b border-ink-100">
          <Search
            className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400"
            aria-hidden="true"
          />
          <input
            autoFocus
            className="w-full bg-transparent py-3.5 pl-11 pr-4 text-sm text-ink-900 placeholder:text-ink-400 focus:outline-none"
            placeholder="Search invoices, vendors, batches, employees — or jump to a page…"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            role="combobox"
            aria-expanded
            aria-controls="command-palette-list"
            aria-activedescendant={commands.length ? `command-palette-${active}` : undefined}
            aria-autocomplete="list"
          />
        </div>

        <div
          id="command-palette-list"
          ref={listRef}
          role="listbox"
          aria-label="Results"
          className="max-h-[22rem] overflow-y-auto py-1"
        >
          {pages.length ? (
            <Section title="Pages">
              {pages.map((command, index) => (
                <Row
                  key={command.key}
                  command={command}
                  index={index}
                  active={active === index}
                  onHover={setActive}
                  onSelect={run}
                />
              ))}
            </Section>
          ) : null}

          {records.length ? (
            <Section title="Records">
              {records.map((command, index) => (
                <Row
                  key={command.key}
                  command={command}
                  index={pages.length + index}
                  active={active === pages.length + index}
                  onHover={setActive}
                  onSelect={run}
                />
              ))}
            </Section>
          ) : null}

          {searching ? <p className="px-4 py-3 text-sm text-ink-500">Searching…</p> : null}

          {!commands.length && !searching ? (
            <p className="px-4 py-3 text-sm text-ink-500">
              {debounced.length >= 2
                ? `No matches for “${debounced}”.`
                : 'Type at least two characters to search records.'}
            </p>
          ) : null}
        </div>

        <div className="flex items-center gap-4 border-t border-ink-100 bg-ink-50 px-4 py-2 text-[11px] text-ink-500">
          <span className="flex items-center gap-1">
            <kbd className="kbd">↑</kbd>
            <kbd className="kbd">↓</kbd>
            to navigate
          </span>
          <span className="flex items-center gap-1">
            <kbd className="kbd">
              <CornerDownLeft className="h-3 w-3" aria-hidden="true" />
            </kbd>
            to open
          </span>
          <span className="flex items-center gap-1">
            <kbd className="kbd">Esc</kbd>
            to close
          </span>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="pb-1">
      <p className="px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-400">
        {title}
      </p>
      {children}
    </div>
  );
}

function Row({
  command,
  index,
  active,
  onHover,
  onSelect,
}: {
  command: Command;
  index: number;
  active: boolean;
  onHover(index: number): void;
  onSelect(command: Command): void;
}) {
  const Icon = command.icon;

  return (
    <button
      type="button"
      id={`command-palette-${index}`}
      data-index={index}
      role="option"
      aria-selected={active}
      className={`flex w-full items-center gap-3 px-4 py-2 text-left ${active ? 'bg-brand-50' : ''}`}
      onMouseMove={() => onHover(index)}
      onClick={() => onSelect(command)}
    >
      {Icon ? <Icon className="h-4 w-4 shrink-0 text-ink-400" aria-hidden="true" /> : null}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-ink-900">{command.label}</span>
        <span className="block truncate text-xs text-ink-500">{command.hint}</span>
      </span>
      {command.amount !== undefined ? (
        <Money minor={command.amount} compact className="text-sm text-ink-600" />
      ) : null}
    </button>
  );
}
