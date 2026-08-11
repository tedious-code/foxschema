# Fox Schema 0.2.73 — What's new

> **For users:** this is the page the in-app update toast links to (**What's new**).

Patch since **`v0.2.72`**. Still **no Lokee Weave**.

---

## What's new

### Credentials

- The **provider filter** lists every supported dialect (including **MongoDB** and
  **Redis**), not only dialects you already saved. Filtering is not how you add
  a connection — use **Add Credential**, then pick the dialect in that form.
- New credentials default to PostgreSQL instead of Db2.
- Dialect pickers are sorted A–Z so MongoDB / Redis are easier to find.

---

## How to update

```bash
npm install -g foxschema@latest
foxschema stop && foxschema
```

Then hard-refresh the browser tab (Cmd/Ctrl-Shift-R) if the UI still looks old.
