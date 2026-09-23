# Fox Schema 0.2.0 — SQL Editor release

Short notes for the `v0.2.0` tag (npm · Docker · Homebrew).

## Highlights

- **SQL Editor** as a first-class product surface next to Schema Sync
- Multi-destination Run, notebook cells (`@js` / `@ts` / `@node`), FoxScript
- **Data Peek** from Schema (Cmd/Ctrl-click) and from result FK cells
- Peek WHERE / ORDER BY / LIMIT, Prev/Next, arrange, resize
- DB2 paging alias fix (`fox_page`)
- Copyright NOTICE (Huy Phan) + SPDX on key SQL Editor files

## Install

```bash
npm install -g foxschema@0.2.0
# or
docker pull 5nickels/foxschema:v0.2.0
# or Homebrew after formula bump
brew upgrade foxschema
```

Demos: `docs/demo/sql-editor.gif`, `docs/demo/foxschema-demo.gif`
