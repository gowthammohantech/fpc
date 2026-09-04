import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { StatementImportResult } from '@fpc/api-client';
import { api } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { formatDate, formatDateTime } from '@/lib/format';
import {
  ConfirmWithReason,
  EmptyState,
  ErrorState,
  FileField,
  Modal,
  Money,
  PageHeader,
  Pagination,
  Spinner,
  StatusBadge,
  Table,
} from '@/components/ui';

/** Column headings a statement may use, for the manual override below. */
const STATEMENT_FIELDS = [
  { name: 'transactionDate', label: 'Transaction date', placeholder: 'e.g. Txn Date' },
  { name: 'description', label: 'Narration', placeholder: 'e.g. Particulars' },
  { name: 'reference', label: 'Reference', placeholder: 'e.g. Chq/Ref No' },
  { name: 'debit', label: 'Debit', placeholder: 'e.g. Withdrawal' },
  { name: 'credit', label: 'Credit', placeholder: 'e.g. Deposit' },
  { name: 'balance', label: 'Balance', placeholder: 'e.g. Closing Balance' },
];

/** Bank statements — PRD §24, §36 `/banking/statements`. */
export function BankStatementsPage() {
  const { companyId, can } = useAuth();
  const [page, setPage] = useState(1);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [deleting, setDeleting] = useState<{ id: string; fileName: string } | null>(null);
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['statements', companyId, page],
    queryFn: () => api.banking.statements({ companyId, page, pageSize: 25 }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.banking.deleteStatement(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['statements'] });
      void queryClient.invalidateQueries({ queryKey: ['reconciliation'] });
      setDeleting(null);
    },
  });

  return (
    <>
      <PageHeader
        title="Bank Statements"
        subtitle="Imported statements and what they contained"
        actions={
          can('bank_statement:create') ? (
            <button className="btn-primary" onClick={() => setUploadOpen(true)}>
              Upload statement
            </button>
          ) : null
        }
      />

      <div className="card">
        {isLoading ? (
          <Spinner />
        ) : error ? (
          <div className="p-4">
            <ErrorState error={error} />
          </div>
        ) : !data?.items.length ? (
          <EmptyState
            illustration="bank"
            title="No statements imported"
            hint="Download a statement from your bank portal and upload it here to reconcile payments."
          />
        ) : (
          <>
            <Table>
              <thead className="thead">
                <tr>
                  <th className="th">File</th>
                  <th className="th">Period</th>
                  <th className="th text-right">Transactions</th>
                  <th className="th text-right">Debits</th>
                  <th className="th text-right">Credits</th>
                  <th className="th text-right">Closing balance</th>
                  <th className="th">Status</th>
                  <th className="th">Uploaded</th>
                  <th className="th" />
                </tr>
              </thead>
              <tbody className="tbody">
                {data.items.map((statement) => (
                  <tr key={statement.id} className="hover:bg-slate-50">
                    <td className="td font-medium">{statement.fileName}</td>
                    <td className="td">
                      {statement.periodStart ? (
                        <>
                          {formatDate(statement.periodStart)} – {formatDate(statement.periodEnd)}
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="td text-right tabular">
                      {statement.transactionCount}
                      {statement.duplicateCount > 0 ? (
                        <span className="ml-2 text-xs text-slate-500">
                          +{statement.duplicateCount} already held
                        </span>
                      ) : null}
                    </td>
                    <td className="td text-right">
                      <Money minor={statement.totalDebit} compact />
                    </td>
                    <td className="td text-right">
                      <Money minor={statement.totalCredit} compact />
                    </td>
                    <td className="td text-right">
                      <Money minor={statement.closingBalance} compact />
                    </td>
                    <td className="td">
                      <StatusBadge status={statement.status} />
                    </td>
                    <td className="td text-xs text-slate-500">
                      {formatDateTime(statement.createdAt)}
                    </td>
                    <td className="td text-right">
                      {can('bank_statement:delete') ? (
                        <button
                          className="text-sm text-red-600"
                          onClick={() =>
                            setDeleting({ id: statement.id, fileName: statement.fileName })
                          }
                        >
                          Delete
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination
              page={data.page}
              pageSize={data.pageSize}
              total={data.total}
              onChange={setPage}
            />
          </>
        )}
      </div>

      {uploadOpen ? <UploadStatementModal onClose={() => setUploadOpen(false)} /> : null}

      {deleting ? (
        <ConfirmWithReason
          title="Delete this statement"
          actionLabel="Delete statement"
          requireReason={false}
          description={
            <>
              <p>
                {deleting.fileName} and its imported transactions will be removed. The statement can
                be uploaded again afterwards.
              </p>
              <p className="mt-2">
                Transactions that already settled a payment cannot be deleted — reverse those
                matches first.
              </p>
            </>
          }
          pending={remove.isPending}
          error={remove.error}
          onClose={() => setDeleting(null)}
          onConfirm={() => remove.mutate(deleting.id)}
        />
      ) : null}
    </>
  );
}

function UploadStatementModal({ onClose }: { onClose(): void }) {
  const { companyId } = useAuth();
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [bankAccountId, setBankAccountId] = useState('');
  const [result, setResult] = useState<StatementImportResult | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [showMapping, setShowMapping] = useState(false);

  const { data: accounts } = useQuery({
    queryKey: ['bank-accounts', companyId],
    queryFn: () => api.settings.bankAccounts({ companyId, pageSize: 50 }),
  });

  const upload = useMutation({
    mutationFn: () =>
      api.banking.uploadStatement({
        file: file!,
        fileName: file!.name,
        companyId: companyId!,
        bankAccountId,
        mapping: Object.keys(mapping).length ? mapping : undefined,
      }),
    onSuccess: (imported) => {
      setResult(imported);
      void queryClient.invalidateQueries({ queryKey: ['statements'] });
      void queryClient.invalidateQueries({ queryKey: ['reconciliation'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  if (result) {
    return (
      <Modal
        title="Statement imported"
        onClose={onClose}
        footer={
          <button className="btn-primary" onClick={onClose}>
            Done
          </button>
        }
      >
        <ul className="space-y-2 text-sm">
          <li>
            <span className="font-medium">{result.imported}</span> new transactions imported
          </li>
          {result.duplicates > 0 ? (
            <li>
              <span className="font-medium">{result.duplicates}</span> rows were already held and
              were skipped
            </li>
          ) : null}
          <li>
            <span className="font-medium">{result.suggested}</span> payments matched automatically
            and are waiting for your confirmation
          </li>
          <li>
            <span className="font-medium">{result.unmatched}</span> debits need manual
            reconciliation
          </li>
        </ul>
        {result.skipped.length ? (
          <details className="mt-4 text-sm">
            <summary className="cursor-pointer text-slate-600">
              {result.skipped.length} rows skipped
            </summary>
            <ul className="mt-2 space-y-1 text-slate-500">
              {result.skipped.map((entry) => (
                <li key={entry.rowNumber}>
                  Row {entry.rowNumber}: {entry.reason}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </Modal>
    );
  }

  return (
    <Modal
      title="Upload bank statement"
      onClose={onClose}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn-primary"
            disabled={!file || !bankAccountId || upload.isPending}
            onClick={() => upload.mutate()}
          >
            {upload.isPending ? 'Importing…' : 'Import'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="label" htmlFor="account">
            Bank account
          </label>
          <select
            id="account"
            className="input"
            value={bankAccountId}
            onChange={(event) => setBankAccountId(event.target.value)}
          >
            <option value="">Select an account…</option>
            {accounts?.items.map((account) => (
              <option key={account.id} value={account.id}>
                {account.label} · {account.bankName}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="file">
            Statement file
          </label>
          <FileField
            id="file"
            file={file}
            accept=".xlsx,.xls,.csv"
            onChange={setFile}
          />
          <p className="mt-1 text-xs text-slate-500">
            Columns are detected automatically. Re-uploading an overlapping period is safe — rows
            already held are skipped.
          </p>
        </div>

        <div>
          <button
            className="text-sm text-brand-600"
            onClick={() => setShowMapping((open) => !open)}
          >
            {showMapping ? 'Hide column mapping' : 'Set column names manually'}
          </button>
          {showMapping ? (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <p className="text-xs text-slate-500 sm:col-span-2">
                Only needed when this bank's export is not recognised. Enter the exact heading text
                from the statement.
              </p>
              {STATEMENT_FIELDS.map((field) => (
                <div key={field.name}>
                  <label className="label" htmlFor={`map-${field.name}`}>
                    {field.label}
                  </label>
                  <input
                    id={`map-${field.name}`}
                    className="input"
                    placeholder={field.placeholder}
                    value={mapping[field.name] ?? ''}
                    onChange={(event) =>
                      setMapping({ ...mapping, [field.name]: event.target.value })
                    }
                  />
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      {upload.error ? (
        <div className="mt-4">
          <ErrorState error={upload.error} />
        </div>
      ) : null}
    </Modal>
  );
}

/** Transaction register — PRD §36 `/banking/transactions`. */
export function BankTransactionsPage() {
  const { companyId } = useAuth();
  const [page, setPage] = useState(1);
  const [direction, setDirection] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['transactions', companyId, page, direction, status, search],
    queryFn: () =>
      api.banking.transactions({
        companyId,
        page,
        pageSize: 50,
        direction: direction || undefined,
        reconciliationStatus: status || undefined,
        q: search || undefined,
      }),
  });

  return (
    <>
      <PageHeader title="Bank Transactions" subtitle="Every imported statement line" />

      <div className="card">
        <div className="flex flex-wrap gap-3 border-b border-slate-200 px-4 py-3">
          <input
            className="input max-w-xs"
            placeholder="Narration, reference or UTR…"
            defaultValue={search}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                setSearch((event.target as HTMLInputElement).value);
                setPage(1);
              }
            }}
          />
          <select
            className="input w-auto"
            value={direction}
            onChange={(event) => setDirection(event.target.value)}
          >
            <option value="">All</option>
            <option value="DEBIT">Debits</option>
            <option value="CREDIT">Credits</option>
          </select>
          <select
            className="input w-auto"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="">Any reconciliation state</option>
            <option value="MATCHED">Matched</option>
            <option value="SUGGESTED">Suggested</option>
            <option value="UNMATCHED">Unmatched</option>
            <option value="IGNORED">Ignored</option>
          </select>
        </div>

        {isLoading ? (
          <Spinner />
        ) : error ? (
          <div className="p-4">
            <ErrorState error={error} />
          </div>
        ) : !data?.items.length ? (
          <EmptyState illustration="bank" title="No transactions" />
        ) : (
          <>
            <Table>
              <thead className="thead">
                <tr>
                  <th className="th">Date</th>
                  <th className="th">Narration</th>
                  <th className="th">Reference</th>
                  <th className="th">Dr/Cr</th>
                  <th className="th text-right">Amount</th>
                  <th className="th text-right">Balance</th>
                  <th className="th">Reconciliation</th>
                </tr>
              </thead>
              <tbody className="tbody">
                {data.items.map((transaction) => (
                  <tr key={transaction.id} className="hover:bg-slate-50">
                    <td className="td">{formatDate(transaction.transactionDate)}</td>
                    <td className="td max-w-md truncate" title={transaction.description}>
                      {transaction.description}
                    </td>
                    <td className="td font-mono text-xs">{transaction.reference ?? '—'}</td>
                    <td className="td">
                      <span
                        className={
                          transaction.direction === 'DEBIT' ? 'text-red-700' : 'text-emerald-700'
                        }
                      >
                        {transaction.direction === 'DEBIT' ? 'Dr' : 'Cr'}
                      </span>
                    </td>
                    <td className="td text-right">
                      <Money minor={transaction.amount} />
                    </td>
                    <td className="td text-right text-slate-500">
                      <Money minor={transaction.balance} compact />
                    </td>
                    <td className="td">
                      <StatusBadge status={transaction.reconciliationStatus} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination
              page={data.page}
              pageSize={data.pageSize}
              total={data.total}
              onChange={setPage}
            />
          </>
        )}
      </div>
    </>
  );
}
