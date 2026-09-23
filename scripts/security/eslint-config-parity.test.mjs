/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * The two ESLint configs must agree on what "a security rule" means.
 *
 * `eslint.config.js` is the everyday pass: security rules plus quality rules,
 * the quality ones as warnings. `eslint.security.config.js` is the gate
 * (`npm run lint:security`) — security rules only, zero tolerance, so it can
 * actually be green and actually be required.
 *
 * The security rules are written out in both, deliberately, so a refactor of
 * the quality config cannot silently change what the gate covers. The cost of
 * that choice is drift, which is the failure this repository keeps paying for
 * (see `TRIGGER_KINDS`, and `PROVIDER_SETTINGS`). So: pin them.
 *
 * Adding a security rule means adding it to both files. This test names the
 * one you missed.
 */
import { describe, expect, it } from 'vitest';
import securityConfig, { SECURITY_RULES } from '../../eslint.security.config.js';
import mainConfig from '../../eslint.config.js';

/** Every `security/*` rule the main config sets, flattened across its blocks. */
function securityRulesFromMainConfig() {
  const found = {};
  for (const block of mainConfig) {
    for (const [rule, severity] of Object.entries(block?.rules ?? {})) {
      if (!rule.startsWith('security/')) continue;
      // Later blocks override earlier ones, matching ESLint's own resolution.
      found[rule] = severity;
    }
  }
  return found;
}

describe('eslint.config.js and eslint.security.config.js agree', () => {
  it('cover the same set of security rules', () => {
    const main = Object.keys(securityRulesFromMainConfig())
      // The per-area blocks switch detect-non-literal-fs-filename off where it
      // has no trust boundary; that is scoping, not coverage. Both files carry
      // the same exemptions, checked below.
      .sort();
    expect(main).toEqual(Object.keys(SECURITY_RULES).sort());
  });

  it('run each rule at the same severity where the main config enables it', () => {
    const main = securityRulesFromMainConfig();
    for (const [rule, severity] of Object.entries(SECURITY_RULES)) {
      if (main[rule] === 'off') continue; // scoped off in a later block
      expect(main[rule], `${rule} severity differs between the two configs`).toBe(severity);
    }
  });

  it('exempt the same paths from the filesystem-path rule', () => {
    const exemptions = (config) => {
      const out = new Set();
      for (const block of config) {
        if (block?.rules?.['security/detect-non-literal-fs-filename'] !== 'off') continue;
        for (const f of block.files ?? []) out.add(f);
      }
      return out;
    };

    const mainExempt = exemptions(mainConfig);
    // Both configs now lint .mjs/.mts and carry the same exemption globs.
    const securityOnlyExtras = new Set();

    const secExempt = exemptions(securityConfig);

    for (const glob of mainExempt) {
      expect(
        secExempt.has(glob),
        `${glob} is exempt in eslint.config.js but not in the security config`,
      ).toBe(true);
    }
    for (const glob of secExempt) {
      if (securityOnlyExtras.has(glob)) continue;
      expect(
        mainExempt.has(glob),
        `${glob} is exempt in the security config but not in eslint.config.js`,
      ).toBe(true);
    }
  });
});
