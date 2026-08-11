# Fox Schema 0.2.72 — What's new

> **For users:** this is the page the in-app update toast links to (**What's new**).

Covers the patch since **`v0.2.71`**.

---

## What's new

### Connections

- **MongoDB** and **Redis** appear in the Credentials / connection dialect list
  (they were already supported by the adapters in 0.2.71, but the form never
  listed them).
- `foxschema drivers list` reports MongoDB and Redis alongside the SQL engines.

### Also included

- Redis WHERE predicates are honoured on UPDATE/DELETE; MongoDB refuses
  `WHERE col = NULL` matches that would hit missing fields (#223).

---

## How to update

```bash
npm install -g foxschema@latest
# or use in-app Update now
```

Homebrew:

```bash
brew update && brew upgrade foxschema
```
