# Docker Hub — Fox Schema

Public image: [5nickels/foxschema](https://hub.docker.com/repository/docker/5nickels/foxschema/tags)

**Schema Sync + SQL Editor** in one container (compare/migrate schemas, run
multi-destination SQL, Data Peek, FoxScript notebook cells).

Demo: https://raw.githubusercontent.com/tedious-code/foxschema/main/docs/demo/sql-editor.gif

## Tags (single image)

| Tag | Notes |
|-----|--------|
| `latest` | Current release — UI + API, **all dialects including Db2** |
| `vX.Y.Z` | Immutable version pin |

**Platform:** `linux/amd64` only (`ibm_db` has no linux/arm64 build). On Apple
Silicon, Docker Desktop runs it under emulation, or use the npm/Homebrew CLI.

There is **no** separate `db2-latest` image anymore.

## Run

```bash
docker pull 5nickels/foxschema:latest
docker run -d --name foxschema \
  -p 3001:3001 \
  -v foxschema_data:/data \
  5nickels/foxschema:latest
```

Open http://localhost:3001 — use **SQL Editor** in the top toolbar next to Schema Sync.

Also on GHCR: `ghcr.io/tedious-code/foxschema:latest`

Laptop install (npm / Homebrew): [INSTALL.md](INSTALL.md).
Maintainers: [PUBLISH.md](PUBLISH.md).
