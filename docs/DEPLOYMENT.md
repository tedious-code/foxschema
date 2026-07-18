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

## Quick start (pull and run)

No `.env` required. The image auto-generates `APP_ENCRYPTION_KEY` on first boot
and stores it on the `/data` volume.

```bash
docker pull 5nickels/foxschema:latest
docker run -d --name foxschema \
  -p 3001:3001 \
  -v foxschema_data:/data \
  5nickels/foxschema:latest
```

Open http://localhost:3001

Defaults baked into the image: single-user mode (no login), SQLite metadata on
`/data`, port `3001`. Keep the same volume across upgrades so saved connections
and the encryption key survive.

With Db2 client driver (amd64):

```bash
docker pull 5nickels/foxschema:db2-latest
docker run -d --name foxschema \
  -p 3001:3001 \
  -v foxschema_data:/data \
  5nickels/foxschema:db2-latest
```

### Optional: pin your own encryption key

```bash
docker run -d --name foxschema \
  -p 3001:3001 \
  -e APP_ENCRYPTION_KEY="$(openssl rand -hex 32)" \
  -v foxschema_data:/data \
  5nickels/foxschema:latest
```

### docker compose

```bash
docker compose -f docker-compose.app.yml up -d
# or build locally: docker compose -f docker-compose.app.yml up -d --build
```

## Configuration (environment variables)

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `3001` | Host port published by docker-compose (what you open in a browser). |
| `API_PORT` | `3001` | Port the app listens on **inside** the container. `PORT` maps to it. |
| `APP_ENCRYPTION_KEY` | auto on `/data` | Encrypts saved DB passwords. Optional in Docker: entrypoint creates `/data/.app_encryption_key` if unset. Set explicitly for managed/secret-store deploys. |
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

`APP_ENCRYPTION_KEY` protects the database passwords Fox stores.

- **Docker pull-and-run:** leave it unset; the entrypoint writes a random key to
  `/data/.app_encryption_key` and reuses it on later starts (as long as you keep
  the `/data` volume).
- **Pin your own key** (recommended for production secret managers):

```bash
openssl rand -hex 32
```

- **Keep it stable and secret.** If it changes, previously saved passwords can't be
  decrypted and must be re-entered.
- Running `serve.ts` outside Docker still requires the env var in production.

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

Every tagged release (`v*`) publishes both variants via `.github/workflows/web-release.yml`
— no local build needed.

**Docker Hub** (primary public image — [5nickels/foxschema](https://hub.docker.com/repository/docker/5nickels/foxschema/tags)):

```bash
docker pull 5nickels/foxschema:latest       # common (multi-arch)
docker pull 5nickels/foxschema:db2-latest   # with Db2 client (amd64 only)
```

**GitHub Container Registry** (also published on each release):

```bash
docker pull ghcr.io/tedious-code/foxschema:latest
docker pull ghcr.io/tedious-code/foxschema:db2-latest
```

CI (`.github/workflows/web-release.yml`) pushes both registries when these Actions
secrets are set on `tedious-code/foxschema`:

| Secret | Value |
|--------|--------|
| `DOCKERHUB_USERNAME` | `5nickels` |
| `DOCKERHUB_TOKEN` | Hub **Access Token** with Read & Write (not your password) |

Point `docker-compose.app.yml`'s `image:` at `5nickels/foxschema:latest` instead of
`build:` to skip building locally.

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
