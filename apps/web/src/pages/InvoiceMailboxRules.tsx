import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { SUPPORTED_INVOICE_CONTENT_TYPES } from '@fpc/shared';
import type { MailConnectionView } from '@fpc/api-client';
import { api } from '@/lib/api';
import { ErrorState, Modal } from '@/components/ui';

/**
 * What the connected mailbox is allowed to pull.
 *
 * The empty-means-any semantics are stated in the copy rather than left to be
 * discovered: a user who adds one sender expecting to widen the net has in fact
 * narrowed it to that sender alone.
 */

const CONTENT_TYPE_LABELS: Record<string, string> = {
  'application/pdf': 'PDF',
  'image/jpeg': 'JPEG',
  'image/png': 'PNG',
};

export function MailRulesModal({
  connection,
  onClose,
}: {
  connection: MailConnectionView;
  onClose(): void;
}) {
  const queryClient = useQueryClient();

  const [folder, setFolder] = useState(connection.rules.folder);
  const [senders, setSenders] = useState<string[]>(connection.rules.senderAllowlist);
  const [keywords, setKeywords] = useState<string[]>(connection.rules.subjectKeywords);
  const [types, setTypes] = useState<string[]>(connection.rules.allowedContentTypes);
  const [maxMessages, setMaxMessages] = useState(String(connection.rules.maxMessagesPerSync));
  const [lookback, setLookback] = useState(String(connection.rules.lookbackDays));
  const [defaultCompanyId, setDefaultCompanyId] = useState(connection.defaultCompanyId);

  const companies = useQuery({
    queryKey: ['settings', 'companies'],
    queryFn: () => api.settings.companies({ pageSize: 200 }),
  });

  const save = useMutation({
    mutationFn: () =>
      api.mail.updateConnection({
        defaultCompanyId,
        rules: {
          folder,
          senderAllowlist: senders,
          subjectKeywords: keywords,
          allowedContentTypes: types,
          maxMessagesPerSync: Number(maxMessages),
          lookbackDays: Number(lookback),
        },
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['mail'] }),
  });

  const toggleType = (value: string) => {
    setTypes((current) =>
      current.includes(value) ? current.filter((t) => t !== value) : [...current, value],
    );
  };

  return (
    <Modal
      title="Sync rules"
      wide
      onClose={onClose}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>
            Close
          </button>
          {save.isSuccess ? <span className="text-sm text-emerald-700">Saved</span> : null}
          <button className="btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Saving…' : 'Save rules'}
          </button>
        </>
      }
    >
      <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="mail-folder">
            Folder
          </label>
          <input
            id="mail-folder"
            className="input"
            value={folder}
            onChange={(event) => setFolder(event.target.value)}
          />
          <p className="muted mt-1 text-xs">
            A well-known name such as <code>inbox</code>, or a folder id.
          </p>
        </div>

        <div>
          <label className="label" htmlFor="mail-company">
            Default company
          </label>
          <select
            id="mail-company"
            className="input"
            value={defaultCompanyId}
            onChange={(event) => setDefaultCompanyId(event.target.value)}
          >
            {(companies.data?.items ?? []).map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </select>
          <p className="muted mt-1 text-xs">Where pulled invoices land.</p>
        </div>

        <div className="sm:col-span-2">
          <ChipListField
            id="mail-senders"
            label="Sender allow list"
            hint="Leave empty to accept any sender. Use a full address (ap@vendor.com) or a whole domain (@vendor.com)."
            placeholder="ap@vendor.com or @vendor.com"
            values={senders}
            onChange={setSenders}
          />
        </div>

        <div className="sm:col-span-2">
          <ChipListField
            id="mail-keywords"
            label="Subject keywords"
            hint="Leave empty to accept any subject. An email matches if its subject contains any one of these."
            placeholder="invoice"
            values={keywords}
            onChange={setKeywords}
          />
        </div>

        <div className="sm:col-span-2">
          <span className="label">Attachment types</span>
          <div className="mt-1 flex flex-wrap gap-4">
            {SUPPORTED_INVOICE_CONTENT_TYPES.map((value) => (
              <label key={value} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={types.includes(value)}
                  onChange={() => toggleType(value)}
                />
                {CONTENT_TYPE_LABELS[value] ?? value}
              </label>
            ))}
          </div>
        </div>

        <div>
          <label className="label" htmlFor="mail-max">
            Emails per sync
          </label>
          <input
            id="mail-max"
            className="input"
            type="number"
            min={1}
            max={100}
            value={maxMessages}
            onChange={(event) => setMaxMessages(event.target.value)}
          />
        </div>

        <div>
          <label className="label" htmlFor="mail-lookback">
            First sync looks back (days)
          </label>
          <input
            id="mail-lookback"
            className="input"
            type="number"
            min={1}
            max={365}
            value={lookback}
            onChange={(event) => setLookback(event.target.value)}
          />
          <p className="muted mt-1 text-xs">
            Only applies before the first sync; after that we resume where we left off.
          </p>
        </div>
      </div>

      {save.error ? (
        <div className="mt-4">
          <ErrorState error={save.error} compact />
        </div>
      ) : null}
    </Modal>
  );
}

/** An add-on-Enter list of short values, rendered as removable chips. */
function ChipListField({
  id,
  label,
  hint,
  placeholder,
  values,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  placeholder: string;
  values: string[];
  onChange(next: string[]): void;
}) {
  const [draft, setDraft] = useState('');

  const add = () => {
    const value = draft.trim().toLowerCase();
    if (!value || values.includes(value)) {
      setDraft('');
      return;
    }
    onChange([...values, value]);
    setDraft('');
  };

  return (
    <div>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <div className="flex gap-2">
        <input
          id={id}
          className="input"
          placeholder={placeholder}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              add();
            }
          }}
        />
        <button className="btn-secondary" type="button" onClick={add}>
          Add
        </button>
      </div>
      <p className="muted mt-1 text-xs">{hint}</p>

      {values.length ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {values.map((value) => (
            <span key={value} className="chip-neutral inline-flex items-center gap-1">
              {value}
              <button
                type="button"
                aria-label={`Remove ${value}`}
                onClick={() => onChange(values.filter((entry) => entry !== value))}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
