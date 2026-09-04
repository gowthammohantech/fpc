# Elixir Finance Ops

A money-out workflow platform for finance teams. It owns the path an invoice
or a payroll run takes from arrival to proven payment: intake, extraction,
validation, approval, payment preparation, bank reconciliation, and audit.

The problem it replaces is the usual chain of email → PDF → Excel → approvals
→ Excel → bank portal → statement → reconciliation, which loses invoices,
duplicates payments, hides who is holding an approval, and leaves the CFO
dependent on the finance team for basic answers.

## The idea

Vendor invoices and payroll are not separate systems here. Both converge on a
single **payment obligation**, and everything downstream is shared:

```
  Vendor invoice          Payroll import
        │                       │
        └──────────┬────────────┘
                   ▼
               Approval
                   ▼
          Payment obligation
                   ▼
            Payment queue
                   ▼
            Payment batch
                   ▼
              Bank file  ──────►  [ bank, outside the platform ]
                                            │
                   ┌────────────────────────┘
                   ▼
             Bank statement
                   ▼
            Reconciliation
                   ▼
                 PAID
                   ▼
           Audit / reports
```

One consequence is worth stating up front: **there is no "mark as paid"
button anywhere in the product.** `PAID` is reachable only by confirming a
match against a real bank transaction, because the statement is the evidence
that money actually moved.

## Getting started

Requirements: Node 20.12+, pnpm, and Docker (or any MongoDB).

```bash
pnpm install
cp .env.example .env

docker compose up -d          # MongoDB, plus Mailpit on http://localhost:8025
pnpm build                    # required first — see note below
pnpm seed                     # demo data and the demo input files
pnpm dev                      # API on :4000, web on :5173
```

Workspace packages are consumed through their built output, so `pnpm build`
must run before anything else on a fresh checkout. `pnpm test` and
`pnpm typecheck` build the shared packages themselves, so those two work
directly.

Open http://localhost:5173 and sign in. Every account below uses the password
`FinanceOps@2026`:

| Sign in as | Role | What it demonstrates |
|---|---|---|
| `ravi@nova.example.com` | Finance Executive | Prepares work; cannot approve, cannot see payroll |
| `ithead@nova.example.com` | Approver | First approver on the large invoice |
| `opshead@nova.example.com` | Approver | Operations Head, first approver on the Pune chain |
| `financemanager@nova.example.com` | Finance Manager | Finance Head in the chain; releases bank files |
| `cfo@nova.example.com` | CFO | Final approver, sees payroll and the full position |
| `payroll@nova.example.com` | Payroll User | Payroll only, no invoice access |
| `auditor@nova.example.com` | Auditor | Read-only, including the audit trail |
| `admin@nova.example.com` | Platform Admin | Everything |
| `companyadmin@nova.example.com` | Company Admin | Master data and users |
| `apclerk@nova.example.com` | AP Clerk *(tenant role)* | A role the tenant defined for itself, enforced like any built-in |
| `treasury@nova.example.com` | Treasury Viewer + Auditor | Two roles at once; grants are the union |
| `chennai.ap@nova.example.com` | Finance Executive | Scoped to one location, so the filter is applied rather than offered |
| `techfinance@nova.example.com` | Finance Manager | Nova Technologies, the second company |
| `techapprover@nova.example.com` | Approver | Head of the Nova Technologies engineering department |
| `techpayroll@nova.example.com` | Payroll User | Nova Technologies payroll |

Two more accounts exist and deliberately **cannot** sign in:
`joining@nova.example.com` is invited but not yet activated, and
`suspended@nova.example.com` is suspended — kept because the audit trail
refers to it.

New accounts are created without a password and are **invited** rather than
active: the administrator gets a one-time link, and the recipient sets their
own password at `/accept-invite`, which activates the account. An invited
account cannot sign in until that happens.

Nothing external is required to run any of this: blob storage, the invoice
mailbox and document extraction all default to local drivers.

### What else the seed leaves behind

The two demos below are the point of the dataset, but the rest of it exists so
that no screen opens empty. On a fresh `pnpm seed` you also get:

- **A second company.** Nova Technologies has its own vendors, its own
  two-tier approval ladder, invoices and payroll, so the company switcher
  leads somewhere rather than to a blank app.
- **Two tenant-defined roles**, one of them held by a real user, alongside the
  eight built-ins on Settings → Roles.
- **Every reconciliation tab populated** — matched, suggested, unmatched and
  ignored — from a statement the seeded matcher actually scored.
- **Payment batches resting in each status the product leaves them in**: draft,
  with the bank, partially reconciled, and fully reconciled.
- **Payroll history.** Last month's run is carried all the way through —
  approved, fanned out to one obligation per employee, paid by bank file and
  reconciled — which is where the CFO's month-on-month figure comes from. This
  is most of the seed's runtime; `pnpm seed -- --skip-payroll-history` omits it.
- **Invoices in every terminal state** (rejected, duplicate, cancelled, failed),
  each with the findings that put them there, plus one approved invoice that
  cannot be paid because its vendor has no bank account on file.
- **A real PDF behind every invoice**, so the review screen's document pane has
  something to show, and an attributed audit trail and notification list.

`apps/server/src/seed/coverage.integration.test.ts` asserts that coverage, so a
new status cannot quietly go unseeded. It also records the handful of enum
values the product has no way to rest in, with the reason for each.

## Demo: a vendor invoice, end to end

The seed leaves **INV-9821 from TechZone for ₹35,40,000** waiting in the
review queue, so the demo walks it through rather than showing a finished
state.

1. **Review** — as `ravi`, open Invoices → Needs review → INV-9821. The
   document sits beside the extracted fields, each with the confidence it was
   read at; the tax amount is deliberately low-confidence so there is
   something to verify.
2. **Submit** — ₹35.4L is above ₹10L, so the seeded rules route it through
   three approvers. Try approving it as `ravi` first: the submitter cannot
   approve their own invoice.
3. **Approve** — sign in as `ithead`, then `financemanager`, then `cfo`. Each
   step activates only in order.
4. **Pay** — as `ravi`, Payment Queue → select TechZone → create a batch.
   Try to export it as `ravi`: maker–checker refuses. Export as
   `financemanager` and download the HDFC-format file.
5. **Reconcile** — Bank Statements → upload
   `apps/server/fixtures/statements/HDFC-Statement.xlsx`. The ₹35.4L debit is
   suggested against the payment, with the individual signals shown. Confirm
   it.
6. **Confirm the result** — the invoice is now `RECONCILED`, the vendor's
   payment confirmation is in Mailpit at http://localhost:8025, and the audit
   trail on the invoice shows every step and who took it.

### Email intake

`pnpm seed` also writes `apps/server/fixtures/inbox/INV-9930.pdf`. Copying a
file into that directory is, from the platform's point of view, identical to
a vendor emailing it: the poller picks it up within a minute, stores it,
extracts it, and it appears in the review queue. Point `MAIL_FETCH_DRIVER` at
`graph` to read a real Outlook mailbox instead.

## Demo: payroll

1. As `payroll`, go to Payroll → Import and upload
   `apps/server/fixtures/payroll/September-Payroll.xlsx`.
2. Validation runs before anything is written: 850 employees, ₹6.20 Cr, split
   across Chennai, Bengaluru and Pune, with the detected column mapping shown
   so a mis-read column can be corrected first.
3. Import, then submit. Approve as `financemanager` and `cfo` — the CFO sees
   the total, the headcount and the month-on-month movement, not individual
   salaries.
4. Approval fans the batch out into 850 payment obligations, which join the
   same payment queue the invoice used.
5. Sign in as `ravi` and look at the payment queue: payroll appears as one
   aggregated line, never as individual salaries.

## How it is put together

```
packages/shared      domain model: enums, permissions, state machines, money,
                     matching, and the Zod schemas the API and both clients share
packages/api-client  typed client + endpoint definitions used by web and mobile
apps/server          Express + Mongoose API
apps/web             React + Vite — the full operational surface
apps/mobile          Expo React Native — approvals on the go
```

### Access control

Three layers, all required, none skippable by a service that forgets:

1. **Authentication** resolves a JWT into a principal. Permissions are derived
   from the user's roles at request time, not read from the token, so a role
   change takes effect immediately.
2. **Permission gate** — every route names the permission it needs, from a
   catalogue in `packages/shared`. The clients gate their navigation on that
   same table, so the interface cannot offer an action the API will refuse.
3. **Data scoping** — a mandatory tenant/company filter that every query
   merges in.

Two domain rules sit on top: payroll permissions are disjoint from AP
permissions, so salary data is invisible to the rest of the finance team; and
a submitter can never approve their own item, at any level.

### Money

Every amount is an integer number of paise. No floating-point value ever
touches a financial figure, and `formatINR` / `formatCompactINR` handle
Indian grouping (₹35,40,000.00, ₹6.20 Cr).

### Lifecycles

Invoice, payroll batch, payment batch and the three obligation status axes are
each declared as a transition map in `packages/shared/src/workflow`. Services
assert a transition before writing, so illegal jumps are impossible and every
status change produces the before/after pair the audit trail records.

### Approval rules

Rules are stored rows, not code. The ₹1L / ₹1L–₹10L / >₹10L ladder is seeded
data, and the evaluator is a pure function — no database, clock or ORM — which
is why the boundary cases at exactly ₹1,00,000 and ₹10,00,000 are directly
unit-tested. Settings → Approval Rules includes a simulator that answers "who
would approve ₹35.4L?" before a rule is saved.

### Reconciliation

The matcher scores four independent signals out of 100: amount (50, or 35
within tolerance), fuzzy beneficiary name against the bank narration (25),
proximity to the batch export date (15), and our reference echoed in the
narration (10). Amount alone deliberately cannot suggest a match — two vendors
billing the same round figure in one batch is common, and that is exactly
where an automatic match would close the wrong payable. The engine also
declines to choose between two candidates within five points of each other.

Suggestions are only suggestions; confirming is a human action, and the UI
shows the signals so a reviewer decides on evidence rather than on a score.

### Integrations

| Interface | Production driver | Default local driver |
|---|---|---|
| Blob storage | Azure Blob Storage | Local disk |
| Outbound mail | Microsoft Graph | SMTP (Mailpit) or console |
| Invoice mailbox | Microsoft Graph polling | A directory of files |
| Extraction | Claude, or Azure Document Intelligence | Fixture sidecar, else the PDF text layer |

Driver selection is by environment variable; see `.env.example`, which
documents every setting.

## Commands

```bash
pnpm dev            # API and web together
pnpm dev:mobile     # Expo
pnpm build          # shared packages, then server and web
pnpm test           # all tests
pnpm typecheck      # all packages
pnpm lint           # ESLint + Prettier check
pnpm lint:fix       # fix and format
pnpm seed           # demo data (--reset to wipe first,
                    #            --skip-payroll-history to go faster)
```

`apps/mobile` is not part of `pnpm build` — Expo bundles at start or EAS build
time — but it is covered by `typecheck` and `lint`.

## Tests

```bash
pnpm test
```

Unit tests cover the parts where a mistake costs money and run with no
database: the approval rule engine including both band boundaries, the
lifecycle state machines, the reconciliation scorer, duplicate detection,
payroll import validation (including a full 850-employee run), bank file
generation, statement parsing and dedupe, and money arithmetic.

Integration tests drive both flagship journeys, the RBAC matrix and the seed's
coverage contract through the real API against MongoDB. They obtain a database
from `mongodb-memory-server` where it can download a binary; otherwise point
them at a real instance, and each suite takes its own database under that name:

```bash
MONGO_TEST_URI=mongodb://localhost:27017/fpc-test pnpm --filter @fpc/server test
```

Without either they skip with a printed reason rather than failing for an
environmental cause — check the output rather than assuming a pass.

CI runs the whole set on every push against a `mongo:7` service container, and
fails the build if the integration suites skip, since a silent skip is
otherwise indistinguishable from a pass.

## Deliberately out of scope

No vendor onboarding or KYC, no GST or bank-account verification, no purchase
orders, GRN or 2/3/4-way matching, no reimbursements, no payroll calculation,
no direct bank APIs or automated UTR retrieval, no ERP or accounting posting,
no GST/TDS filing, no budgeting. The platform owns the financial operations
workflow and hands off at both ends.
