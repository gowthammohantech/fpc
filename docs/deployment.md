# Deploying to Railway

Two images, both built from the **repository root** because this is a pnpm
workspace and each app resolves `@fpc/shared` through the lockfile:

| Image                | Dockerfile            | Contents                                              |
| -------------------- | --------------------- | ----------------------------------------------------- |
| API (`@fpc/server`)  | `apps/server/Dockerfile` | Node 22, compiled `dist/`, production deps only     |
| Web (`@fpc/web`)     | `apps/web/Dockerfile`    | nginx serving the Vite build, reverse-proxying `/api` |

## Why the web image runs nginx

`apps/web/src/lib/api.ts` sets `baseUrl: '/api'`. That is deliberate — the
browser sees one origin, so the auth flow never touches CORS or third-party
cookie rules. The web container upholds that contract by proxying `/api` to
the API over Railway's private network, so the API needs no public domain and
its URL is never baked into the bundle.

## Building and running locally

```bash
docker build -f apps/server/Dockerfile -t fpc-server .
docker build -f apps/web/Dockerfile    -t fpc-web .

docker network create fpc
docker run -d --name mongo --network fpc mongo:7

docker run -d --name server --network fpc \
  -e NODE_ENV=production -e PORT=4000 \
  -e MONGO_URI=mongodb://mongo:27017/fpc \
  -e JWT_ACCESS_SECRET="$(openssl rand -base64 48)" \
  -e JWT_REFRESH_SECRET="$(openssl rand -base64 48)" \
  -e SECRET_ENCRYPTION_KEY="$(openssl rand -base64 32)" \
  -e CORS_ORIGINS=http://localhost:8080 \
  -e WEB_APP_URL=http://localhost:8080 \
  fpc-server

# RESOLVER: Railway's internal DNS by default; a plain Docker network uses
# the embedded resolver at 127.0.0.11 instead.
docker run -d --name web --network fpc -p 8080:8080 \
  -e API_URL=http://server:4000 -e RESOLVER=127.0.0.11 \
  fpc-web
```

The app is then on <http://localhost:8080>. Demo data:

```bash
docker exec server node dist/seed/run.js
```

## Railway setup

Three services in one project.

### 1. MongoDB

Add the MongoDB template. Nothing else to configure — the API reads its URL
through a variable reference below.

### 2. API service

Point it at this repository, then in **Settings**:

- **Root Directory** — leave as `/`. The Docker build context has to be the
  whole workspace; setting it to `apps/server` breaks the pnpm install.
- **Config-as-code path** — `apps/server/railway.json`. That file selects the
  Dockerfile builder, the `/health` check and the watch paths, so the service
  only rebuilds when the API or the shared packages change.

Variables (see `.env.example` for the full set — everything else has a working
default):

```
NODE_ENV=production
PORT=4000
MONGO_URI=${{MongoDB.MONGO_URL}}
JWT_ACCESS_SECRET=<openssl rand -base64 48>
JWT_REFRESH_SECRET=<openssl rand -base64 48>
SECRET_ENCRYPTION_KEY=<openssl rand -base64 32>
CORS_ORIGINS=https://<your-web-domain>
WEB_APP_URL=https://<your-web-domain>
```

`PORT=4000` is set explicitly because the web service addresses the API by
port over private networking, and Railway would otherwise assign one at random.

The API refuses to boot in production on the default JWT or encryption
secrets, and rejects a `WEB_APP_URL` that is not one of `CORS_ORIGINS` — a
misconfiguration that would otherwise only surface after an OAuth round trip.

Give it **no public domain**: nothing outside the project needs to reach it.
The exception is `OUTLOOK_ENABLED=true`, whose `OUTLOOK_REDIRECT_URI` must be a
public HTTPS URL on this service and registered on the Azure app.

### 3. Web service

Same repository, same **Root Directory** `/`, with **Config-as-code path**
`apps/web/railway.json`.

```
API_URL=http://${{server.RAILWAY_PRIVATE_DOMAIN}}:4000
```

Replace `server` with whatever the API service is actually named. Then
generate a public domain for this service — it is the only one users hit.

Railway sets `PORT` itself; nginx picks it up from the config template.

### Seeding

Once both services are up, from the API service shell (`railway ssh` or the
dashboard terminal):

```bash
node dist/seed/run.js          # --reset to wipe first
```

## Things worth knowing

- **Blob storage is ephemeral.** `STORAGE_DRIVER=local` writes under
  `apps/server/.data/blobs`, which a container redeploy discards. Attach a
  Railway volume mounted there, or switch to `STORAGE_DRIVER=azure` with
  `AZURE_STORAGE_CONNECTION_STRING`.
- **Do not scale the API past one replica** while `JOBS_ENABLED=true`. The mail,
  extraction and notification pollers are `node-cron` schedules inside the API
  process, so a second replica runs every job twice.
- **Private networking is IPv6-only.** The API image sets
  `NODE_OPTIONS=--dns-result-order=ipv6first` and the nginx config re-resolves
  the upstream every 10s, because Railway hands each service a new private
  address on every deploy.
- **Uploads cap at 25 MB** in nginx (`client_max_body_size`), above the API's
  own 2 MB JSON limit; raise both together if invoice PDFs get larger.
