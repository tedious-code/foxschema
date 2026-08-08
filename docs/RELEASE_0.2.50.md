# Fox Schema 0.2.50 — Hotfix

> Empty / `Cannot GET /` page after install when an API-only process owns port 3210.

## What's fixed

- **`foxschema`** detects when `/api/health` is up but the UI shell is missing, and **restarts** instead of saying “already running.”
- **`foxschema stop`** also stops **unmanaged** listeners on the UI port (orphans with no PID lock).

## How to update

```bash
npm install -g foxschema@0.2.50
# free a stuck 3210 if needed, then:
foxschema stop
foxschema
```

Or: `brew update && brew upgrade foxschema`

## Distribution

| Channel | Artifact |
|---------|----------|
| **npm** | `foxschema@0.2.50` |
| **Docker Hub** | `5nickels/foxschema:v0.2.50` / `:latest` |
| **Release** | https://github.com/tedious-code/foxschema/releases/tag/v0.2.50 |
