# Deploying Fox Schema

Fox Schema's web app ships as a **single container** that serves both the UI and the API on
one configurable port. This guide covers running it locally, on a server, and in the
cloud.

- [Quick start](#quick-start)
- [Configuration (environment variables)](#configuration-environment-variables)
- [The encryption key](#the-encryption-key)
- [Choosing a port](#choosing-a-port)
- [Where app data lives](#where-app-data-lives)
- [Access: single-user vs. multi-user + SSO](#access-single-user-vs-multi-user--sso)
- [Cloud platforms](#cloud-platforms)
- [Database drivers](#database-drivers)
- [Building the image](#building-the-image)

## Quick start

```bash
cp .env.example .env
# set APP_ENCRYPTION_KEY in .env  →  openssl rand -hex 32
docker compose -f docker-compose.app.yml up -d --build
```

Open `http://localhost:${PORT}` (default `3001`). That's it — saved connections and
history persist on a Docker volume.

Prefer plain `docker run`?

```bash
docker build -t fox .
docker run -d --name fox \
  -p 8080:3001 \
  -e APP_ENCRYPTION_KEY=$(openssl rand -hex 32) \
  -v fox_data:/data \
  fox
```

## Configuration (environment variables)

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `3001` | Host port published by docker-compose (what you open in a browser). |
| `API_PORT` | `3001` | Port the app listens on **inside** the container. `PORT` maps to it. |
| `APP_ENCRYPTION_KEY` | — | **Required.** 32-byte key (64 hex chars, or base64) that encrypts saved DB passwords. The app refuses to start without it in production. |
| `APP_DB_ENGINE` | `sqlite` | The app's own metadata store: `sqlite`, `postgres`, or `mysql`. |
| `APP_DB_PATH` | `/data/foxschema.db` | SQLite file location (when `APP_DB_ENGINE=sqlite`). |
| `APP_DB_URL` | — | Connection URL for the metadata store when engine is `postgres`/`mysql`. |
| `APP_KEY_SCHEME` | `v1` | `v1` = key used directly. `v2` = key bound to `APP_USER_EMAIL` (anti-copy); leave `v1` for stateless servers. |
| `LOCAL_SINGLE_USER` | `true` | `true` = no login (open, single user). `false` = real accounts. |
| `AUTH_REQUIRED` | `false` | `true` = every request needs a session. Pair with `LOCAL_SINGLE_USER=false`. |
| `SSO_*` | — | OAuth for Google / Microsoft / GitHub (see below). |
| `NODE_ENV` | `production` | Set in the image; enforces that `APP_ENCRYPTION_KEY` is present. |

> The app also reads `APP_USER_EMAIL` (only for the `v2` key scheme) and
> `UPDATE_FEED_URL` (optional release-check feed). Neither is needed for a basic deploy.

## The encryption key

`APP_ENCRYPTION_KEY` protects the database passwords Fox stores. Generate one:

```bash
openssl rand -hex 32
# or: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

- **Keep it stable and secret.** Store it in your platform's secret manager, not in
  the image or a committed file. If it changes, previously saved passwords can't be
  decrypted and must be re-entered.
- The app **fails fast** (won't start) if it's missing in production — that's intentional.

## Choosing a port

Port `3001` conflicts with something? Set `PORT` (and optionally `API_PORT`):

```bash
# .env
PORT=8090          # published on the host — open http://localhost:8090
API_PORT=3001      # inside the container; PORT maps to it (fine to leave as-is)
```

With `docker run`, just change the left side of `-p 8090:3001`.

## Where app data lives

Fox Schema's **own** database (saved connections, migration history, settings — *not* the
databases you compare) defaults to a SQLite file on the **`/data` volume**.

- **Keep the volume** to keep your data across restarts/upgrades. `docker compose down`
  keeps it; `docker compose down -v` **deletes** it.
- **Stateless / ephemeral-disk platforms** (e.g. Cloud Run) reset local disk on each
  start. There, point the metadata store at a managed database instead of the volume:

  ```bash
  APP_DB_ENGINE=postgres
  APP_DB_URL=postgresql://user:pass@db-host:5432/foxmeta
  # (mysql works too: APP_DB_ENGINE=mysql, APP_DB_URL=mysql://…)
  ```

  Then you don't need the `/data` volume at all.

## Access: single-user vs. multi-user + SSO

**Default is open single-user** (`LOCAL_SINGLE_USER=true`, no login). This is fine for
local use or a trusted network, **but do not expose it directly to the public internet
— anyone who can reach the URL gets full access.** Put it behind a reverse proxy with
its own authentication, a VPN, or your platform's access controls.

For a public deployment, enable real accounts + SSO:

```bash
LOCAL_SINGLE_USER=false
AUTH_REQUIRED=true
SSO_REDIRECT_BASE=https://fox.example.com     # your public URL

# Enable one or more providers (both ID and SECRET required per provider):
SSO_GOOGLE_CLIENT_ID=...
SSO_GOOGLE_CLIENT_SECRET=...
SSO_GITHUB_CLIENT_ID=...
SSO_GITHUB_CLIENT_SECRET=...
SSO_MICROSOFT_CLIENT_ID=...
SSO_MICROSOFT_CLIENT_SECRET=...
SSO_MICROSOFT_TENANT=common
```

Set each provider's OAuth redirect/callback to `${SSO_REDIRECT_BASE}/api/auth/sso/<provider>/callback`.

**Always terminate TLS** (via your reverse proxy or platform) for any internet-facing
deployment — Fox Schema handles database credentials.

## Cloud platforms

The image is a standard single-port web server, so it runs anywhere containers do:

- **VPS / your own Docker host:** `docker compose -f docker-compose.app.yml up -d` with
  a persistent volume; front it with nginx/Caddy/Traefik for TLS.
- **Render / Railway / Fly.io / Cloud Run / ECS:** deploy the image, set the env vars
  as secrets, and let the platform's injected `PORT` be honored (the server reads
  `API_PORT` then `PORT`). On ephemeral-disk platforms, use an external metadata DB
  (above) instead of the volume.

The **common** image (default) is architecture-agnostic and runs on amd64 or arm64
hosts. The **Db2** image is amd64-only (see below).

## Database drivers

Fox connects to your databases via per-dialect drivers. Nine of the ten dialects use
pure-JavaScript drivers and are always included. **IBM Db2** (`ibm_db`) is the
exception — it ships native binaries, has **no linux/arm64 build**, and pulls in a
~1GB CLI driver — so it's split into a separate opt-in image:

| | Dialects | Size (approx.) | Architecture |
|-|----------|----------------|--------------|
| **common** (default) | all except Db2 | ~1.2 GB | amd64 **or** arm64 |
| **with Db2** | all ten | ~1.5 GB | linux/amd64 only |

The common image is ~260 MB smaller (it drops the Db2 CLI driver) and, importantly,
**builds and runs natively on arm64** — no emulation, no amd64 pin. It still *shows*
Db2 in the UI; attempting a Db2 connection there just returns a clear "driver not
installed" message, and every other dialect works.

Both images are still on the large side because they ship the full `node_modules`
(including the frontend build toolchain). Trimming that down with an esbuild backend
bundle is a planned follow-up.

## Pulling the published image

Every tagged release (`v*`) publishes both variants to GitHub Container Registry —
no local build needed:

```bash
docker pull ghcr.io/tedious-code/foxschema:latest      # common (multi-arch)
docker pull ghcr.io/tedious-code/foxschema:db2-latest  # with Db2 (amd64 only)
# or a specific version instead of :latest, e.g. ghcr.io/tedious-code/foxschema:v0.1.0
```

Built by `.github/workflows/web-release.yml`. Point `docker-compose.app.yml`'s
`image:` at one of these instead of `build:` to skip building locally.

## Building the image

**Common (recommended default):**

```bash
docker build -t fox .
# or:  docker compose -f docker-compose.app.yml up -d --build
```

**With Db2** (adds `ibm_db`; amd64 only — builds under emulation on Apple Silicon):

```bash
docker build --platform=linux/amd64 --build-arg WITH_DB2=true -t fox:db2 .
# or overlay the override:
docker compose -f docker-compose.app.yml -f docker-compose.db2.yml up -d --build
```

Both variants:
- Use `npm install` (no committed lockfile), build the Vite frontend to
  `apps/web/dist`, then run the API + static server via the production entry
  `apps/web/src/backend/serve.ts`.
- Run as a non-root user and expose a `/api/health` healthcheck.
- Run TypeScript at runtime via `tsx` with full `node_modules` — an esbuild backend
  bundle to shrink the image further is a planned follow-up.
