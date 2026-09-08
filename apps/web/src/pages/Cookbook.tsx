import type { ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { EmptyState, PageHeader, StatusBadge, Table } from '@/components/ui';
import { useAuth } from '@/hooks/useAuth';
import type { Permission } from '@fpc/shared';

/**
 * The user handbook — every task in the product written as a recipe.
 *
 * It is deliberately static content rather than a fetched document: the
 * screen names, tabs and button labels quoted here are the ones the clients
 * are compiled from, so the handbook ships and versions with the interface it
 * describes rather than drifting away from it in a wiki.
 *
 * The page is not permission-gated. It documents refusals as much as actions
 * — a person who cannot release a bank file still needs to know why, and who
 * can — so hiding a recipe from them would remove the answer along with the
 * action. Links out to the screens are gated instead, so the handbook never
 * offers a door that would not open.
 */

/** Who a recipe is written for, in the words the recipes themselves use. */
type Audience = 'EXEC' | 'APPROVER' | 'ACCOUNTS' | 'TREASURY' | 'PAYROLL' | 'ADMIN';
type Filter = 'ALL' | Audience;

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: 'ALL', label: 'Everyone' },
  { key: 'EXEC', label: 'Finance Executive' },
  { key: 'APPROVER', label: 'Approver / CFO' },
  { key: 'ACCOUNTS', label: 'Accounting' },
  { key: 'TREASURY', label: 'Treasury' },
  { key: 'PAYROLL', label: 'Payroll' },
  { key: 'ADMIN', label: 'Admin' },
];

/** Everyone, spelled out — for the recipes that are not role-specific. */
const ANYONE: Audience[] = ['EXEC', 'APPROVER', 'ACCOUNTS', 'TREASURY', 'PAYROLL', 'ADMIN'];

const PARTS = [
  'Getting started',
  'A vendor invoice, start to finish',
  'Payroll',
  'Paying, and proving it',
  'Seeing the whole position',
  'Administration',
  'Reference',
] as const;

type Part = (typeof PARTS)[number];

interface Recipe {
  id: string;
  /** Printed rather than derived: a recipe is quoted by number in training. */
  number: string;
  title: string;
  who: ReactNode;
  part: Part;
  audiences: Audience[];
  /** The screen the recipe is about, offered only to users who may open it. */
  link?: { to: string; label: string; permissions: Permission[] };
  body: ReactNode;
}

/* -------------------------------------------------------------------------- */
/* Small presentational pieces, shared by the recipes below.                   */
/* -------------------------------------------------------------------------- */

/** A control the reader will look for on screen, quoted exactly. */
function Ui({ children }: { children: ReactNode }) {
  return (
    <span className="whitespace-nowrap rounded border border-ink-200 bg-ink-50 px-1.5 py-0.5 font-mono text-[12px] font-medium text-ink-800">
      {children}
    </span>
  );
}

/** A place in the navigation, as the sidebar spells it. */
function Where({ children }: { children: ReactNode }) {
  return <span className="font-semibold text-ink-900">{children}</span>;
}

/**
 * An aside.
 *
 * The tones carry the same meaning they do on a status badge — `stop` is a
 * refusal the product will actually make, `warn` something to check before
 * acting — so a reader who has learnt the colours elsewhere already reads
 * these correctly.
 */
function Note({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'warn' | 'stop';
  children: ReactNode;
}) {
  const style = {
    info: 'border-brand-600 bg-brand-50 text-brand-900',
    warn: 'border-amber-500 bg-amber-50 text-amber-900',
    stop: 'border-red-500 bg-red-50 text-red-900',
  }[tone];

  return (
    <div className={`my-4 rounded-r-lg border-l-2 px-4 py-3 text-sm ${style}`}>{children}</div>
  );
}

function Steps({ children }: { children: ReactNode }) {
  return (
    <ol className="ml-4 list-decimal space-y-2.5 text-sm text-ink-700 marker:font-semibold marker:text-ink-400">
      {children}
    </ol>
  );
}

function Bullets({ children }: { children: ReactNode }) {
  return (
    <ul className="my-3 ml-5 list-disc space-y-1.5 text-sm text-ink-700 marker:text-ink-300">
      {children}
    </ul>
  );
}

/** A quiet second line under a step, for the thing that is easy to get wrong. */
function Aside({ children }: { children: ReactNode }) {
  return <span className="mt-1 block text-sm text-ink-500">{children}</span>;
}

/** Gross, TDS and net side by side — the distinction the product turns on. */
function GrossToNet() {
  const columns = [
    { label: 'Gross billed', value: '₹1,18,000.00', hint: 'What the vendor invoiced' },
    { label: 'TDS withheld', value: '₹10,000.00', hint: 'Section 194J, on the taxable value' },
    { label: 'Net payable', value: '₹1,08,000.00', hint: 'What the bank pays out' },
  ];

  return (
    <div className="my-4 grid gap-px overflow-hidden rounded-xl border border-ink-200 bg-ink-200 sm:grid-cols-3">
      {columns.map((column, index) => (
        <div
          key={column.label}
          className={index === columns.length - 1 ? 'bg-brand-50 p-4' : 'bg-white p-4'}
        >
          <p className="stat-label">{column.label}</p>
          <p
            className={`tabular mt-1.5 text-xl font-semibold ${
              index === columns.length - 1 ? 'text-brand-800' : 'text-ink-900'
            }`}
          >
            {column.value}
          </p>
          <p className="mt-1 text-xs text-ink-500">{column.hint}</p>
        </div>
      ))}
    </div>
  );
}

/** The nine stages a payment travels, as the sidebar groups them. */
const JOURNEY: Array<{
  step: string;
  name: string;
  who: string;
  tone: 'default' | 'outside' | 'done';
}> = [
  { step: '01', name: 'Intake', who: 'Email or upload', tone: 'default' },
  { step: '02', name: 'Review', who: 'Finance Executive', tone: 'default' },
  { step: '03', name: 'Approval', who: 'Heads, Finance, CFO', tone: 'default' },
  { step: '04', name: 'Accounting', who: 'Verify, deduct TDS', tone: 'default' },
  { step: '05', name: 'Treasury', who: 'Only if escalated', tone: 'default' },
  { step: '06', name: 'Payment batch', who: 'Prepared, then released', tone: 'default' },
  { step: '07', name: 'Your bank', who: 'Outside the platform', tone: 'outside' },
  { step: '08', name: 'Statement', who: 'Uploaded back in', tone: 'default' },
  { step: '09', name: 'Reconciled', who: 'Proven paid', tone: 'done' },
];

function Journey() {
  const style = {
    default: 'border-ink-200 bg-white',
    outside: 'border-dashed border-ink-300 bg-ink-50',
    done: 'border-brand-700 bg-brand-50',
  };

  return (
    <div className="card mb-6 p-4">
      <p className="section-title mb-3">One invoice, or one payroll run, travels this path</p>
      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-9">
        {JOURNEY.map((stage) => (
          <div key={stage.step} className={`rounded-lg border p-2.5 ${style[stage.tone]}`}>
            <span className="tabular text-[10px] font-semibold tracking-[0.1em] text-ink-400">
              {stage.step}
            </span>
            <span
              className={`mt-0.5 block text-sm font-semibold leading-tight ${
                stage.tone === 'done' ? 'text-brand-800' : 'text-ink-900'
              }`}
            >
              {stage.name}
            </span>
            <span className="mt-0.5 block text-xs leading-tight text-ink-500">{stage.who}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The recipes.                                                                */
/* -------------------------------------------------------------------------- */

const RECIPES: Recipe[] = [
  {
    id: 'signing-in',
    number: '01',
    title: 'Sign in and find your way around',
    who: (
      <>
        For <b>everyone</b> · takes a minute
      </>
    ),
    part: 'Getting started',
    audiences: ANYONE,
    body: (
      <Steps>
        <li>
          Open the platform address your administrator gave you. If this is your first time, use the
          invitation link instead — it opens <Ui>/accept-invite</Ui>, where you set your own
          password. The account is not active until you do.
        </li>
        <li>
          Sign in with your work email and password. You land on <Where>Dashboard</Where> — total
          payables, what is overdue, and what is waiting on you.
        </li>
        <li>
          The sidebar is grouped: <b>Operations</b> (invoices through payroll), <b>Treasury</b>{' '}
          (payments, bank, reconciliation), <b>Insights</b> (reports, audit) and{' '}
          <b>Administration</b> (master data).
          <Aside>
            You only see menu items you are allowed to use. A short menu is not a fault — it is your
            role.
          </Aside>
        </li>
        <li>
          If your organisation has more than one company, use the company switcher in the top bar.
          Everything on screen — figures, lists, reports — belongs to the company selected there.
        </li>
        <li>
          Press <Ui>Ctrl K</Ui> (<Ui>⌘K</Ui> on a Mac) anywhere to search invoices, vendors, batches
          and employees, or to jump to a page. Tracking IDs such as <Ui>FIN-INV-2026-000001</Ui> are
          searchable, so quote them in email and on the phone.
        </li>
        <li>
          <Where>Notifications</Where> in the top bar tells you when something arrives for you. Your
          own password is changed under <Where>Account</Where>.
        </li>
      </Steps>
    ),
  },
  {
    id: 'intake',
    number: '02',
    title: 'Get an invoice into the system',
    who: (
      <>
        For <b>Finance Executive</b>, <b>Admin</b> · two ways in
      </>
    ),
    part: 'A vendor invoice, start to finish',
    audiences: ['EXEC', 'ADMIN'],
    link: { to: '/invoices', label: 'Open Invoices', permissions: ['invoice:read'] },
    body: (
      <>
        <p className="mb-3 text-sm text-ink-700">
          <b>By email — nothing to do.</b> Vendors send invoices to your monitored mailbox. The
          platform pulls them in, saves the attachment, reads the fields and drops the invoice into
          the review queue on its own. Watch it happen on <Where>Invoice Mailbox</Where>: connection
          status, the last sync, and every email pulled with what happened to it. <Ui>Sync now</Ui>{' '}
          forces a check instead of waiting.
        </p>
        <p className="mb-3 text-sm text-ink-700">
          <b>By hand — when someone hands you a PDF.</b>
        </p>
        <Steps>
          <li>
            Go to <Where>Invoices</Where> and click <Ui>Upload invoice</Ui>.
          </li>
          <li>Choose a PDF, JPG or PNG. Extraction starts by itself.</li>
          <li>
            The invoice appears under the <Ui>Needs review</Ui> tab once its fields have been read —
            usually within seconds.
          </li>
        </Steps>
        <Note>
          <b>Nothing is trusted yet.</b> Extraction is a first draft. No invoice moves anywhere
          until a person reviews it in recipe 03.
        </Note>
      </>
    ),
  },
  {
    id: 'review',
    number: '03',
    title: 'Review an invoice and submit it for approval',
    who: (
      <>
        For <b>Finance Executive</b> · the most-used screen in the product
      </>
    ),
    part: 'A vendor invoice, start to finish',
    audiences: ['EXEC'],
    link: { to: '/invoices/review', label: 'Open the review queue', permissions: ['invoice:read'] },
    body: (
      <>
        <Steps>
          <li>
            <Where>Invoices → Needs review</Where>, then click the invoice.
          </li>
          <li>
            The document sits on the left; the fields read from it sit on the right, each marked
            with the confidence it was read at. <b>Check the low-confidence ones first</b> — that is
            what the marking is for. Amounts and tax are the usual suspects.
          </li>
          <li>
            Correct anything wrong by typing over it, then <Ui>Save changes</Ui>. If the document
            was misread from end to end, <Ui>Re-run extraction</Ui> reads it again and discards your
            corrections.
          </li>
          <li>
            Read the findings panel. Warnings you can proceed past; blocking findings — a suspected
            duplicate, a vendor with no bank account — must be resolved first, and{' '}
            <Ui>Submit for approval</Ui> stays disabled until they are.
          </li>
          <li>
            Click <Ui>Submit for approval</Ui>. The amount decides the ladder: the invoice is routed
            to the approvers your rules name, and gets an approval reference of its own.
          </li>
        </Steps>
        <Note tone="stop">
          <b>You cannot approve what you submitted.</b> At any level, at any amount. If you are also
          an approver, someone else has to take this one.
        </Note>
      </>
    ),
  },
  {
    id: 'approve',
    number: '04',
    title: 'Approve or reject what is waiting on you',
    who: (
      <>
        For <b>Vertical Head</b>, <b>Approver</b>, <b>Finance Manager</b>, <b>CFO</b> · under a
        minute each
      </>
    ),
    part: 'A vendor invoice, start to finish',
    audiences: ['APPROVER'],
    link: {
      to: '/approvals',
      label: 'Open Approvals',
      permissions: ['approval:read', 'approval:read_all'],
    },
    body: (
      <>
        <Steps>
          <li>
            <Where>Approvals → Waiting on me</Where>. The list shows the item, the amount, the level
            it is at, and how long it has been waiting.
          </li>
          <li>
            Open one. You get the full approval chain — every level, who holds it, and who has
            already decided — beside the invoice or payroll figures.
          </li>
          <li>
            Add a comment. Optional when approving; write one when rejecting, because it is what the
            preparer will act on.
          </li>
          <li>
            <Ui>Approve</Ui> passes it to the next level. <Ui>Reject</Ui> ends the chain there.
          </li>
        </Steps>
        <Note tone="warn">
          <b>Levels activate in order.</b> If a step below you has not decided yet, your buttons are
          inactive — that is the ladder working, not an error. Chase the name shown as holding it.
        </Note>
        <Note>
          <b>Approving is not paying.</b> A fully approved invoice goes to the accounting team next,
          not into the payment queue. See recipe 05.
        </Note>
      </>
    ),
  },
  {
    id: 'verify',
    number: '05',
    title: 'Verify an approved invoice and deduct TDS',
    who: (
      <>
        For the <b>Accounting Team</b> · where gross becomes net
      </>
    ),
    part: 'A vendor invoice, start to finish',
    audiences: ['ACCOUNTS'],
    link: { to: '/accounting', label: 'Open Accounting', permissions: ['invoice:verify'] },
    body: (
      <>
        <Steps>
          <li>
            <Where>Accounting → To verify</Where> lists everything that has cleared business
            approval.
          </li>
          <li>
            Open one. You see gross billed, TDS withheld and net payable side by side, and the
            invoice document behind them.
          </li>
          <li>
            Set <Ui>Deduct TDS</Ui> to <b>Yes</b> where tax applies, choose the section (194J, 194C
            and so on) and the rate. The figures update as you type; net payable is what will
            actually leave the bank.
          </li>
          <li>Add the GL code and any accounting notes.</li>
          <li>
            Then take one of three actions:
            <Bullets>
              <li>
                <Ui>Verify &amp; release for payment</Ui> — the invoice becomes a payment obligation
                and joins the payment queue.
              </li>
              <li>
                <Ui>Escalate to Treasury</Ui> — pick <b>Priority 1</b> or <b>Priority 2</b> and
                write remarks. It goes to Treasury for a decision (recipe 06).
              </li>
              <li>
                <Ui>Return for correction</Ui> — back to the preparer, with your remarks attached.
              </li>
            </Bullets>
          </li>
        </Steps>
        <p className="mt-3 text-sm text-ink-700">
          Remarks are required when you escalate or return, so the next person is not left guessing.
        </p>
        <GrossToNet />
        <Note>
          <b>Two numbers, not a discrepancy.</b> Invoice screens show gross; payment and cash
          screens show net. The gap between them is the tax you withheld.
        </Note>
      </>
    ),
  },
  {
    id: 'treasury',
    number: '06',
    title: 'Decide a Treasury request',
    who: (
      <>
        For the <b>Treasury team</b> · only for escalated invoices
      </>
    ),
    part: 'A vendor invoice, start to finish',
    audiences: ['TREASURY', 'ACCOUNTS'],
    link: {
      to: '/finance-requests',
      label: 'Open Treasury Requests',
      permissions: ['finance_request:read', 'finance_request:read_all'],
    },
    body: (
      <>
        <Steps>
          <li>
            <Where>Treasury Requests → Waiting on me</Where>.
          </li>
          <li>
            Open the request. You get the gross / TDS / net breakdown, the priority, and the remark
            thread explaining why accounting escalated it.
          </li>
          <li>
            Write your remarks, then choose:
            <Bullets>
              <li>
                <Ui>Approve for payment</Ui> — clears it into the payment queue.
              </li>
              <li>
                <Ui>Return to accounting</Ui> — sends it back for rework.
              </li>
              <li>
                <Ui>Reject</Ui> — stops it for good.
              </li>
            </Bullets>
          </li>
        </Steps>
        <Note tone="stop">
          <b>Whoever raised the request cannot decide it.</b> If you escalated it yourself, a
          colleague in Treasury has to take the decision.
        </Note>
      </>
    ),
  },
  {
    id: 'payroll',
    number: '07',
    title: 'Import a payroll run and get it approved',
    who: (
      <>
        For <b>Payroll User</b>, then <b>Finance Manager</b> and <b>CFO</b>
      </>
    ),
    part: 'Payroll',
    audiences: ['PAYROLL', 'APPROVER'],
    link: { to: '/payroll', label: 'Open Payroll', permissions: ['payroll:read'] },
    body: (
      <>
        <Steps>
          <li>
            <Where>Payroll → Import</Where>, and upload the finalised salary file from HR (Excel).
          </li>
          <li>
            Click <Ui>Validate file</Ui>. <b>Nothing is written yet.</b> You get the headcount, the
            total net payroll, the split by location, the rows with errors, and the columns the
            platform detected.
          </li>
          <li>
            Check <Where>Detected columns</Where>. If a column was mapped wrongly — net salary read
            as gross, say — fix the mapping here, before importing. Sample rows below show exactly
            what will be created.
          </li>
          <li>
            <Ui>Import</Ui> creates the batch, then submit it for approval.
          </li>
          <li>
            Approvers open it from <Where>Approvals</Where> and see the total, the headcount and the
            movement against last month — <b>not</b> individual salaries.
          </li>
          <li>
            On final approval the batch fans out into one payment per employee, which join the same
            payment queue vendor invoices use.
          </li>
        </Steps>
        <Note>
          <b>Salary detail stays inside payroll.</b> In the payment queue, payroll shows as a single
          aggregated line. Colleagues without payroll access see the total and never the names.
        </Note>
      </>
    ),
  },
  {
    id: 'batch',
    number: '08',
    title: 'Build a payment batch',
    who: (
      <>
        For <b>Finance Executive</b> (prepares) · the maker half of maker–checker
      </>
    ),
    part: 'Paying, and proving it',
    audiences: ['EXEC', 'APPROVER'],
    link: { to: '/payments', label: 'Open Payment Queue', permissions: ['obligation:read'] },
    body: (
      <Steps>
        <li>
          <Where>Payment Queue</Where> lists everything cleared for payment. Filter by <b>Vendor</b>{' '}
          or <b>Payroll</b>, or narrow to what is due.
        </li>
        <li>
          Tick the payments to pay together. Anything not ready yet can be put <Ui>On hold</Ui> with
          a reason instead.
        </li>
        <li>
          Click <Ui>Create batch</Ui> and fill in three things: the <b>payment date</b>, the{' '}
          <b>debit account</b> to pay from, and any notes.
          <Aside>
            The account you choose decides the bank file format — HDFC, ICICI and so on. Choose the
            account the money is actually leaving.
          </Aside>
        </li>
        <li>
          The batch is created in <StatusBadge status="DRAFT" /> and appears under{' '}
          <Where>Payment Batches</Where>. Open it to check the beneficiary list, account numbers and
          IFSC codes. A wrong line can still be removed here.
        </li>
      </Steps>
    ),
  },
  {
    id: 'release',
    number: '09',
    title: 'Release the bank file',
    who: (
      <>
        For <b>Finance Manager</b> and above · the checker half
      </>
    ),
    part: 'Paying, and proving it',
    audiences: ['APPROVER', 'EXEC'],
    link: {
      to: '/payments/batches',
      label: 'Open Payment Batches',
      permissions: ['payment_batch:read'],
    },
    body: (
      <>
        <Steps>
          <li>
            <Where>Payment Batches</Where>, open the draft batch, and check the totals against what
            you expected.
          </li>
          <li>
            <Ui>Generate bank file</Ui>, then <Ui>Download bank file</Ui>. The file is in your
            bank&rsquo;s own upload format.
          </li>
          <li>
            Upload it in your bank portal and authorise it there.{' '}
            <b>That step happens in the bank, not here.</b>
          </li>
          <li>
            The batch moves to <StatusBadge status="PROCESSING" /> — with the bank, waiting for the
            debit to appear on a statement.
          </li>
        </Steps>
        <Note tone="stop">
          <b>The person who built the batch cannot release it.</b> If the export is refused, that is
          maker–checker working as designed. Ask a colleague with release rights.
        </Note>
      </>
    ),
  },
  {
    id: 'statement',
    number: '10',
    title: 'Upload a bank statement',
    who: (
      <>
        For <b>Finance Executive</b> · usually daily
      </>
    ),
    part: 'Paying, and proving it',
    audiences: ['EXEC', 'APPROVER'],
    link: {
      to: '/banking/statements',
      label: 'Open Bank Statements',
      permissions: ['bank_statement:read'],
    },
    body: (
      <Steps>
        <li>Download the statement from your bank portal.</li>
        <li>
          <Where>Bank Statements → Upload statement</Where>, pick the account it belongs to, and
          upload.
        </li>
        <li>
          You get a summary: lines read, lines imported, and duplicates skipped.
          <Aside>
            Re-uploading an overlapping period is safe — lines already imported are recognised and
            skipped, not doubled.
          </Aside>
        </li>
        <li>
          Every line is then visible on <Where>Bank Transactions</Where>, searchable by narration,
          reference or UTR.
        </li>
      </Steps>
    ),
  },
  {
    id: 'reconcile',
    number: '11',
    title: 'Reconcile a payment — the only way to reach PAID',
    who: (
      <>
        For <b>Finance Executive</b>, <b>Finance Manager</b> · the last mile
      </>
    ),
    part: 'Paying, and proving it',
    audiences: ['EXEC', 'APPROVER'],
    link: {
      to: '/reconciliation',
      label: 'Open Reconciliation',
      permissions: ['reconciliation:read'],
    },
    body: (
      <>
        <Steps>
          <li>
            <Where>Reconciliation</Where>. Four tabs, each with a count: <Ui>Suggested</Ui>,{' '}
            <Ui>Unmatched</Ui>, <Ui>Matched</Ui>, <Ui>Ignored</Ui>. Start with Suggested.
          </li>
          <li>
            Each suggestion shows the bank line against the payment we made, and the{' '}
            <b>signals behind the score</b> — amount, beneficiary name against the narration, how
            close the dates are, and whether our reference appears in the narration.
          </li>
          <li>
            Read the signals, not the score. If it is right, <Ui>Confirm match</Ui>. The invoice
            becomes <StatusBadge status="RECONCILED" />, the vendor gets a payment confirmation, and
            the batch&rsquo;s reconciled total goes up.
          </li>
          <li>
            On <Ui>Unmatched</Ui>, use <Ui>Find a payment</Ui> to link a line by hand, or{' '}
            <Ui>Ignore</Ui> lines that are not ours — bank charges, interest, receipts — with a
            reason.
          </li>
        </Steps>
        <Note>
          <b>There is no &ldquo;mark as paid&rdquo; button, anywhere.</b> A payment reaches PAID
          only by being matched to a real bank transaction, because the statement is the evidence
          that money moved. If you cannot find the line, the money has not left yet.
        </Note>
        <Note tone="warn">
          <b>A matching amount alone is never enough.</b> Two vendors billing the same round figure
          in one batch is ordinary, so the platform refuses to suggest on amount alone, and refuses
          to choose between two close candidates. Those land in Unmatched for you to decide.
        </Note>
      </>
    ),
  },
  {
    id: 'reports',
    number: '12',
    title: 'Run a report and export it to Excel',
    who: (
      <>
        For <b>anyone with report access</b>
      </>
    ),
    part: 'Seeing the whole position',
    audiences: ANYONE,
    link: { to: '/reports', label: 'Open Reports', permissions: ['report:read'] },
    body: (
      <>
        <Steps>
          <li>
            <Where>Reports</Where>. Pick one from the list on the left; each says what it covers.
          </li>
          <li>
            Set the filters it offers — date range, vertical, location, vendor. Results appear on
            screen as you change them.
          </li>
          <li>
            <Ui>Export to Excel</Ui> downloads the full result, not just the rows on screen.
          </li>
        </Steps>
        <div className="mt-4">
          <Table>
            <thead className="thead">
              <tr>
                <th className="th">Report</th>
                <th className="th">Answers</th>
              </tr>
            </thead>
            <tbody className="tbody">
              {[
                ['Invoice Register', 'Every invoice received, with status, gross, TDS and net'],
                ['Pending Approval', 'What is waiting, who is holding it, and for how long'],
                ['Accounts Payable Ageing', 'Open payables bucketed by how overdue they are'],
                ['Payment Queue', 'Approved payments waiting to be batched'],
                [
                  'Payment Batch Report / Detail',
                  'What each batch contained and how much reconciled',
                ],
                ['Payroll Payment Report', 'Payroll batches, totals and payment status'],
                ['Bank Transaction Report', 'Imported lines and their reconciliation state'],
                ['Reconciliation Report', 'Confirmed matches, their confidence, and who confirmed'],
                [
                  'Consolidated Payables',
                  'Flat, pivot-ready sheet with every dimension — the one to hand your filing agent',
                ],
                ['Audit Report', 'Every recorded action, with who and when'],
              ].map(([name, answers]) => (
                <tr key={name} className="trow">
                  <td className="td font-semibold text-ink-900">{name}</td>
                  <td className="td whitespace-normal">{answers}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
        <Note>
          <b>For TDS filing:</b> Consolidated Payables carries the section, rate and amount per
          invoice, plus a summary totalled by company and vertical. The platform deducts and records
          TDS; challans, returns and certificates stay with your filing agent.
        </Note>
      </>
    ),
  },
  {
    id: 'audit',
    number: '13',
    title: 'Answer “who did this, and when?”',
    who: (
      <>
        For <b>anyone</b>; complete for <b>Auditors</b>
      </>
    ),
    part: 'Seeing the whole position',
    audiences: ANYONE,
    link: { to: '/audit', label: 'Open Audit Trail', permissions: ['audit:read'] },
    body: (
      <>
        <Steps>
          <li>
            For one invoice or batch, open it and read the audit trail on the record itself — every
            step, in order, with the person&rsquo;s name against it.
          </li>
          <li>
            For a broader question, use <Where>Audit Trail</Where> and filter by entity type, user
            or date.
          </li>
        </Steps>
        <Note>
          <b>Audit records cannot be edited or deleted</b> — not by an administrator, not by anyone.
          Every status change stores what it was before and what it became.
        </Note>
      </>
    ),
  },
  {
    id: 'users',
    number: '14',
    title: 'Add a user and give them the right access',
    who: (
      <>
        For <b>Company Admin</b>, <b>Platform Admin</b>
      </>
    ),
    part: 'Administration',
    audiences: ['ADMIN'],
    link: { to: '/settings/users', label: 'Open Users', permissions: ['user:read'] },
    body: (
      <>
        <Steps>
          <li>
            <Where>Users → Add</Where>. Enter name and work email. <b>You do not set a password</b>{' '}
            — you never see theirs.
          </li>
          <li>Give them one or more roles. Holding two roles grants the sum of both.</li>
          <li>
            Optionally scope them: to a company, region, vertical, location or department.{' '}
            <b>Leaving an axis empty means unrestricted on that axis</b> — that is how a group-level
            user reaches everything.
          </li>
          <li>
            Save, then <Ui>Copy link</Ui> and send the one-time invitation to the person. They set
            their own password, which activates the account.
          </li>
          <li>
            When someone leaves, <Ui>Deactivate</Ui> them. Never delete — the audit trail refers to
            them by name.
          </li>
        </Steps>
        <p className="mt-3 text-sm text-ink-700">
          Need a role the built-in eight do not cover — an AP clerk, a read-only regional
          controller? <Where>Roles → Create role</Where>, tick the permissions, and it is enforced
          exactly like a built-in one.
        </p>
        <Note tone="warn">
          <b>Payroll access is deliberately separate.</b> Granting invoice permissions never grants
          payroll ones, and a business unit marked <b>classified</b> stays invisible unless a user
          is granted it by name — holding the vertical above it is not enough.
        </Note>
      </>
    ),
  },
  {
    id: 'approval-rules',
    number: '15',
    title: 'Change who approves what',
    who: (
      <>
        For <b>Company Admin</b>, <b>Platform Admin</b> · test before you save
      </>
    ),
    part: 'Administration',
    audiences: ['ADMIN'],
    link: {
      to: '/settings/approvals',
      label: 'Open Approval Rules',
      permissions: ['approval_rule:read'],
    },
    body: (
      <>
        <Steps>
          <li>
            <Where>Approval Rules</Where>. Each rule covers an amount band — under ₹1L, ₹1L to ₹10L,
            above ₹10L — and lists its levels in order.
          </li>
          <li>
            <Ui>New rule</Ui>, or open one to edit. A level can name a <b>role</b>, a{' '}
            <b>specific person</b>, or a <b>position</b> such as department head or vertical head,
            which resolves through your master data as heads change.
          </li>
          <li>
            Before saving, use <Ui>Test a rule</Ui>: enter an amount and see exactly who would be
            asked to approve it, in order. Answer the question on screen rather than on a live
            invoice.
          </li>
          <li>
            <Ui>Save rule</Ui>. It applies to invoices submitted from that point on; anything
            already in a chain keeps the ladder it started with.
          </li>
        </Steps>
        <Note>
          <b>Vacant positions do not strand invoices.</b> A vertical with no head falls back to
          whoever holds the Vertical Head role.
        </Note>
      </>
    ),
  },
  {
    id: 'master-data',
    number: '16',
    title: 'Add vendors, bank accounts and org structure',
    who: (
      <>
        For <b>Company Admin</b> · the master data everything else depends on
      </>
    ),
    part: 'Administration',
    audiences: ['ADMIN', 'EXEC'],
    link: { to: '/settings/vendors', label: 'Open Vendors', permissions: ['vendor:read'] },
    body: (
      <>
        <Bullets>
          <li>
            <b>Vendors</b> — name, PAN, GSTIN, default TDS section, and bank details.{' '}
            <b>A vendor with no bank account can be approved but never paid</b>; that shows as a
            blocking finding on the invoice, so add the account here.
          </li>
          <li>
            <b>Bank Accounts</b> — your own accounts, each with its bank and file format. This is
            the list the debit-account dropdown reads when a batch is created.
          </li>
          <li>
            <b>Companies, Groups, Regions, Verticals, Business Units, Locations, Departments</b> —
            the structure invoices are filed under, and the axes every report and access scope uses.
            Set it up before onboarding people, because filters and scopes point at it.
          </li>
        </Bullets>
        <p className="text-sm text-ink-500">
          Every one of these screens works the same way: a searchable list, <Ui>Add</Ui> to create,{' '}
          <Ui>Edit</Ui> on a row to change.
        </p>
      </>
    ),
  },
  {
    id: 'house-rules',
    number: 'A',
    title: 'Rules of the house',
    who: <>Six refusals worth knowing before you meet them</>,
    part: 'Reference',
    audiences: ANYONE,
    body: (
      <>
        <Table>
          <thead className="thead">
            <tr>
              <th className="th">The rule</th>
              <th className="th">Why it is there</th>
            </tr>
          </thead>
          <tbody className="tbody">
            {[
              [
                'No “mark as paid” button',
                'PAID is reachable only by matching a real bank transaction. The statement is the evidence.',
              ],
              [
                'You cannot approve your own item',
                'At every level, at every amount, invoices and payroll alike.',
              ],
              [
                'Approval is not permission to pay',
                'Approved invoices go to accounting for verification and TDS first.',
              ],
              [
                'The preparer cannot release the bank file',
                'Maker–checker. One person builds the batch, another exports it.',
              ],
              [
                'Whoever raises a Treasury request cannot decide it',
                'The escalation and the decision are two people.',
              ],
              [
                'Payroll and invoice access are separate',
                'Salary detail is invisible to the rest of the finance team by design.',
              ],
            ].map(([rule, why]) => (
              <tr key={rule} className="trow">
                <td className="td whitespace-normal font-semibold text-ink-900">{rule}</td>
                <td className="td whitespace-normal">{why}</td>
              </tr>
            ))}
          </tbody>
        </Table>
        <p className="mt-4 text-sm text-ink-700">
          Amounts are held to the paisa and shown in Indian grouping —{' '}
          <span className="tabular">₹35,40,000.00</span>, or{' '}
          <span className="tabular">₹6.20 Cr</span> where space is short. Every tracked record
          carries a reference you can quote: invoices <Ui>FIN-INV-2026-000001</Ui>, approvals{' '}
          <Ui>APR-2026-…</Ui>, Treasury requests <Ui>FR-2026-…</Ui>, reconciliations{' '}
          <Ui>REC-2026-…</Ui>, batches <Ui>PB-20260908-001</Ui>. Numbering restarts each January.
        </p>
      </>
    ),
  },
  {
    id: 'statuses',
    number: 'B',
    title: 'What each status means',
    who: <>Read down the column to see where an invoice has got to</>,
    part: 'Reference',
    audiences: ANYONE,
    body: (
      <>
        <Table>
          <thead className="thead">
            <tr>
              <th className="th">Status</th>
              <th className="th">Meaning</th>
              <th className="th">Who moves it next</th>
            </tr>
          </thead>
          <tbody className="tbody">
            {[
              ['RECEIVED', 'Arrived, not yet read', 'Nobody — automatic'],
              ['REVIEW_REQUIRED', 'Fields read; a person must check them', 'Finance Executive'],
              ['PENDING_APPROVAL', 'In the approval ladder', 'The approver named on it'],
              [
                'ACCOUNTING_VERIFICATION',
                'Approved; awaiting verification and TDS',
                'Accounting team',
              ],
              ['TREASURY_APPROVAL', 'Escalated; awaiting a Treasury decision', 'Treasury'],
              ['PAYMENT_PENDING', 'Cleared, waiting in the payment queue', 'Finance Executive'],
              ['PAYMENT_BATCHED', 'In a batch, not yet sent to the bank', 'Finance Manager'],
              ['PAYMENT_PROCESSING', 'With the bank', 'The bank, then the statement'],
              ['RECONCILED', 'Matched to a real bank debit — done', 'Nobody'],
              ['REJECTED', 'Turned down in approval', 'Ended'],
              ['DUPLICATE', 'The same invoice already exists', 'Ended'],
              ['CANCELLED', 'Withdrawn by finance', 'Ended'],
              ['FAILED', 'The payment did not go through', 'Finance Executive — re-queue it'],
            ].map(([status, meaning, next]) => (
              <tr key={status} className="trow">
                <td className="td">
                  <StatusBadge status={status} />
                </td>
                <td className="td whitespace-normal">{meaning}</td>
                <td className="td whitespace-normal">{next}</td>
              </tr>
            ))}
          </tbody>
        </Table>
        <p className="mt-4 text-sm text-ink-700">
          Payment batches run <StatusBadge status="DRAFT" /> → <StatusBadge status="EXPORTED" /> →{' '}
          <StatusBadge status="PROCESSING" /> → <StatusBadge status="PARTIALLY_RECONCILED" /> →{' '}
          <StatusBadge status="RECONCILED" />. Payroll batches follow the invoice pattern, from{' '}
          <StatusBadge status="IMPORTED" /> to <StatusBadge status="RECONCILED" />.
        </p>
      </>
    ),
  },
  {
    id: 'stuck',
    number: 'C',
    title: 'When something is stuck',
    who: <>The refusals you are most likely to meet, and what to do</>,
    part: 'Reference',
    audiences: ANYONE,
    body: (
      <Table>
        <thead className="thead">
          <tr>
            <th className="th">What you see</th>
            <th className="th">What it means</th>
            <th className="th">What to do</th>
          </tr>
        </thead>
        <tbody className="tbody">
          {[
            [
              'Submit button is greyed out',
              'Blocking findings on the invoice',
              'Resolve the findings listed below the fields, then submit',
            ],
            [
              'Approve and Reject are inactive',
              'An earlier level has not decided, or the item is yours',
              'Check the chain — it names who is holding it',
            ],
            [
              'Approved, but not in the payment queue',
              'It is with accounting, not with you',
              'Accounting must verify and release it (recipe 05)',
            ],
            [
              'Export refused on a batch you built',
              'Maker–checker',
              'Ask a colleague with release rights to export it',
            ],
            [
              'An approved invoice will not batch',
              'The vendor has no bank account on file',
              'Add the account under Vendors, then retry',
            ],
            [
              'Nothing suggested for a bank debit',
              'Amount alone never suggests a match',
              'Link it by hand on the Unmatched tab',
            ],
            [
              '“You do not have permission” on a filter',
              'You asked for a unit outside your scope',
              'Clear the filter, or ask an admin to widen your scope',
            ],
            [
              'A menu item you expect is missing',
              'Your role does not include it',
              'Ask an admin — the menu only shows what you may use',
            ],
            [
              'An emailed invoice never arrived',
              'The mailbox sync, or a routing rule',
              'Invoice Mailbox shows every email pulled and why one was skipped; Sync now forces a check',
            ],
            [
              'A new user cannot sign in',
              'Invited, not yet activated',
              'They must open the invitation link and set a password',
            ],
          ].map(([seen, means, todo]) => (
            <tr key={seen} className="trow">
              <td className="td whitespace-normal font-medium text-ink-900">{seen}</td>
              <td className="td whitespace-normal">{means}</td>
              <td className="td whitespace-normal">{todo}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    ),
  },
];

/* -------------------------------------------------------------------------- */

/** The handbook — `/cookbook`. */
export function CookbookPage() {
  const { canAny } = useAuth();
  const [params, setParams] = useSearchParams();

  const filter = (params.get('role') as Filter | null) ?? 'ALL';
  const active = FILTERS.some((entry) => entry.key === filter) ? filter : 'ALL';

  const visible = RECIPES.filter((recipe) => active === 'ALL' || recipe.audiences.includes(active));

  const select = (key: Filter) => {
    const merged = new URLSearchParams(params);
    if (key === 'ALL') merged.delete('role');
    else merged.set('role', key);
    setParams(merged);
  };

  return (
    <>
      <PageHeader
        title="Cookbook"
        subtitle="Every task in the platform, written as a recipe — where to click, what you will see, and what the platform will stop you doing"
      />

      <Journey />

      {/* The filter narrows the book to one person's job; it is in the URL so a
          trainer can send "the payroll half" as a link. */}
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <span className="section-title mb-0 mr-1">Show recipes for</span>
        {FILTERS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            aria-pressed={active === entry.key}
            onClick={() => select(entry.key)}
            className={
              active === entry.key
                ? 'btn bg-brand-700 px-3.5 py-1.5 text-xs text-white hover:bg-brand-800'
                : 'btn border border-ink-200 bg-white px-3.5 py-1.5 text-xs text-ink-600 hover:border-ink-300 hover:bg-ink-50'
            }
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-4">
        <div className="lg:col-span-1">
          <div className="card sticky top-6 hidden lg:block">
            <div className="panel-head">
              <h2 className="font-semibold">Recipes</h2>
            </div>
            <ul className="divide-y divide-ink-100">
              {visible.map((recipe) => (
                <li key={recipe.id}>
                  <a
                    href={`#${recipe.id}`}
                    className="flex gap-2.5 px-4 py-2.5 text-sm text-ink-600 transition hover:bg-brand-50/60 hover:text-brand-800"
                  >
                    <span className="tabular pt-px text-xs font-semibold text-ink-400">
                      {recipe.number}
                    </span>
                    <span>{recipe.title}</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="space-y-6 lg:col-span-3">
          {visible.length === 0 ? (
            <div className="card">
              <EmptyState
                illustration="no-documents"
                title="No recipes for that role"
                hint="Choose Everyone to see the whole handbook."
              />
            </div>
          ) : (
            PARTS.map((part) => {
              const inPart = visible.filter((recipe) => recipe.part === part);
              if (inPart.length === 0) return null;

              return (
                <section key={part}>
                  <h2 className="section-title border-t border-ink-200 pt-4">{part}</h2>

                  <div className="space-y-4">
                    {inPart.map((recipe) => (
                      <article
                        key={recipe.id}
                        id={recipe.id}
                        className="card scroll-mt-6 p-5 sm:p-6"
                      >
                        <div className="mb-1 flex flex-wrap items-baseline gap-3">
                          <span className="tabular text-sm font-semibold text-brand-700">
                            {recipe.number}
                          </span>
                          <h3 className="text-lg font-semibold tracking-tight text-ink-900">
                            {recipe.title}
                          </h3>
                        </div>
                        <p className="mb-4 text-sm text-ink-500">{recipe.who}</p>

                        {recipe.body}

                        {recipe.link && canAny(...recipe.link.permissions) ? (
                          <div className="mt-5">
                            <Link className="btn-secondary" to={recipe.link.to}>
                              {recipe.link.label}
                            </Link>
                          </div>
                        ) : null}
                      </article>
                    ))}
                  </div>
                </section>
              );
            })
          )}

          <p className="border-t border-ink-200 pt-4 text-xs text-ink-500">
            Screen names, tabs and buttons quoted here match the product exactly, so you can search
            for them with <Ui>Ctrl K</Ui>. If a screen in front of you differs from a recipe, trust
            the screen and tell your administrator.
          </p>
        </div>
      </div>
    </>
  );
}
