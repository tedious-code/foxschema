import { describe, it, expect } from 'vitest';
import { allowedOriginSet, isAllowedOrigin, localDevHosts, requestOriginFrom } from './origin-policy';

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
    for (const o of [
      'http://localhost:5173',
      'http://localhost:5199',
      'http://127.0.0.1:5199',
      'http://[::1]:5173',
      'http://localhost:3210',
    ]) {
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

  it('production with no self origin and no allowlist trusts nothing cross-origin', () => {
    // Fail closed: an unconfigured production deploy should refuse
    // cross-origin credentials rather than guess.
    const bare = { isProduction: true, allowedOrigins: '' };
    expect(allowedOriginSet(bare).size).toBe(0);
    expect(isAllowedOrigin('http://localhost:5173', bare)).toBe(false);
    // …while requests with no Origin (curl, health checks) still work.
    expect(isAllowedOrigin(undefined, bare)).toBe(true);
  });

  it('allows Origin that matches this request (same-origin fetch in production)', () => {
    // Docker / foxschema open serve UI+API on one port with NODE_ENV=production.
    // Browsers still send Origin on same-origin POST; rejecting that 403s login.
    const bare = {
      isProduction: true,
      allowedOrigins: '',
      requestOrigin: 'http://localhost:3210',
    };
    expect(isAllowedOrigin('http://localhost:3210', bare)).toBe(true);
    expect(isAllowedOrigin('http://127.0.0.1:3210', bare)).toBe(false);
    expect(isAllowedOrigin('https://attacker.com', bare)).toBe(false);
  });

  it('requestOriginFrom pairs protocol with Host', () => {
    expect(requestOriginFrom('https', 'app.example.com')).toBe('https://app.example.com');
    expect(requestOriginFrom('http', 'localhost:3210')).toBe('http://localhost:3210');
    expect(requestOriginFrom('http', undefined)).toBeUndefined();
  });
});

describe('npm run dev from an address other than localhost', () => {
  /**
   * Vite binds 0.0.0.0 and prints a `Network:` URL on the machine's LAN address.
   * Opening it sent that address as Origin, which was not on the list, so every
   * API call — reads included, once an Origin was present — answered 403 and the
   * UI looked disconnected from its API.
   */
  const lanDev = { ...dev, devHosts: ['localhost', '127.0.0.1', '[::1]', '0.0.0.0', '192.168.1.69'] };

  it("allows the dev ports on this machine's own LAN address", () => {
    expect(isAllowedOrigin('http://192.168.1.69:5173', lanDev)).toBe(true);
  });

  it('allows IPv6 loopback and the 0.0.0.0 bind address', () => {
    expect(isAllowedOrigin('http://[::1]:5173', lanDev)).toBe(true);
    expect(isAllowedOrigin('http://0.0.0.0:5173', lanDev)).toBe(true);
  });

  it('still refuses a port the dev setup does not use, even on our own address', () => {
    expect(isAllowedOrigin('http://192.168.1.69:1337', lanDev)).toBe(false);
  });

  it('still refuses somebody else\'s address', () => {
    expect(isAllowedOrigin('http://192.168.1.70:5173', lanDev)).toBe(false);
  });

  it('never trusts a hostname, which is what a DNS-rebinding attack looks like', () => {
    // evil.com rebound to 127.0.0.1 is same-origin to the browser and Vite
    // serves it (allowedHosts: true), but the Origin still names the hostname.
    // Trusting it — e.g. by rewriting Origin in the dev proxy — would hand the
    // page the developer's saved database connections.
    expect(isAllowedOrigin('http://evil.com:5173', lanDev)).toBe(false);
    expect(isAllowedOrigin('https://preview.example.dev', lanDev)).toBe(false);
  });

  it('does not extend any of this to production', () => {
    const lanProd = { ...prod, devHosts: lanDev.devHosts };
    expect(isAllowedOrigin('http://192.168.1.69:5173', lanProd)).toBe(false);
  });

  it('discovers the real interfaces by default, including loopback in both families', () => {
    const hosts = localDevHosts();
    expect(hosts).toEqual(expect.arrayContaining(['localhost', '127.0.0.1', '[::1]', '0.0.0.0']));
    // Every entry must be usable verbatim inside an Origin: no zone ids, IPv6
    // bracketed.
    for (const h of hosts) {
      expect(h).not.toContain('%');
      if (h.includes(':')) expect(h.startsWith('[') && h.endsWith(']')).toBe(true);
    }
  });
});
