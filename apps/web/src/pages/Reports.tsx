import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, downloadBlob } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { formatDate, formatINR } from '@/lib/format';
import {
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  Spinner,
  StatusBadge,
  Table,
} from '@/components/ui';

/** Report runner — PRD §32. The catalogue and columns come from the server. */
export function ReportsPage() {
  const { companyId, can } = useAuth();
  const [selected, setSelected] = useState<string | null>(null);
  const [filters, setFilters] = useState<Record<string, string>>({});

  const { data: catalogue, isLoading } = useQuery({
    queryKey: ['reports'],
    queryFn: () => api.reports.catalogue(),
  });

  const report = catalogue?.items.find((entry) => entry.key === selected);

  const { data, isFetching, error } = useQuery({
    queryKey: ['report', selected, companyId, filters],
    queryFn: () => api.reports.run(selected!, { companyId, ...filters, limit: 500 }),
    enabled: !!selected,
  });

  const download = useMutation({
    mutationFn: async () => {
      const blob = await api.reports.download(selected!, { companyId, ...filters, limit: 50000 });
      downloadBlob(blob, `${selected}-${new Date().toISOString().slice(0, 10)}.xlsx`);
    },
  });

  if (isLoading) return <Spinner />;

  return (
    <>
      <PageHeader title="Reports" subtitle="Run a report, then export it to Excel" />

      <div className="grid gap-6 lg:grid-cols-4">
        <Card className="lg:col-span-1">
          <div className="border-b border-slate-200 px-4 py-3">
            <h2 className="font-semibold">Available reports</h2>
          </div>
          <ul className="divide-y divide-slate-100">
            {catalogue?.items.map((entry) => (
              <li key={entry.key}>
                <button
                  className={`w-full px-4 py-3 text-left transition hover:bg-slate-50 ${
                    selected === entry.key ? 'bg-brand-50' : ''
                  }`}
                  onClick={() => {
                    setSelected(entry.key);
                    setFilters({});
                  }}
                >
                  <span className="block text-sm font-medium">{entry.name}</span>
                  <span className="mt-0.5 block text-xs text-slate-500">{entry.description}</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>

        <div className="lg:col-span-3">
          {!report ? (
            <Card>
              <EmptyState title="Choose a report" hint="Pick one from the list to run it." />
            </Card>
          ) : (
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-3">
                <div>
                  <h2 className="font-semibold">{report.name}</h2>
                  <p className="text-sm text-slate-500">
                    {data
                      ? `${data.rowCount} rows${data.truncated ? ' (truncated)' : ''}`
                      : 'Running…'}
                  </p>
                </div>
                {can('report:export') ? (
                  <button
                    className="btn-secondary"
                    disabled={download.isPending || !data?.rowCount}
                    onClick={() => download.mutate()}
                  >
                    {download.isPending ? 'Preparing…' : 'Export to Excel'}
                  </button>
                ) : null}
              </div>

              {report.filters.includes('dateRange') ? (
                <div className="flex flex-wrap gap-3 border-b border-slate-200 px-5 py-3">
                  <div>
                    <label className="label" htmlFor="from">
                      From
                    </label>
                    <input
                      id="from"
                      type="date"
                      className="input"
                      value={filters.dateFrom ?? ''}
                      onChange={(event) => setFilters({ ...filters, dateFrom: event.target.value })}
                    />
                  </div>
                  <div>
                    <label className="label" htmlFor="to">
                      To
                    </label>
                    <input
                      id="to"
                      type="date"
                      className="input"
                      value={filters.dateTo ?? ''}
                      onChange={(event) => setFilters({ ...filters, dateTo: event.target.value })}
                    />
                  </div>
                </div>
              ) : null}

              {isFetching ? (
                <Spinner />
              ) : error ? (
                <div className="p-4">
                  <ErrorState error={error} />
                </div>
              ) : !data?.rows.length ? (
                <EmptyState title="No rows for these filters" />
              ) : (
                <Table>
                  <thead className="bg-slate-50">
                    <tr>
                      {data.columns.map((column) => (
                        <th
                          key={column.key}
                          className={`th ${column.format === 'money' || column.format === 'number' ? 'text-right' : ''}`}
                        >
                          {column.header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {data.rows.map((row, index) => (
                      <tr key={String(row.id ?? index)} className="hover:bg-slate-50">
                        {data.columns.map((column) => (
                          <td
                            key={column.key}
                            className={`td ${column.format === 'money' || column.format === 'number' ? 'text-right tabular' : ''}`}
                          >
                            {renderCell(row[column.key], column.format)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function renderCell(value: unknown, format?: string) {
  if (value === null || value === undefined || value === '')
    return <span className="text-slate-300">—</span>;
  if (format === 'money') return formatINR(Number(value));
  if (format === 'date') return formatDate(String(value));
  if (format === 'status') return <StatusBadge status={String(value)} />;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
