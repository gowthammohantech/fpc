import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Permission } from '@fpc/shared';
import { useAuth } from '@/hooks/useAuth';
import {
  EmptyState,
  ErrorState,
  Modal,
  PageHeader,
  Pagination,
  Spinner,
  Table,
} from '@/components/ui';

export interface FieldDefinition {
  name: string;
  label: string;
  type?: 'text' | 'email' | 'number' | 'select' | 'multiselect' | 'checkbox';
  options?: Array<{ value: string; label: string }>;
  required?: boolean;
  help?: string;
  /** Hidden when editing (e.g. companyId, which cannot move). */
  createOnly?: boolean;
}

export interface CrudColumn<T> {
  header: string;
  render(row: T): ReactNode;
  align?: 'left' | 'right';
}

/**
 * Shared scaffolding for the administration screens.
 *
 * Locations, departments, vendors, users and bank accounts are all the same
 * shape — a scoped list with a create/edit form — so they share one component
 * rather than five near-identical pages. Screens with real behaviour
 * (approval rules, roles) are written out separately.
 */
export function CrudPage<T extends { id: string }>({
  title,
  subtitle,
  columns,
  fields,
  permissions,
  queryKey,
  list,
  create,
  update,
  remove,
  defaults,
  toFormValues,
}: {
  title: string;
  subtitle?: string;
  columns: Array<CrudColumn<T>>;
  fields: FieldDefinition[];
  permissions: { read: Permission; create?: Permission; update?: Permission; delete?: Permission };
  queryKey: string;
  list(query: Record<string, unknown>): Promise<{ items: T[]; page: number; pageSize: number; total: number }>;
  create?(body: Record<string, unknown>): Promise<unknown>;
  update?(id: string, body: Record<string, unknown>): Promise<unknown>;
  remove?(id: string): Promise<unknown>;
  defaults?: Record<string, unknown>;
  toFormValues?(row: T): Record<string, unknown>;
}) {
  const { companyId, can } = useAuth();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<T | 'new' | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: [queryKey, companyId, page, search],
    queryFn: () => list({ companyId, page, pageSize: 25, q: search || undefined }),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: [queryKey] });

  return (
    <>
      <PageHeader
        title={title}
        subtitle={subtitle}
        actions={
          create && permissions.create && can(permissions.create) ? (
            <button className="btn-primary" onClick={() => setEditing('new')}>
              Add {title.replace(/s$/, '').toLowerCase()}
            </button>
          ) : null
        }
      />

      <div className="card">
        <div className="border-b border-slate-200 px-4 py-3">
          <input
            className="input max-w-xs"
            placeholder="Search…"
            defaultValue={search}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                setSearch((event.target as HTMLInputElement).value);
                setPage(1);
              }
            }}
          />
        </div>

        {isLoading ? (
          <Spinner />
        ) : error ? (
          <div className="p-4"><ErrorState error={error} /></div>
        ) : !data?.items.length ? (
          <EmptyState title={`No ${title.toLowerCase()} yet`} />
        ) : (
          <>
            <Table>
              <thead className="bg-slate-50">
                <tr>
                  {columns.map((column) => (
                    <th key={column.header} className={`th ${column.align === 'right' ? 'text-right' : ''}`}>
                      {column.header}
                    </th>
                  ))}
                  <th className="th" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {data.items.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50">
                    {columns.map((column) => (
                      <td
                        key={column.header}
                        className={`td ${column.align === 'right' ? 'text-right' : ''}`}
                      >
                        {column.render(row)}
                      </td>
                    ))}
                    <td className="td text-right">
                      {update && permissions.update && can(permissions.update) ? (
                        <button className="text-sm text-brand-600" onClick={() => setEditing(row)}>
                          Edit
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} />
          </>
        )}
      </div>

      {editing ? (
        <RecordForm
          title={editing === 'new' ? `Add ${title.replace(/s$/, '')}` : `Edit ${title.replace(/s$/, '')}`}
          fields={fields.filter((field) => editing === 'new' || !field.createOnly)}
          initial={
            editing === 'new'
              ? { companyId, ...defaults }
              : (toFormValues?.(editing) ?? (editing as unknown as Record<string, unknown>))
          }
          onClose={() => setEditing(null)}
          onSubmit={async (values) => {
            if (editing === 'new') await create?.(values);
            else await update?.(editing.id, values);
            await invalidate();
            setEditing(null);
          }}
          onDelete={
            editing !== 'new' && remove && permissions.delete && can(permissions.delete)
              ? async () => {
                  await remove(editing.id);
                  await invalidate();
                  setEditing(null);
                }
              : undefined
          }
        />
      ) : null}
    </>
  );
}

function RecordForm({
  title,
  fields,
  initial,
  onClose,
  onSubmit,
  onDelete,
}: {
  title: string;
  fields: FieldDefinition[];
  initial: Record<string, unknown>;
  onClose(): void;
  onSubmit(values: Record<string, unknown>): Promise<void>;
  onDelete?(): Promise<void>;
}) {
  const [values, setValues] = useState<Record<string, unknown>>(initial);

  const save = useMutation({
    mutationFn: () => {
      // Only send fields the form actually manages, so a PATCH does not
      // echo back read-only server state.
      const payload: Record<string, unknown> = {};
      for (const field of fields) {
        const value = values[field.name];
        if (value === undefined || value === '') continue;
        payload[field.name] = field.type === 'number' ? Number(value) : value;
      }
      if (values.companyId) payload.companyId = values.companyId;
      return onSubmit(payload);
    },
  });

  const del = useMutation({ mutationFn: () => onDelete!() });

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          {onDelete ? (
            <button
              className="btn-danger mr-auto"
              disabled={del.isPending}
              onClick={() => del.mutate()}
            >
              Deactivate
            </button>
          ) : null}
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {fields.map((field) => (
          <div key={field.name}>
            <label className="label" htmlFor={field.name}>
              {field.label}
              {field.required ? <span className="text-red-600"> *</span> : null}
            </label>

            {field.type === 'select' ? (
              <select
                id={field.name}
                className="input"
                value={String(values[field.name] ?? '')}
                onChange={(event) => setValues({ ...values, [field.name]: event.target.value })}
              >
                <option value="">Select…</option>
                {field.options?.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            ) : field.type === 'multiselect' ? (
              <div className="space-y-1 rounded-md border border-slate-300 p-2">
                {field.options?.map((option) => {
                  const current = (values[field.name] as string[] | undefined) ?? [];
                  return (
                    <label key={option.value} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={current.includes(option.value)}
                        onChange={(event) =>
                          setValues({
                            ...values,
                            [field.name]: event.target.checked
                              ? [...current, option.value]
                              : current.filter((entry) => entry !== option.value),
                          })
                        }
                      />
                      {option.label}
                    </label>
                  );
                })}
              </div>
            ) : field.type === 'checkbox' ? (
              <input
                id={field.name}
                type="checkbox"
                checked={Boolean(values[field.name])}
                onChange={(event) => setValues({ ...values, [field.name]: event.target.checked })}
              />
            ) : (
              <input
                id={field.name}
                type={field.type ?? 'text'}
                className="input"
                value={String(values[field.name] ?? '')}
                onChange={(event) => setValues({ ...values, [field.name]: event.target.value })}
              />
            )}

            {field.help ? <p className="mt-1 text-xs text-slate-500">{field.help}</p> : null}
          </div>
        ))}
      </div>

      {save.error ? <div className="mt-4"><ErrorState error={save.error} /></div> : null}
      {del.error ? <div className="mt-4"><ErrorState error={del.error} /></div> : null}
    </Modal>
  );
}
