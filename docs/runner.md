# Runner — install and run

How to get Elixir Finance Ops running locally, from a clean
checkout to a signed-in browser session, plus the commands used day to day.

## 1. Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node | >= 20.12 (CI uses 22) | `node -v` |
| pnpm | 9+ | `npm i -g pnpm`, or `corepack enable` |
| Docker | any recent | Only for MongoDB + Mailpit; a local MongoDB works instead |
| Expo Go | optional | Only to run `apps/mobile` on a device |

No cloud credentials are needed. Blob storage, the invoice mailbox and
document extraction all default to local drivers.

## 2. Install and start

```bash
pnpm install
cp .env.example .env          # PowerShell: Copy-Item .env.example .env

pnpm infra:up                 # MongoDB on :27017, Mailpit on :1025 / :8025
pnpm build                    # REQUIRED first — see note below
pnpm seed                     # demo data + demo input files
pnpm dev                      # API on :4000, web on :5173
```

Then open <http://localhost:5173>.

**Why `pnpm build` comes first:** `packages/shared` and `packages/api-client`
are consumed through their built `dist/` output, so a fresh checkout cannot
typecheck, seed, or run until they are built. `pnpm test` and `pnpm typecheck`
build them on their own; `pnpm dev` and `pnpm seed` do not.

### Without Docker

Point `MONGO_URI` in `.env` at any MongoDB instance and skip `pnpm infra:up`.
Outbound mail then has no Mailpit to reach, so set `MAIL_DRIVER=console` to
have emails printed to the server log instead.

## 3. Sign in

Every seeded account uses the password `FinanceOps@2026`:

| Email | Role |
|---|---|
| `ravi@nova.example.com` | Finance Executive — prepares, cannot approve |
| `ithead@nova.example.com` | Approver |
| `financemanager@nova.example.com` | Finance Manager — releases bank files |
| `cfo@nova.example.com` | CFO — final approver, sees payroll |
| `payroll@nova.example.com` | Payroll User |
| `auditor@nova.example.com` | Auditor, read-only |
| `admin@nova.example.com` | Platform Admin |
| `companyadmin@nova.example.com` | Company Admin |

Accounts created through the UI are **invited**, not active: the administrator
receives a one-time link and the recipient sets a password at `/accept-invite`
before they can sign in.

## 4. Ports and URLs

| Service | URL | Started by |
|---|---|---|
| Web (Vite) | <http://localhost:5173> | `pnpm dev` / `pnpm dev:web` |
| API (Express) | <http://localhost:4000> | `pnpm dev` / `pnpm dev:server` |
| Mailpit UI | <http://localhost:8025> | `pnpm infra:up` |
| MongoDB | `mongodb://localhost:27017/fpc` | `pnpm infra:up` |
| Expo | <http://localhost:8081> | `pnpm dev:mobile` |

Vite proxies `/api` to `http://localhost:4000`, so the web app needs no API
URL configured. The mobile app reads `expo.extra.apiBaseUrl` from
`apps/mobile/app.json` (default `http://localhost:4000/api`) — change it to
your machine's LAN IP to run on a physical device.

## 5. Command reference

```bash
pnpm dev            # API and web together
pnpm dev:server     # API only
pnpm dev:web        # web only
pnpm dev:mobile     # Expo (not part of pnpm build)

pnpm build          # shared packages, then server and web
pnpm test           # all tests
pnpm typecheck      # all packages
pnpm lint           # ESLint + Prettier check
pnpm lint:fix       # fix and format

pnpm seed           # demo data; pnpm seed -- --reset wipes first
pnpm infra:up       # start MongoDB + Mailpit
pnpm infra:down     # stop them
```

Production-style run of the API after `pnpm build`:

```bash
pnpm --filter @fpc/server start   # node dist/index.js
```

## 6. Configuration

`.env` at the repo root is loaded by the server and the seed script. Every
setting is documented in `.env.example`; the ones worth knowing:

| Variable | Default | Effect |
|---|---|---|
| `PORT` | `4000` | API port |
| `MONGO_URI` | `mongodb://localhost:27017/fpc` | Database |
| `CORS_ORIGINS` | `http://localhost:5173,http://localhost:8081` | Allowed origins |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | dev values | **Replace before any deployment** (`openssl rand -base64 48`) |
| `STORAGE_DRIVER` | `local` | `local` \| `azure` |
| `MAIL_DRIVER` | `smtp` | `console` \| `smtp` \| `graph` |
| `MAIL_FETCH_DRIVER` | `fixture` | `fixture` (watches a directory) \| `graph` |
| `OCR_DRIVER` | `stub` | `stub` \| `claude` \| `azure-doc-intelligence` |
| `JOBS_ENABLED` | `true` | Set `false` to disable the background pollers |

## 7. Demo input files

`pnpm seed` writes the files the two flagship journeys use:

- `apps/server/fixtures/inbox/INV-9930.pdf` — drop any file into this
  directory and the mail poller ingests it within a minute, exactly as if a
  vendor had emailed it.
- `apps/server/fixtures/payroll/September-Payroll.xlsx` — payroll import.
- `apps/server/fixtures/statements/HDFC-Statement.xlsx` — bank statement for
  reconciliation.

The invoice walkthrough (review → approve → pay → reconcile) and the payroll
walkthrough are in the [README](../README.md).

## 8. Tests

```bash
pnpm test                                 # everything
pnpm --filter @fpc/server test            # server unit + integration
pnpm --filter @fpc/web test               # web
pnpm --filter @fpc/shared test            # domain rules
```

Integration suites need a database. They use `mongodb-memory-server` where it
can download a binary; otherwise point them at a real instance:

```bash
MONGO_TEST_URI=mongodb://localhost:27017/fpc-test pnpm --filter @fpc/server test
```

With neither, they **skip with a printed reason** rather than fail — read the
output instead of assuming a pass. CI runs against a `mongo:7` service
container and fails the build if those suites skip.

## 9. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `Cannot find module '@fpc/shared'` | `packages/*` not built — run `pnpm build` (or `pnpm build:packages`) |
| Seed or dev exits on connect | MongoDB not up — `pnpm infra:up`, or fix `MONGO_URI` |
| Port 4000 / 5173 / 27017 in use | Stop the other process, or change `PORT` and Vite's port |
| No emails visible | Mailpit not running, or `MAIL_DRIVER` is not `smtp`; check <http://localhost:8025> |
| Dropped invoice never appears | `JOBS_ENABLED` is `false`, or `MAIL_FETCH_DRIVER` is not `fixture`; the poll runs once a minute |
| Login rejected on a new account | The account is invited, not active — complete `/accept-invite` first |
| Stale demo state | `pnpm seed -- --reset` |
| Docker volume needs clearing | `docker compose down -v` (deletes the `fpc-mongo-data` volume) |
