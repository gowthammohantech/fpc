import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ROLE_KEYS, ROLE_LABELS, fromMinor, type RoleKey } from '@fpc/shared';
import type { ApprovalRuleView } from '@fpc/api-client';
import { api } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { formatINR, humanize, rupeesToMinor } from '@/lib/format';
import {
  Card,
  EmptyState,
  ErrorState,
  Modal,
  PageHeader,
  Spinner,
  StatusBadge,
} from '@/components/ui';

type Condition = { field: string; operator: string; value: unknown };
type Step = { order: number; approverType: string; roleKey?: string; label?: string };

const AMOUNT_FIELDS = new Set(['amount']);

/**
 * Approval rule builder — PRD §15, §36 `/settings/approvals`.
 *
 * Rules are data, so this screen edits conditions and steps directly. The
 * simulator answers the question an administrator actually has — "who would
 * have to approve a ₹35.4L invoice?" — before the rule is saved.
 */
export function ApprovalRulesPage() {
  const { companyId, can } = useAuth();
  const [editing, setEditing] = useState<ApprovalRuleView | 'new' | null>(null);
  const [simulating, setSimulating] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['approval-rules', companyId],
    queryFn: () => api.settings.approvalRules({ companyId, pageSize: 100 }),
  });

  return (
    <>
      <PageHeader
        title="Approval Rules"
        subtitle="Who has to approve what. Rules are evaluated highest priority first."
        actions={
          <>
            <button className="btn-secondary" onClick={() => setSimulating(true)}>
              Test a rule
            </button>
            {can('approval_rule:create') ? (
              <button className="btn-primary" onClick={() => setEditing('new')}>
                New rule
              </button>
            ) : null}
          </>
        }
      />

      {isLoading ? (
        <Spinner />
      ) : error ? (
        <ErrorState error={error} />
      ) : !data?.items.length ? (
        <Card>
          <EmptyState
            title="No approval rules configured"
            hint="Without a rule, submitted invoices are approved automatically and the reason is recorded in the audit trail."
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {data.items.map((rule) => (
            <Card key={rule.id} className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-3">
                    <h2 className="font-semibold">{rule.name}</h2>
                    <StatusBadge status={rule.active ? 'ACTIVE' : 'INACTIVE'} />
                    <span className="text-xs text-slate-500">Priority {rule.priority}</span>
                    <span className="text-xs text-slate-500">{humanize(rule.appliesTo)}</span>
                  </div>
                  {rule.description ? (
                    <p className="mt-1 text-sm text-slate-500">{rule.description}</p>
                  ) : null}

                  <p className="mt-3 text-sm">
                    <span className="text-slate-500">Applies when: </span>
                    {rule.conditions.length
                      ? rule.conditions.map(describeCondition).join(' and ')
                      : 'always'}
                  </p>

                  <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                    {rule.steps
                      .slice()
                      .sort((a, b) => a.order - b.order)
                      .map((step, index) => (
                        <span key={step.order} className="flex items-center gap-2">
                          {index > 0 ? <span className="text-slate-300">→</span> : null}
                          <span className="rounded bg-slate-100 px-2 py-1">
                            {describeStep(step)}
                          </span>
                        </span>
                      ))}
                  </div>
                </div>

                {can('approval_rule:update') ? (
                  <button className="btn-secondary" onClick={() => setEditing(rule)}>
                    Edit
                  </button>
                ) : null}
              </div>
            </Card>
          ))}
        </div>
      )}

      {editing ? <RuleEditor rule={editing} onClose={() => setEditing(null)} /> : null}
      {simulating ? <SimulatorModal onClose={() => setSimulating(false)} /> : null}
    </>
  );
}

function describeCondition(condition: Condition): string {
  const operator =
    {
      eq: 'is',
      ne: 'is not',
      gt: 'is above',
      gte: 'is at least',
      lt: 'is below',
      lte: 'is at most',
      in: 'is one of',
      nin: 'is not one of',
      between: 'is between',
    }[condition.operator] ?? condition.operator;

  const value = AMOUNT_FIELDS.has(condition.field)
    ? Array.isArray(condition.value)
      ? condition.value.map((entry) => formatINR(Number(entry))).join(' and ')
      : formatINR(Number(condition.value))
    : String(condition.value);

  return `${humanize(condition.field)} ${operator} ${value}`;
}

function describeStep(step: Step): string {
  if (step.approverType === 'DEPARTMENT_HEAD') return step.label || 'Department Head';
  if (step.roleKey) return ROLE_LABELS[step.roleKey as RoleKey] ?? step.roleKey;
  return step.label || humanize(step.approverType);
}

function RuleEditor({ rule, onClose }: { rule: ApprovalRuleView | 'new'; onClose(): void }) {
  const { companyId } = useAuth();
  const queryClient = useQueryClient();
  const isNew = rule === 'new';

  const [name, setName] = useState(isNew ? '' : rule.name);
  const [description, setDescription] = useState(isNew ? '' : (rule.description ?? ''));
  const [appliesTo, setAppliesTo] = useState(isNew ? 'VENDOR_INVOICE' : rule.appliesTo);
  const [priority, setPriority] = useState(isNew ? 100 : rule.priority);
  const [active, setActive] = useState(isNew ? true : rule.active);
  const [conditions, setConditions] = useState<Condition[]>(isNew ? [] : rule.conditions);
  const [steps, setSteps] = useState<Step[]>(
    isNew ? [{ order: 1, approverType: 'ROLE', roleKey: 'FINANCE_MANAGER' }] : rule.steps,
  );

  const save = useMutation({
    mutationFn: () => {
      const body = {
        companyId,
        name,
        description: description || undefined,
        appliesTo,
        priority,
        active,
        conditions,
        steps: steps.map((step, index) => ({ ...step, order: index + 1 })),
      };
      return isNew
        ? api.settings.createApprovalRule(body)
        : api.settings.updateApprovalRule(rule.id, body);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['approval-rules'] });
      onClose();
    },
  });

  const remove = useMutation({
    mutationFn: () => api.settings.deleteApprovalRule((rule as ApprovalRuleView).id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['approval-rules'] });
      onClose();
    },
  });

  return (
    <Modal
      title={isNew ? 'New approval rule' : 'Edit approval rule'}
      wide
      onClose={onClose}
      footer={
        <>
          {!isNew ? (
            <button className="btn-danger mr-auto" onClick={() => remove.mutate()}>
              Deactivate
            </button>
          ) : null}
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn-primary"
            disabled={!name || steps.length === 0 || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? 'Saving…' : 'Save rule'}
          </button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="label" htmlFor="name">
            Rule name
          </label>
          <input
            id="name"
            className="input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Above ₹10L — Department Head, Finance Head, CFO"
          />
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="description">
            Description
          </label>
          <input
            id="description"
            className="input"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="appliesTo">
            Applies to
          </label>
          <select
            id="appliesTo"
            className="input"
            value={appliesTo}
            onChange={(event) => setAppliesTo(event.target.value as typeof appliesTo)}
          >
            <option value="VENDOR_INVOICE">Vendor invoices</option>
            <option value="PAYROLL_BATCH">Payroll batches</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="priority">
            Priority
          </label>
          <input
            id="priority"
            type="number"
            className="input"
            value={priority}
            onChange={(event) => setPriority(Number(event.target.value))}
          />
          <p className="mt-1 text-xs text-slate-500">Higher wins when several rules match.</p>
        </div>
      </div>

      <section className="mt-6">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="font-semibold">Conditions</h3>
          <button
            className="btn-secondary"
            onClick={() =>
              setConditions([...conditions, { field: 'amount', operator: 'gte', value: 0 }])
            }
          >
            Add condition
          </button>
        </div>
        {!conditions.length ? (
          <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-500">
            No conditions — this rule applies to everything of the selected type.
          </p>
        ) : (
          <div className="space-y-2">
            {conditions.map((condition, index) => (
              <div key={index} className="flex flex-wrap items-center gap-2">
                <select
                  className="input w-auto"
                  value={condition.field}
                  onChange={(event) => updateCondition(index, { field: event.target.value })}
                >
                  <option value="amount">Amount</option>
                  <option value="vendorId">Vendor</option>
                  <option value="departmentId">Department</option>
                  <option value="locationId">Location</option>
                  <option value="employeeCount">Employee count</option>
                </select>
                <select
                  className="input w-auto"
                  value={condition.operator}
                  onChange={(event) => updateCondition(index, { operator: event.target.value })}
                >
                  <option value="gte">is at least</option>
                  <option value="gt">is above</option>
                  <option value="lte">is at most</option>
                  <option value="lt">is below</option>
                  <option value="eq">is</option>
                  <option value="ne">is not</option>
                  <option value="in">is one of</option>
                </select>
                <input
                  className="input w-40"
                  value={
                    AMOUNT_FIELDS.has(condition.field) && typeof condition.value === 'number'
                      ? String(fromMinor(condition.value))
                      : String(condition.value ?? '')
                  }
                  onChange={(event) =>
                    updateCondition(index, {
                      value: AMOUNT_FIELDS.has(condition.field)
                        ? (rupeesToMinor(event.target.value) ?? 0)
                        : event.target.value,
                    })
                  }
                  placeholder={AMOUNT_FIELDS.has(condition.field) ? '₹ amount' : 'value'}
                />
                <button
                  className="text-sm text-red-600"
                  onClick={() =>
                    setConditions(conditions.filter((_, position) => position !== index))
                  }
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="mt-6">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="font-semibold">Approval chain</h3>
          <button
            className="btn-secondary"
            onClick={() =>
              setSteps([
                ...steps,
                { order: steps.length + 1, approverType: 'ROLE', roleKey: 'CFO' },
              ])
            }
          >
            Add step
          </button>
        </div>
        <div className="space-y-2">
          {steps.map((step, index) => (
            <div key={index} className="flex flex-wrap items-center gap-2">
              <span className="w-6 text-sm text-slate-500">{index + 1}.</span>
              <select
                className="input w-auto"
                value={step.approverType}
                onChange={(event) => updateStep(index, { approverType: event.target.value })}
              >
                <option value="ROLE">Anyone with role</option>
                <option value="DEPARTMENT_HEAD">Department head</option>
              </select>
              {step.approverType === 'ROLE' ? (
                <select
                  className="input w-auto"
                  value={step.roleKey ?? ''}
                  onChange={(event) => updateStep(index, { roleKey: event.target.value })}
                >
                  {ROLE_KEYS.map((role) => (
                    <option key={role} value={role}>
                      {ROLE_LABELS[role as RoleKey]}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className="input w-48"
                  placeholder="Label (e.g. IT Head)"
                  value={step.label ?? ''}
                  onChange={(event) => updateStep(index, { label: event.target.value })}
                />
              )}
              {steps.length > 1 ? (
                <button
                  className="text-sm text-red-600"
                  onClick={() => setSteps(steps.filter((_, position) => position !== index))}
                >
                  Remove
                </button>
              ) : null}
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Steps run in order. A rejection at any step stops the chain, and a submitter can never
          approve their own item.
        </p>
      </section>

      <label className="mt-6 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={active}
          onChange={(event) => setActive(event.target.checked)}
        />
        Rule is active
      </label>

      {save.error ? (
        <div className="mt-4">
          <ErrorState error={save.error} />
        </div>
      ) : null}
    </Modal>
  );

  function updateCondition(index: number, patch: Partial<Condition>) {
    setConditions(
      conditions.map((entry, position) => (position === index ? { ...entry, ...patch } : entry)),
    );
  }
  function updateStep(index: number, patch: Partial<Step>) {
    setSteps(steps.map((entry, position) => (position === index ? { ...entry, ...patch } : entry)));
  }
}

/** "Who would approve ₹X?" — checked before a rule change goes live. */
function SimulatorModal({ onClose }: { onClose(): void }) {
  const { companyId } = useAuth();
  const [amount, setAmount] = useState('3540000');
  const [appliesTo, setAppliesTo] = useState('VENDOR_INVOICE');

  const simulate = useMutation({
    mutationFn: () =>
      api.settings.simulateApprovalRule({
        companyId,
        appliesTo,
        amount: rupeesToMinor(amount) ?? 0,
      }),
  });

  return (
    <Modal
      title="Test the approval rules"
      onClose={onClose}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>
            Close
          </button>
          <button className="btn-primary" onClick={() => simulate.mutate()}>
            Evaluate
          </button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="simType">
            Type
          </label>
          <select
            id="simType"
            className="input"
            value={appliesTo}
            onChange={(event) => setAppliesTo(event.target.value)}
          >
            <option value="VENDOR_INVOICE">Vendor invoice</option>
            <option value="PAYROLL_BATCH">Payroll batch</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="simAmount">
            Amount (₹)
          </label>
          <input
            id="simAmount"
            className="input tabular"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </div>
      </div>

      {simulate.data ? (
        <div className="mt-5 rounded-md border border-slate-200 p-4">
          {simulate.data.matched ? (
            <>
              <p className="text-sm text-slate-500">Matching rule</p>
              <p className="font-semibold">{simulate.data.matched.name}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                {(simulate.data.matched.steps as Step[])
                  .slice()
                  .sort((a, b) => a.order - b.order)
                  .map((step, index) => (
                    <span key={step.order} className="flex items-center gap-2">
                      {index > 0 ? <span className="text-slate-300">→</span> : null}
                      <span className="rounded bg-slate-100 px-2 py-1">{describeStep(step)}</span>
                    </span>
                  ))}
              </div>
            </>
          ) : (
            <p className="text-sm text-amber-800">{simulate.data.note}</p>
          )}
        </div>
      ) : null}

      {simulate.error ? (
        <div className="mt-4">
          <ErrorState error={simulate.error} />
        </div>
      ) : null}
    </Modal>
  );
}
