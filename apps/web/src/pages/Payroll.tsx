import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PayrollPreview } from '@fpc/api-client';
import { api } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { formatCompactINR, formatDate, humanize } from '@/lib/format';
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
} from '@/components/ui';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Payroll batches — PRD §36 `/payroll`. */
export function PayrollPage() {
  const { companyId, can } = useAuth();
  const [page, setPage] = useState(1);

  const { data, isLoading, error } = useQuery({
    queryKey: ['payroll', companyId, page],
    queryFn: () => api.payroll.list({ companyId, page, pageSize: 25 }),
  });

  return (
    <>
      <PageHeader
        title="Payroll"
        subtitle="Finalised payroll received from HR"
        actions={
          can('payroll:create') ? (
            <Link className="btn-primary" to="/payroll/import">Import payroll</Link>
          ) : null
        }
      />

      <div className="card">
        {isLoading ? (
          <Spinner />
        ) : error ? (
          <div className="p-4"><ErrorState error={error} /></div>
        ) : !data?.items.length ? (
          <EmptyState title="No payroll batches yet" hint="Import a finalised payroll file to begin." />
        ) : (
          <>
            <Table>
              <thead className="bg-slate-50">
                <tr>
                  <th className="th">Period</th>
                  <th className="th text-right">Employees</th>
                  <th className="th text-right">Net payroll</th>
                  <th className="th text-right">vs previous</th>
                  <th className="th">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {data.items.map((batch) => {
                  const difference =
                    batch.previousTotalNetAmount !== undefined && batch.previousTotalNetAmount !== null
                      ? batch.totalNetAmount - batch.previousTotalNetAmount
                      : null;
                  return (
                    <tr key={batch.id} className="hover:bg-slate-50">
                      <td className="td">
                        <Link className="font-medium text-brand-700" to={`/payroll/${batch.id}`}>
                          {batch.label}
                        </Link>
                      </td>
                      <td className="td text-right tabular">
                        {batch.employeeCount.toLocaleString('en-IN')}
                      </td>
                      <td className="td text-right"><Money minor={batch.totalNetAmount} /></td>
                      <td className="td text-right tabular">
                        {difference === null ? (
                          <span className="text-slate-400">—</span>
                        ) : (
                          <span className={difference >= 0 ? 'text-amber-700' : 'text-emerald-700'}>
                            {difference >= 0 ? '+' : '−'}
                            {formatCompactINR(Math.abs(difference))}
                          </span>
                        )}
                      </td>
                      <td className="td"><StatusBadge status={batch.status} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} />
          </>
        )}
      </div>
    </>
  );
}

/**
 * Payroll import — PRD §17, §36 `/payroll/import`.
 *
 * Two steps by design: the file is previewed and validated before anything is
 * written, so a mis-detected column is caught before hundreds of payment
 * instructions exist.
 */
export function PayrollImportPage() {
  const { companyId } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const now = new Date();

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PayrollPreview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [periodMonth, setPeriodMonth] = useState(now.getMonth() + 1);
  const [periodYear, setPeriodYear] = useState(now.getFullYear());

  const runPreview = useMutation({
    mutationFn: () => api.payroll.preview(file!, Object.keys(mapping).length ? mapping : undefined, file!.name),
    onSuccess: (result) => {
      setPreview(result);
      setMapping(result.mapping);
    },
  });

  const commit = useMutation({
    mutationFn: () =>
      api.payroll.import({
        file: file!,
        fileName: file!.name,
        companyId: companyId!,
        label: `${MONTHS[periodMonth - 1]} ${periodYear} Payroll`,
        periodMonth,
        periodYear,
        mapping,
      }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['payroll'] });
      navigate(`/payroll/${result.batch.id}`);
    },
  });

  return (
    <>
      <PageHeader title="Import payroll" subtitle="Upload a finalised payroll file from HR" />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-1">
          <h2 className="font-semibold">1. Choose file</h2>
          <p className="mt-1 text-sm text-slate-500">Excel or CSV, one row per employee.</p>

          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            className="input mt-4"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setPreview(null);
              setMapping({});
            }}
          />

          <div className="mt-4 grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="month">Month</label>
              <select
                id="month"
                className="input"
                value={periodMonth}
                onChange={(event) => setPeriodMonth(Number(event.target.value))}
              >
                {MONTHS.map((name, index) => (
                  <option key={name} value={index + 1}>{name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="year">Year</label>
              <input
                id="year"
                type="number"
                className="input"
                value={periodYear}
                onChange={(event) => setPeriodYear(Number(event.target.value))}
              />
            </div>
          </div>

          <button
            className="btn-primary mt-4 w-full"
            disabled={!file || runPreview.isPending}
            onClick={() => runPreview.mutate()}
          >
            {runPreview.isPending ? 'Reading…' : 'Validate file'}
          </button>

          {runPreview.error ? <div className="mt-3"><ErrorState error={runPreview.error} /></div> : null}
        </Card>

        <div className="lg:col-span-2">
          {!preview ? (
            <Card>
              <EmptyState
                title="Nothing to review yet"
                hint="Choose a payroll file and validate it to see the detected columns and totals."
              />
            </Card>
          ) : (
            <div className="space-y-6">
              <Card className="p-5">
                <h2 className="font-semibold">2. Check the totals</h2>
                <div className="mt-4 grid gap-4 sm:grid-cols-3">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-slate-500">Employees</p>
                    <p className="mt-1 text-2xl font-semibold tabular">
                      {preview.employeeCount.toLocaleString('en-IN')}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-slate-500">Net payroll</p>
                    <p className="mt-1 text-2xl font-semibold tabular">
                      <Money minor={preview.totalNetAmount} />
                    </p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-slate-500">Rows with errors</p>
                    <p
                      className={`mt-1 text-2xl font-semibold tabular ${
                        preview.rowsWithErrors > 0 ? 'text-red-700' : 'text-emerald-700'
                      }`}
                    >
                      {preview.rowsWithErrors}
                    </p>
                  </div>
                </div>

                {preview.locationBreakdown.length ? (
                  <div className="mt-5">
                    <p className="mb-2 text-xs uppercase tracking-wide text-slate-500">By location</p>
                    <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
                      {preview.locationBreakdown.map((entry) => (
                        <li key={entry.locationName} className="flex justify-between px-3 py-2 text-sm">
                          <span>{entry.locationName}</span>
                          <span className="tabular text-slate-600">
                            {entry.count} · {formatCompactINR(entry.amount)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {preview.findings.map((finding) => (
                  <div
                    key={finding.code + (finding.field ?? '')}
                    className={`mt-3 rounded-md border px-3 py-2 text-sm ${
                      finding.severity === 'ERROR'
                        ? 'border-red-200 bg-red-50 text-red-800'
                        : 'border-amber-200 bg-amber-50 text-amber-900'
                    }`}
                  >
                    {finding.message}
                  </div>
                ))}

                {preview.rejected.length ? (
                  <details className="mt-3 text-sm">
                    <summary className="cursor-pointer text-slate-600">
                      {preview.rejected.length} rows skipped
                    </summary>
                    <ul className="mt-2 space-y-1 text-slate-500">
                      {preview.rejected.map((entry) => (
                        <li key={entry.rowNumber}>Row {entry.rowNumber}: {entry.reason}</li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </Card>

              <Card>
                <div className="border-b border-slate-200 px-5 py-3">
                  <h2 className="font-semibold">Detected columns</h2>
                  <p className="text-sm text-slate-500">
                    Change any mapping that was read incorrectly, then validate again.
                  </p>
                </div>
                <div className="grid gap-4 p-5 sm:grid-cols-2">
                  {(['employeeCode', 'employeeName', 'bankAccountNumber', 'ifsc', 'netAmount', 'department', 'location', 'email'] as const).map(
                    (field) => (
                      <div key={field}>
                        <label className="label">{humanize(field)}</label>
                        <select
                          className="input"
                          value={mapping[field] ?? ''}
                          onChange={(event) => setMapping({ ...mapping, [field]: event.target.value })}
                        >
                          <option value="">Not mapped</option>
                          {preview.headers.map((header) => (
                            <option key={header} value={header}>{header}</option>
                          ))}
                        </select>
                      </div>
                    ),
                  )}
                </div>
                <div className="border-t border-slate-200 px-5 py-3">
                  <button
                    className="btn-secondary"
                    disabled={runPreview.isPending}
                    onClick={() => runPreview.mutate()}
                  >
                    Re-validate with these columns
                  </button>
                </div>
              </Card>

              <Card>
                <div className="border-b border-slate-200 px-5 py-3">
                  <h2 className="font-semibold">Sample rows</h2>
                </div>
                <Table>
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="th">Row</th>
                      <th className="th">Employee</th>
                      <th className="th">Account</th>
                      <th className="th">IFSC</th>
                      <th className="th text-right">Net</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {preview.sample.map((row) => (
                      <tr key={String(row.rowNumber)}>
                        <td className="td text-slate-400">{String(row.rowNumber)}</td>
                        <td className="td">
                          {String(row.employeeName)}
                          <span className="ml-2 text-xs text-slate-500">{String(row.employeeCode)}</span>
                        </td>
                        <td className="td font-mono text-xs">{String(row.bankAccountNumber)}</td>
                        <td className="td font-mono text-xs">{String(row.ifsc)}</td>
                        <td className="td text-right"><Money minor={Number(row.netAmount)} /></td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </Card>

              <div className="flex items-center gap-3">
                <button
                  className="btn-primary"
                  disabled={preview.rowsWithErrors > 0 || commit.isPending || !companyId}
                  title={preview.rowsWithErrors > 0 ? 'Fix the errors in the source file first' : undefined}
                  onClick={() => commit.mutate()}
                >
                  {commit.isPending ? 'Importing…' : `Import ${preview.employeeCount} employees`}
                </button>
                {preview.rowsWithErrors > 0 ? (
                  <span className="text-sm text-red-700">
                    Fix the {preview.rowsWithErrors} rows with errors and upload again.
                  </span>
                ) : null}
              </div>
              {commit.error ? <ErrorState error={commit.error} /> : null}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/** Payroll batch detail — PRD §18, §19. */
export function PayrollDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const [page, setPage] = useState(1);
  const [cancelling, setCancelling] = useState(false);

  const { data: batch, isLoading, error } = useQuery({
    queryKey: ['payroll-batch', id],
    queryFn: () => api.payroll.get(id),
  });

  const { data: employees } = useQuery({
    queryKey: ['payroll-employees', id, page],
    queryFn: () => api.payroll.employees(id, { page, pageSize: 50 }),
  });

  const submit = useMutation({
    mutationFn: () => api.payroll.submit(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['payroll-batch', id] });
      void queryClient.invalidateQueries({ queryKey: ['payroll'] });
    },
  });

  const cancel = useMutation({
    mutationFn: () => api.payroll.cancel(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['payroll'] });
      navigate('/payroll');
    },
  });

  if (isLoading) return <Spinner />;
  if (error) return <ErrorState error={error} />;
  if (!batch) return null;

  const submittable = ['VALIDATED', 'IMPORTED', 'REVIEW_REQUIRED'].includes(batch.status);
  // Once obligations exist the money is in flight; the server refuses too.
  const cancellable = [
    'DRAFT', 'IMPORTED', 'REVIEW_REQUIRED', 'VALIDATED', 'PENDING_APPROVAL', 'REJECTED',
  ].includes(batch.status);

  return (
    <>
      <PageHeader
        title={batch.label}
        subtitle={
          <span className="flex flex-wrap items-center gap-3">
            <StatusBadge status={batch.status} />
            <span className="font-mono text-xs">{batch.reference}</span>
            {batch.sourceFileName ? <span>· {batch.sourceFileName}</span> : null}
          </span>
        }
        actions={
          <>
            {cancellable && can('payroll:delete') ? (
              <button className="btn-secondary" onClick={() => setCancelling(true)}>
                Cancel batch
              </button>
            ) : null}
            {submittable && can('payroll:submit') ? (
              <button className="btn-primary" disabled={submit.isPending} onClick={() => submit.mutate()}>
                {submit.isPending ? 'Submitting…' : 'Submit for approval'}
              </button>
            ) : null}
          </>
        }
      />

      {cancelling ? (
        <ConfirmWithReason
          title="Cancel this payroll batch"
          actionLabel="Cancel batch"
          requireReason={false}
          description={
            <>
              <p>
                {batch.label} and its {batch.employeeCount.toLocaleString('en-IN')} employee rows
                will be cancelled, and any approval in progress withdrawn.
              </p>
              <p className="mt-2">
                Re-import the corrected payroll file afterwards to replace it.
              </p>
            </>
          }
          pending={cancel.isPending}
          error={cancel.error}
          onClose={() => setCancelling(false)}
          onConfirm={() => cancel.mutate()}
        />
      ) : null}

      {submit.error ? <div className="mb-4"><ErrorState error={submit.error} /></div> : null}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Employees</p>
          <p className="mt-1 text-2xl font-semibold tabular">
            {batch.employeeCount.toLocaleString('en-IN')}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Total net payroll</p>
          <p className="mt-1 text-2xl font-semibold tabular"><Money minor={batch.totalNetAmount} /></p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Previous month</p>
          <p className="mt-1 text-2xl font-semibold tabular text-slate-600">
            {batch.comparison.previousTotalNetAmount !== null ? (
              <Money minor={batch.comparison.previousTotalNetAmount} />
            ) : (
              '—'
            )}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Difference</p>
          {batch.comparison.difference !== null ? (
            <>
              <p
                className={`mt-1 text-2xl font-semibold tabular ${
                  batch.comparison.difference >= 0 ? 'text-amber-700' : 'text-emerald-700'
                }`}
              >
                {batch.comparison.difference >= 0 ? '+' : '−'}
                {formatCompactINR(Math.abs(batch.comparison.difference))}
              </p>
              <p className="text-xs text-slate-500">{batch.comparison.percentChange}% change</p>
            </>
          ) : (
            <p className="mt-1 text-2xl font-semibold text-slate-400">—</p>
          )}
        </Card>
      </div>

      {batch.locationBreakdown?.length ? (
        <Card className="mb-6">
          <div className="border-b border-slate-200 px-5 py-3">
            <h2 className="font-semibold">By location</h2>
          </div>
          <ul className="divide-y divide-slate-100">
            {batch.locationBreakdown.map((entry) => (
              <li key={entry.locationName} className="flex justify-between px-5 py-3 text-sm">
                <span>{entry.locationName}</span>
                <span className="tabular text-slate-600">
                  {entry.count.toLocaleString('en-IN')} employees · <Money minor={entry.amount} />
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card>
        <div className="border-b border-slate-200 px-5 py-3">
          <h2 className="font-semibold">Employees</h2>
        </div>
        {!employees?.items.length ? (
          <EmptyState title="No employee rows" />
        ) : (
          <>
            <Table>
              <thead className="bg-slate-50">
                <tr>
                  <th className="th">Employee</th>
                  <th className="th">Account</th>
                  <th className="th">IFSC</th>
                  <th className="th">Location</th>
                  <th className="th text-right">Net salary</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {employees.items.map((employee) => (
                  <tr key={employee.id}>
                    <td className="td">
                      {employee.employeeName}
                      <span className="ml-2 text-xs text-slate-500">{employee.employeeCode}</span>
                      {employee.findings?.length ? (
                        <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-800">
                          {employee.findings[0]!.message}
                        </span>
                      ) : null}
                    </td>
                    <td className="td font-mono text-xs">{employee.bankAccountNumber}</td>
                    <td className="td font-mono text-xs">{employee.ifsc}</td>
                    <td className="td">{employee.locationName ?? '—'}</td>
                    <td className="td text-right"><Money minor={employee.netAmount} /></td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination
              page={employees.page}
              pageSize={employees.pageSize}
              total={employees.total}
              onChange={setPage}
            />
          </>
        )}
      </Card>
    </>
  );
}
