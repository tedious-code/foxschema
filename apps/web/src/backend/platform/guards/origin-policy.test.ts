import { describe, it, expect } from 'vitest';
import { allowedOriginSet, isAllowedOrigin } from './origin-policy';

const dev = { isProduction: false, allowedOrigins: '' };
const prod = { isProduction: true, allowedOrigins: '', selfOrigin: 'https://fox.example.com' };

describe('the hole this closes', () => {
  /**
   * The previous policy allowed any localhost origin regardless of port. The
   * audience for a schema tool runs several local dev servers at once, and this
   * API holds database credentials and can run migrations — so a page on any
   * other local port could drive it with the user's session cookie.
   */
  it('refuses an unrelated local dev server', () => {
    expect(isAllowedOrigin('http://localhost:1337', dev)).toBe(false);
    expect(isAllowedOrigin('http://localhost:4321', dev)).toBe(false);
  });

  it('refuses a .localhost subdomain', () => {
    // Attacker-controlled DNS can point *.localhost wherever it likes, and some
    // resolvers send every .localhost name to 127.0.0.1.
    expect(isAllowedOrigin('http://evil.localhost:8080', dev)).toBe(false);
    expect(isAllowedOrigin('http://evil.localhost', prod)).toBe(false);
  });

  it('still refuses a plainly remote origin', () => {
    expect(isAllowedOrigin('https://attacker.com', dev)).toBe(false);
    expect(isAllowedOrigin('https://attacker.com', prod)).toBe(false);
  });
});

describe('what must keep working', () => {
  it('allows the dev UI ports outside production', () => {
    for (const o of ['http://localhost:5173', 'http://localhost:5199', 'http://127.0.0.1:5199']) {
      expect(isAllowedOrigin(o, dev)).toBe(true);
    }
  });

  it('does not allow dev ports in production', () => {
    // Production serves UI and API from one origin, so the dev ports are not
    // a legitimate caller there.
    expect(isAllowedOrigin('http://localhost:5173', prod)).toBe(false);
  });

  it('allows the origin the server is served from', () => {
    expect(isAllowedOrigin('https://fox.example.com', prod)).toBe(true);
  });

  it('allows a request with no Origin header', () => {
    // curl, the desktop shell and same-origin navigations send none; refusing
    // them breaks the product without stopping an attacker, because a browser
    // always sends Origin on the cross-origin requests that matter.
    expect(isAllowedOrigin(undefined, prod)).toBe(true);
    expect(isAllowedOrigin('', prod)).toBe(true);
  });
});

describe('explicit configuration', () => {
  it('an operator allowlist wins over every default', () => {
    const opts = { allowedOrigins: 'https://a.example.com,https://b.example.com', isProduction: true };
    expect(isAllowedOrigin('https://a.example.com', opts)).toBe(true);
    expect(isAllowedOrigin('https://b.example.com', opts)).toBe(true);
    // and nothing else, not even localhost
    expect(isAllowedOrigin('http://localhost:5173', opts)).toBe(false);
  });

  it('ignores whitespace and a trailing path', () => {
    const opts = { allowedOrigins: ' https://a.example.com/ , https://b.example.com ', isProduction: true };
    expect(isAllowedOrigin('https://a.example.com', opts)).toBe(true);
    expect(isAllowedOrigin('https://b.example.com', opts)).toBe(true);
  });

  it('compares scheme, host and port — not just the hostname', () => {
    const opts = { allowedOrigins: 'https://a.example.com', isProduction: true };
    // Same host, wrong scheme or port is a different origin.
    expect(isAllowedOrigin('http://a.example.com', opts)).toBe(false);
    expect(isAllowedOrigin('https://a.example.com:8443', opts)).toBe(false);
  });

  it('rejects a malformed origin rather than admitting it', () => {
    expect(isAllowedOrigin('not-a-url', dev)).toBe(false);
    expect(isAllowedOrigin('://///', dev)).toBe(false);
  });

  it('production with no self origin and no allowlist trusts nothing', () => {
    // Fail closed: an unconfigured production deploy should refuse
    // cross-origin credentials rather than guess.
    const bare = { isProduction: true, allowedOrigins: '' };
    expect(allowedOriginSet(bare).size).toBe(0);
    expect(isAllowedOrigin('http://localhost:5173', bare)).toBe(false);
    // …while same-origin requests, which carry no Origin, still work.
    expect(isAllowedOrigin(undefined, bare)).toBe(true);
  });
});
