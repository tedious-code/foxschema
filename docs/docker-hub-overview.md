# Fox Schema

Database **schema diff and migration** tool. Compare a source schema against a target, review diffs, generate dialect-native SQL, and deploy.

- GitHub: https://github.com/tedious-code/foxschema
- Docs: https://github.com/tedious-code/foxschema/blob/main/docs/DEPLOYMENT.md

## Demo

Short walkthrough: connect → compare → table/view migration SQL → execute → history.

![Demo](https://github.com/tedious-code/foxschema/raw/main/docs/demo/foxschema-demo.gif)

**Video:** https://github.com/tedious-code/foxschema/raw/main/docs/demo/foxschema-demo.mp4

## Quick start

Pull and run (no `.env` needed — encryption key is auto-created on `/data`):

```bash
docker pull 5nickels/foxschema:latest
docker run -d --name foxschema \
  -p 3001:3001 \
  -v foxschema_data:/data \
  5nickels/foxschema:latest
```

Open **http://localhost:3001**

Keep the same `/data` volume across restarts so saved connections stay decryptable.

## Tags

| Tag | Description |
|-----|-------------|
| `latest` | Common image (all dialects except Db2 client) — multi-arch |
| `db2-latest` | Includes IBM Db2 client driver — **linux/amd64 only** |

```bash
docker pull 5nickels/foxschema:db2-latest
docker run -d --name foxschema \
  -p 3001:3001 \
  -v foxschema_data:/data \
  5nickels/foxschema:db2-latest
```

## Defaults

- Port `3001`
- Single-user mode (no login)
- SQLite metadata store on `/data`
- `APP_ENCRYPTION_KEY` auto-generated on first boot (persisted on `/data`)

## Optional environment

| Variable | Default | Purpose |
|----------|---------|---------|
| `APP_ENCRYPTION_KEY` | auto on `/data` | Pin your own key with `openssl rand -hex 32` |
| `PORT` / `API_PORT` | `3001` | Listen port |
| `LOCAL_SINGLE_USER` | `true` | Set `false` + `AUTH_REQUIRED=true` for multi-user |
| `APP_DB_ENGINE` | `sqlite` | Or `postgres` / `mysql` with `APP_DB_URL` |

## License

Apache-2.0 — https://github.com/tedious-code/foxschema/blob/main/LICENSE
