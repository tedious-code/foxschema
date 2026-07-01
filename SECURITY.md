# Security Policy

## Supported Versions

Only the latest release receives security fixes. We use a rolling `0.0.BUILD` version scheme — patch the latest build, not older ones.

| Version | Supported |
|---------|-----------|
| 0.0.x (latest) | ✅ Yes |
| Older builds | ❌ No |

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Email the maintainer directly:

**huy.ph1988@gmail.com**

Include in your report:
- Description of the vulnerability
- Steps to reproduce
- Affected component (core engine, web app, desktop, CLI)
- Any proof-of-concept code

### What to expect

| Step | Timeline |
|------|----------|
| Acknowledgement | Within 48 hours |
| Initial assessment | Within 5 business days |
| Fix or mitigation | Within 30 days for High/Critical |
| Public disclosure | After fix is released |

We follow **coordinated disclosure**: we will credit you in the release notes unless you prefer to remain anonymous.

## Scope

In scope:
- SQL injection or command injection in the migration engine
- Secrets exposure (connection passwords, API keys)
- Authentication bypass in the web app
- Path traversal in file operations
- Remote code execution via malicious schema data

Out of scope:
- Vulnerabilities in development-only tooling (vitest, esbuild)
- Issues in local Docker environments used for E2E testing
- Denial-of-service attacks requiring local network access

## Security Controls

Automated security checks run on every pull request and every push to `main`:

- **npm audit** — blocks merges on Critical npm vulnerabilities
- **cargo audit** — blocks merges on RustSec advisories
- **Gitleaks** — detects committed secrets
- **ESLint security rules** — static analysis for injection patterns and unsafe regex
- **CodeQL** — weekly deep analysis (SQL injection, path traversal, prototype pollution)

All findings are visible in the [GitHub Security tab](../../security).
