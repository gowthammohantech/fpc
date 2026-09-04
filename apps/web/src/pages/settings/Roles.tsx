import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { RoleDescriptor } from '@fpc/api-client';
import { PERMISSION_GROUPS, permissionAction, type Permission } from '@fpc/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { Card, EmptyState, ErrorState, Modal, PageHeader, Spinner } from '@/components/ui';

/**
 * Roles — PRD §7.
 *
 * The eight built-in roles are code, and stay read-only: the approval ladders
 * and the seeded accounts are written against exactly those grants. Anything a
 * tenant needs beyond them is a role it creates here, and both kinds are
 * enforced by the same permission checks on the API.
 *
 * Picking a role on the left swaps the checkbox grid on the right to that
 * role's grants, so one panel reads as documentation for a built-in role and
 * as an editor for a custom one.
 */
export function RolesPage() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['roles'],
    queryFn: () => api.settings.roles(),
  });

  const roles = data?.items ?? [];
  const selected = roles.find((role) => role.key === selectedKey) ?? roles[0];

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['roles'] });

  if (isLoading) return <Spinner />;
  if (error) return <ErrorState error={error} />;

  return (
    <>
      <PageHeader
        title="Roles"
        subtitle="What each role can do. These are enforced by the API, not just the interface."
        actions={
          can('role:create') ? (
            <button className="btn-primary" onClick={() => setCreating(true)}>
              Create role
            </button>
          ) : null
        }
      />

      <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <Card className="divide-y divide-slate-100 p-0">
          {roles.map((role) => (
            <button
              key={role.key}
              type="button"
              aria-current={role.key === selected?.key}
              className={`flex w-full flex-col items-start gap-0.5 px-4 py-3 text-left hover:bg-slate-50 ${
                role.key === selected?.key ? 'bg-brand-50' : ''
              }`}
              onClick={() => setSelectedKey(role.key)}
            >
              <span className="flex w-full items-center justify-between gap-2">
                <span className="font-medium">{role.label}</span>
                {role.system ? (
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                    Built-in
                  </span>
                ) : !role.active ? (
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
                    Inactive
                  </span>
                ) : null}
              </span>
              <span className="text-xs text-slate-500">
                {role.permissionCount} permissions · {role.userCount}{' '}
                {role.userCount === 1 ? 'user' : 'users'}
              </span>
            </button>
          ))}
        </Card>

        {selected ? (
          <RoleDetail key={selected.key} role={selected} onChanged={invalidate} />
        ) : (
          <EmptyState title="No roles" />
        )}
      </div>

      {creating ? (
        <CreateRoleModal
          onClose={() => setCreating(false)}
          onCreated={async (role) => {
            await invalidate();
            setSelectedKey(role.key);
            setCreating(false);
          }}
        />
      ) : null}
    </>
  );
}

/**
 * The permission grid for one role.
 *
 * Built-in roles render the same checkboxes, disabled — one layout to read
 * whichever role is selected, rather than a list for some and a form for
 * others.
 */
function RoleDetail({ role, onChanged }: { role: RoleDescriptor; onChanged(): Promise<unknown> }) {
  const { can } = useAuth();
  const editable = !role.system && can('role:update');

  const [selected, setSelected] = useState<Permission[]>(role.permissions);
  const [label, setLabel] = useState(role.label);
  const [description, setDescription] = useState(role.description ?? '');

  // A refetch after saving hands down a new object for the same role; the form
  // follows it rather than sitting on a stale copy.
  useEffect(() => {
    setSelected(role.permissions);
    setLabel(role.label);
    setDescription(role.description ?? '');
  }, [role]);

  const dirty = useMemo(
    () =>
      label !== role.label ||
      description !== (role.description ?? '') ||
      selected.length !== role.permissions.length ||
      selected.some((permission) => !role.permissions.includes(permission)),
    [label, description, selected, role],
  );

  const save = useMutation({
    mutationFn: () =>
      api.settings.updateRole(role.id!, { label, description, permissions: selected }),
    onSuccess: () => onChanged(),
  });

  const remove = useMutation({
    mutationFn: () => api.settings.deleteRole(role.id!),
    onSuccess: () => onChanged(),
  });

  const reset = () => {
    setSelected(role.permissions);
    setLabel(role.label);
    setDescription(role.description ?? '');
  };

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-semibold">{role.label}</h2>
          <p className="mt-0.5 font-mono text-xs text-slate-500">{role.key}</p>
          {role.description ? (
            <p className="mt-1 text-sm text-slate-600">{role.description}</p>
          ) : null}
        </div>
        <span className="text-xs text-slate-500">
          {selected.length} of {PERMISSION_COUNT} permissions
        </span>
      </div>

      {role.system ? (
        <p className="mt-3 rounded-md bg-slate-50 p-3 text-sm text-slate-600">
          Built-in roles cannot be changed. Create a role to grant a different combination.
        </p>
      ) : editable ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="role-label">
              Name
            </label>
            <input
              id="role-label"
              className="input"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="role-description">
              Description
            </label>
            <input
              id="role-description"
              className="input"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
        </div>
      ) : null}

      <PermissionPicker selected={selected} disabled={!editable} onChange={setSelected} />

      {editable ? (
        <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-slate-200 pt-4">
          <button
            className="btn-primary"
            disabled={!dirty || save.isPending || selected.length === 0}
            onClick={() => save.mutate()}
          >
            {save.isPending ? 'Saving…' : 'Save changes'}
          </button>
          {dirty ? (
            <button className="btn-secondary" onClick={reset}>
              Discard
            </button>
          ) : null}
          {selected.length === 0 ? (
            <span className="text-sm text-amber-700">Select at least one permission.</span>
          ) : null}
          {can('role:delete') ? (
            <button
              className="btn-danger ml-auto"
              disabled={remove.isPending || role.userCount > 0}
              title={
                role.userCount > 0
                  ? 'Reassign the users holding this role before deleting it'
                  : undefined
              }
              onClick={() => remove.mutate()}
            >
              Delete role
            </button>
          ) : null}
        </div>
      ) : null}

      {save.error ? (
        <div className="mt-4">
          <ErrorState error={save.error} />
        </div>
      ) : null}
      {remove.error ? (
        <div className="mt-4">
          <ErrorState error={remove.error} />
        </div>
      ) : null}
    </Card>
  );
}

/**
 * Every permission the API knows about, one checkbox each, grouped by resource.
 *
 * The groups come from `@fpc/shared`, so a permission added to the catalogue
 * the server enforces appears here without a second edit.
 */
function PermissionPicker({
  selected,
  disabled,
  onChange,
}: {
  selected: Permission[];
  disabled: boolean;
  onChange(next: Permission[]): void;
}) {
  const toggle = (permission: Permission, checked: boolean) =>
    onChange(
      checked ? [...selected, permission] : selected.filter((entry) => entry !== permission),
    );

  return (
    <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {PERMISSION_GROUPS.map((group) => {
        const chosen = group.permissions.filter((permission) => selected.includes(permission));
        const all = chosen.length === group.permissions.length;

        return (
          <fieldset key={group.resource} className="rounded-md border border-slate-200 p-3">
            <legend className="flex items-center gap-2 px-1 text-sm font-medium">
              {group.label}
              {disabled ? (
                <span className="text-xs font-normal text-slate-400">
                  {chosen.length}/{group.permissions.length}
                </span>
              ) : (
                <button
                  type="button"
                  className="text-xs font-normal text-brand-600"
                  onClick={() =>
                    onChange(
                      all
                        ? selected.filter((permission) => !group.permissions.includes(permission))
                        : [...new Set([...selected, ...group.permissions])],
                    )
                  }
                >
                  {all ? 'None' : 'All'}
                </button>
              )}
            </legend>

            <div className="space-y-1">
              {group.permissions.map((permission) => (
                <label
                  key={permission}
                  className={`flex items-center gap-2 rounded px-1 py-0.5 text-sm ${
                    disabled ? 'text-slate-500' : 'cursor-pointer hover:bg-slate-50'
                  }`}
                >
                  <input
                    type="checkbox"
                    disabled={disabled}
                    checked={selected.includes(permission)}
                    aria-label={permission}
                    onChange={(event) => toggle(permission, event.target.checked)}
                  />
                  <span className={sensitivity(permission)}>{permissionAction(permission)}</span>
                </label>
              ))}
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}

function CreateRoleModal({
  onClose,
  onCreated,
}: {
  onClose(): void;
  onCreated(role: RoleDescriptor): Promise<void>;
}) {
  const [label, setLabel] = useState('');
  const [description, setDescription] = useState('');
  const [selected, setSelected] = useState<Permission[]>([]);

  const create = useMutation({
    mutationFn: () =>
      api.settings.createRole({
        label,
        ...(description ? { description } : {}),
        permissions: selected,
      }),
    onSuccess: (role) => onCreated(role),
  });

  return (
    <Modal
      title="Create role"
      onClose={onClose}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn-primary"
            disabled={create.isPending || label.trim().length < 2 || selected.length === 0}
            onClick={() => create.mutate()}
          >
            {create.isPending ? 'Creating…' : 'Create role'}
          </button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="new-role-label">
            Name<span className="text-red-600"> *</span>
          </label>
          <input
            id="new-role-label"
            className="input"
            value={label}
            placeholder="Payments Clerk"
            onChange={(event) => setLabel(event.target.value)}
          />
          <p className="mt-1 text-xs text-slate-500">
            Key derived from the name: <span className="font-mono">{keyPreview(label)}</span>
          </p>
        </div>
        <div>
          <label className="label" htmlFor="new-role-description">
            Description
          </label>
          <input
            id="new-role-description"
            className="input"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>
      </div>

      <p className="mt-4 text-sm text-slate-600">
        Tick everything this role may do — {selected.length} selected.
      </p>

      <PermissionPicker selected={selected} disabled={false} onChange={setSelected} />

      {create.error ? (
        <div className="mt-4">
          <ErrorState error={create.error} />
        </div>
      ) : null}
    </Modal>
  );
}

const PERMISSION_COUNT = PERMISSION_GROUPS.reduce(
  (total, group) => total + group.permissions.length,
  0,
);

/** Mirrors the server's key derivation, so the form can show it before saving. */
function keyPreview(label: string): string {
  return (
    label
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40) || '—'
  );
}

/** Payroll and approval grants are the two separations the platform relies on. */
function sensitivity(permission: Permission): string {
  if (permission.startsWith('payroll:')) return 'text-purple-800';
  if (permission.endsWith(':approve')) return 'text-emerald-800';
  return '';
}
