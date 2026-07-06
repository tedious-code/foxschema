# syntax=docker/dockerfile:1
#
# Fox — self-host / cloud image. Single container that serves the built web UI
# AND the /api on one configurable port (see apps/web/src/backend/serve.ts).
#
# Two variants, controlled by the WITH_DB2 build arg:
#
#   common (default) — every dialect EXCEPT IBM Db2. Lean, builds on any arch:
#     docker build -t fox .
#
#   with Db2 — adds the ~1GB Db2 CLI driver (ibm_db). ibm_db has no linux/arm64
#   build, so this variant must target linux/amd64:
#     docker build --platform=linux/amd64 --build-arg WITH_DB2=true -t fox:db2 .
#
# See docs/DEPLOYMENT.md and docker-compose.app.yml / docker-compose.db2.yml.

# ─────────────────────────── build stage ───────────────────────────
FROM node:24-slim AS build

# false = common image (no Db2). true = include the Db2 driver (amd64 only).
ARG WITH_DB2=false

# Native modules (better-sqlite3, and — when WITH_DB2=true — ibm_db, oracledb)
# need a C/C++ toolchain, plus curl/ca-certificates for ibm_db's driver download.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy the repo (heavy/irrelevant workspaces excluded via .dockerignore: the
# Tauri desktop app, the CLI, the e2e suite, the test-DB docker assets, and the
# host lockfile — its OS/arch-specific optional bindings would break the install).
COPY . .

# For the common image, drop ibm_db from apps/web's optionalDependencies before
# installing so its large CLI driver is never downloaded and the build works on
# any architecture (including arm64). The Db2 adapter lazy-requires the driver and
# reports a clear "driver not installed" error if it's absent.
RUN if [ "$WITH_DB2" = "true" ]; then \
      echo '>> building WITH Db2 (ibm_db included — requires linux/amd64)'; \
    else \
      echo '>> building common image (Db2 excluded)'; \
      node -e "const fs=require('fs'),f='apps/web/package.json',p=JSON.parse(fs.readFileSync(f));if(p.optionalDependencies){delete p.optionalDependencies.ibm_db;}fs.writeFileSync(f,JSON.stringify(p,null,2)+'\n')"; \
    fi

# No committed lockfile (it's gitignored), so `npm install`, not `npm ci`.
RUN npm install

# Produce the frontend bundle at apps/web/dist (root build -> @foxschema/web).
RUN npm run build

# ─────────────────────────── runtime stage ─────────────────────────
FROM node:24-slim AS runtime
WORKDIR /app

# Run as a non-root user.
RUN useradd --system --create-home --uid 10001 fox

# Only what the web server needs: installed deps, the core engine source
# (imported as TS via tsx at runtime), and the web app (src + built dist).
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/web ./apps/web
COPY --from=build /app/package.json ./package.json

# Persistent volume for the SQLite metadata store (saved connections, history).
RUN mkdir -p /data && chown -R fox:fox /data /app
USER fox

ENV NODE_ENV=production \
    API_PORT=3001 \
    STATIC_DIR=/app/apps/web/dist \
    APP_DB_ENGINE=sqlite \
    APP_DB_PATH=/data/foxschema.db \
    APP_KEY_SCHEME=v1 \
    LOCAL_SINGLE_USER=true \
    AUTH_REQUIRED=false
# APP_ENCRYPTION_KEY is intentionally NOT set — it is REQUIRED at runtime and the
# app fails fast without it (it encrypts saved DB passwords). Provide it via -e / .env.

EXPOSE 3001
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||3001)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# tsx is present in node_modules (a devDependency, kept because we run TS at
# runtime). node:sqlite is flag-free on Node 24. Bundling the backend with
# esbuild (as the desktop sidecar/CLI do) is a future image-size optimization.
CMD ["node_modules/.bin/tsx", "apps/web/src/backend/serve.ts"]
