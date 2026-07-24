# Deploying Fox Schema

**Day-to-day on a laptop:** install the CLI, open the UI in your browser, optionally add a
desktop shortcut (`foxschema shortcut`). See **[INSTALL.md](INSTALL.md)**.

```bash
npm install -g foxschema
# or:
# brew tap tedious-code/foxschema https://github.com/tedious-code/foxschema
# brew trust tedious-code/foxschema && brew install foxschema
foxschema                  # http://localhost:3210
foxschema shortcut
```

Tauri desktop releases are retired. Maintainers: **[PUBLISH.md](PUBLISH.md)**.

**Servers / teams:** Fox Schema ships as a **single Docker image** (all dialects including
Db2) that serves both the UI and the API on one configurable port (default **3001**).

- [Install (all channels)](INSTALL.md)
- [CLI / Homebrew](homebrew.md)
- [Quick start (Docker)](#quick-start)
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
`/data`, port `3001`, **Db2 client included**. Image is **linux/amd64** only
(`ibm_db` has no linux/arm64 build). Keep the same volume across upgrades so saved
connections and the encryption key survive.

There is no separate `db2-latest` tag — `latest` is the one image.

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

The image is **linux/amd64** (includes Db2). On arm64 hosts, use emulation or the
npm/Homebrew CLI.

## Database drivers

The published image includes **all dialects, including Db2** (`ibm_db`). It is
**linux/amd64 only** because `ibm_db` has no linux/arm64 build.

On Apple Silicon, pull with Docker Desktop (emulation) or use the npm/Homebrew CLI
instead. There is no separate “common” vs “db2” image.

## Pulling the published image

Every tagged release (`v*`) publishes one image via `.github/workflows/web-release.yml`.

**Docker Hub** ([5nickels/foxschema](https://hub.docker.com/repository/docker/5nickels/foxschema/tags)):

```bash
docker pull 5nickels/foxschema:latest
```

**GitHub Container Registry:**

```bash
docker pull ghcr.io/tedious-code/foxschema:latest
```

CI pushes both registries when these Actions secrets are set:

| Secret | Value |
|--------|--------|
| `DOCKERHUB_USERNAME` | `5nickels` |
| `DOCKERHUB_TOKEN` | Hub **Access Token** with Read & Write (not your password) |

## Building the image

```bash
docker build --platform=linux/amd64 -t foxschema .
# or:  docker compose -f docker-compose.app.yml up -d --build
```

The image:
- Uses `npm install` (no committed lockfile), builds the Vite frontend to
  `apps/web/dist`, then runs the API + static server via
  `apps/web/src/backend/serve.ts`.
- Runs as a non-root user and exposes a `/api/health` healthcheck.
- Includes Db2 by default (`WITH_DB2=true`). For a local lean build without Db2:
  `docker build --build-arg WITH_DB2=false -t foxschema:lite .`
