#!/usr/bin/env node
/**
 * Fox Schema — node_modules supply-chain / backdoor scanner.
 *
 * Install with `--ignore-scripts` first, then run this. It never executes
 * dependency lifecycle scripts. Findings:
 *   CRITICAL — install-time remote exec, reverse shells, malicious binding.gyp,
 *              known worm IOC drop files
 *   HIGH     — unexpected createServer / .listen in non-allowlisted packages
 *   MEDIUM   — install scripts present (informational unless content is dangerous)
 *
 * Usage:
 *   node scripts/security/scan-node-modules.mjs [--root .] [--json] [--fail-on high]
 * Exit: 0 clean (or below threshold), 1 findings at/above fail-on, 2 scanner error
 */
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const DEFAULT_ALLOWLIST = join(HERE, 'scan-node-modules.allowlist.json');

const LIFECYCLE = new Set([
  'preinstall',
  'install',
  'postinstall',
  'preuninstall',
  'uninstall',
  'postuninstall',
  'prepublish',
  'preprepare',
  'prepare',
  'postprepare',
]);

/** Patterns in lifecycle script strings → CRITICAL. */
const DANGEROUS_SCRIPT_RES = [
  /curl\s+[^\n|]*\|\s*(?:bash|sh|zsh)/i,
  /wget\s+[^\n|]*\|\s*(?:bash|sh|zsh)/i,
  /\b(?:bash|sh)\s+-c\s+.*(?:curl|wget|fetch)\b/i,
  /powershell\s+.*(?:downloadstring|iwr|invoke-webrequest)/i,
  /\beval\s*\(\s*(?:Buffer|atob|btoa|unescape)/i,
  /new\s+Function\s*\(\s*(?:Buffer|atob)/i,
  /child_process.*(?:exec|spawn|execSync).*https?:\/\//i,
  /\bnpm\s+publish\b/i, // worm self-propagation
  /trufflehog|webhook\.site|pipedream\.net|burpcollaborator/i,
];

/** Source patterns → CRITICAL (any package). */
const CRITICAL_CODE_RES = [
  /(?:nc|ncat|netcat)\s+-[elp]/i,
  /\/dev\/tcp\//,
  /bash\s+-i\s+>&\s*\/dev\/tcp\//i,
  /socket\.connect\s*\([^)]*["'](?:\d{1,3}\.){3}\d{1,3}["']/,
  /new\s+WebSocket\s*\(\s*["']wss?:\/\/[^"']*(?:webhook|oast|burp|interact\.sh)/i,
  /\beval\s*\(\s*(?:Buffer\.from\([^)]*['"]base64['"]|atob\s*\()/i,
];

/** Port / server patterns → HIGH unless package is allowlisted. */
const SERVER_CODE_RES = [
  /\.listen\s*\(\s*(?:0|process\.env\.[A-Z0-9_]*PORT|['"`]0\.0\.0\.0['"`])/i,
  /\.listen\s*\(\s*\d{2,5}\s*[,)]/,
  /(?:http|https|net|tls)\.createServer\s*\(/,
  /createServer\s*\(\s*(?:async\s*)?\(?\s*req/,
];

/** Known worm / campaign drop files (basename). */
const IOC_BASENAMES = new Set([
  'setup_bun.js',
  'bun_environment.js',
  'trufflesecrets.json',
  'shai-hulud-workflow.yml',
]);

/**
 * Phantom-Gyp style payloads abuse binding.gyp actions with `node -e` / curl.
 * Legitimate native modules use `<!(node path.js)` or `<!@(node -p …)` — those
 * alone are NOT treated as malicious.
 */
const BINDING_GYP_DANGER = [
  /curl\s+|wget\s+|powershell|invoke-webrequest|iwr\s+/i,
  /node\s+-e\s+['"`][^'"`]*(?:child_process|https?:\/\/|eval\s*\(|Function\s*\(|base64|atob)/i,
  /['"]action['"]\s*:\s*\[[^\]]*(?:curl|wget|powershell|node\s+-e)/i,
  /spawnSync\s*\(\s*['"]?(?:curl|wget|bash|sh)/i,
];

function parseArgs(argv) {
  const out = {
    root: process.cwd(),
    json: false,
    failOn: 'high', // critical | high | medium | none
    report: null,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (a === '--root') out.root = resolve(argv[++i] || '.');
    else if (a === '--fail-on') out.failOn = String(argv[++i] || 'high').toLowerCase();
    else if (a === '--report') out.report = resolve(argv[++i] || 'deps-backdoor-report.json');
    else if (a === '--help' || a === '-h') {
      console.log(`Usage: node scripts/security/scan-node-modules.mjs [--root .] [--json] [--fail-on high|critical|medium|none] [--report path]`);
      process.exit(0);
    }
  }
  return out;
}

function loadAllowlist() {
  const raw = JSON.parse(readFileSync(DEFAULT_ALLOWLIST, 'utf8'));
  return new Set((raw.serverPackages || []).map((n) => n.toLowerCase()));
}

function walkDirs(dir, visit, depth = 0) {
  if (depth > 40) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    const full = join(dir, ent.name);
    if (ent.isDirectory()) {
      // Skip huge / irrelevant trees inside packages
      if (ent.name === '.git' || ent.name === 'coverage') continue;
      visit(full, ent);
      walkDirs(full, visit, depth + 1);
    } else if (ent.isFile()) {
      visit(full, ent);
    }
  }
}

function packageNameFromPath(nmRoot, filePath) {
  const rel = relative(nmRoot, filePath);
  const parts = rel.split(sep);
  if (parts[0]?.startsWith('@') && parts.length >= 2) return `${parts[0]}/${parts[1]}`;
  return parts[0] || '';
}

function packageRootFromPath(nmRoot, filePath) {
  const rel = relative(nmRoot, filePath);
  const parts = rel.split(sep);
  if (parts[0]?.startsWith('@') && parts.length >= 2) {
    return join(nmRoot, parts[0], parts[1]);
  }
  return join(nmRoot, parts[0] || '');
}

function readTextLimited(path, max = 512_000) {
  try {
    const st = statSync(path);
    if (!st.isFile() || st.size > max) return null;
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

function severityRank(s) {
  return { critical: 3, high: 2, medium: 1, info: 0 }[s] ?? 0;
}

function scan(root) {
  const nm = join(root, 'node_modules');
  const findings = [];
  const allow = loadAllowlist();

  if (!existsSync(nm)) {
    return {
      ok: false,
      error: `No node_modules at ${nm}. Run: npm install --ignore-scripts`,
      findings: [],
    };
  }

  const push = (f) => findings.push({ ...f, path: relative(root, f.path) });

  // ── 1) Manifest + lifecycle + IOC walk ───────────────────────────────────
  walkDirs(nm, (full, ent) => {
    const base = ent.name;

    if (ent.isFile() && IOC_BASENAMES.has(base.toLowerCase())) {
      push({
        severity: 'critical',
        kind: 'worm-ioc-file',
        package: packageNameFromPath(nm, full),
        path: full,
        detail: `Known supply-chain IOC basename: ${base}`,
      });
    }

    if (ent.isFile() && base === 'binding.gyp') {
      const text = readTextLimited(full, 256_000);
      if (text) {
        for (const re of BINDING_GYP_DANGER) {
          if (re.test(text)) {
            push({
              severity: 'critical',
              kind: 'malicious-binding-gyp',
              package: packageNameFromPath(nm, full),
              path: full,
              detail: `binding.gyp matches ${re}`,
            });
            break;
          }
        }
      }
    }

    if (!ent.isFile() || base !== 'package.json') return;
    // Only package roots: …/node_modules/<pkg>/package.json or scoped
    const rel = relative(nm, full);
    const parts = rel.split(sep);
    const isRootPkg =
      (parts.length === 2 && !parts[0].startsWith('@')) ||
      (parts.length === 3 && parts[0].startsWith('@'));
    if (!isRootPkg) return;

    const text = readTextLimited(full, 256_000);
    if (!text) return;
    let pkg;
    try {
      pkg = JSON.parse(text);
    } catch {
      return;
    }
    const name = pkg.name || packageNameFromPath(nm, full);
    const scripts = pkg.scripts || {};
    for (const [key, val] of Object.entries(scripts)) {
      if (!LIFECYCLE.has(key) || typeof val !== 'string') continue;
      let dangerous = false;
      for (const re of DANGEROUS_SCRIPT_RES) {
        if (re.test(val)) {
          push({
            severity: 'critical',
            kind: 'dangerous-lifecycle-script',
            package: name,
            path: full,
            detail: `${key}: ${val.slice(0, 200)}`,
          });
          dangerous = true;
          break;
        }
      }
      if (!dangerous) {
        // Legitimate native rebuilds are common — keep as medium for visibility.
        const benign =
          /node-gyp|prebuild-install|node install\.js|napi|electron-rebuild|esbuild|protobufjs/i.test(
            val
          );
        if (!benign) {
          push({
            severity: 'medium',
            kind: 'lifecycle-script',
            package: name,
            path: full,
            detail: `${key}: ${val.slice(0, 200)}`,
          });
        }
      }
    }
  });

  // ── 2) Source scan for backdoors / unexpected servers ────────────────────
  const CODE_EXT = new Set(['.js', '.mjs', '.cjs']);
  walkDirs(nm, (full, ent) => {
    if (!ent.isFile()) return;
    const lower = ent.name.toLowerCase();
    if (lower.endsWith('.min.js') || lower.endsWith('.map')) return;
    const dot = lower.lastIndexOf('.');
    const ext = dot >= 0 ? lower.slice(dot) : '';
    if (!CODE_EXT.has(ext)) return;
    // Skip nested tests and huge vendor dumps
    const rel = relative(nm, full).replace(/\\/g, '/');
    if (
      /(^|\/)(test|tests|__tests__|fixtures|examples?|example|system-test|benchmark)(\/|$)/i.test(
        rel
      ) ||
      /(^|\/)(test|tests|example|examples?)\.(js|mjs|cjs)$/i.test(rel) ||
      /(^|\/).*[\._-]test\.(js|mjs|cjs)$/i.test(rel)
    ) {
      return;
    }
    if (rel.split('/').length > 12) return;

    const text = readTextLimited(full, 400_000);
    if (!text) return;
    const pkgName = packageNameFromPath(nm, full);
    const pkgKey = pkgName.toLowerCase();

    for (const re of CRITICAL_CODE_RES) {
      if (re.test(text)) {
        push({
          severity: 'critical',
          kind: 'backdoor-code',
          package: pkgName,
          path: full,
          detail: `Matched ${re}`,
        });
        return;
      }
    }

    if (allow.has(pkgKey)) return;
    // Also allow @scope packages if bare scope entry is listed (rare)
    for (const re of SERVER_CODE_RES) {
      if (re.test(text)) {
        push({
          severity: 'high',
          kind: 'unexpected-server-listen',
          package: pkgName,
          path: full,
          detail: `Non-allowlisted package opens a port/server (${re}). Add to scripts/security/scan-node-modules.allowlist.json only if expected.`,
        });
        return;
      }
    }
  });

  // Deduplicate by kind+package+path
  const seen = new Set();
  const deduped = [];
  for (const f of findings) {
    const k = `${f.severity}|${f.kind}|${f.package}|${f.path}|${f.detail}`;
    if (seen.has(k)) continue;
    seen.add(k);
    deduped.push(f);
  }

  return { ok: true, findings: deduped, nodeModules: nm };
}

function main() {
  const opts = parseArgs(process.argv);
  const result = scan(opts.root);
  if (!result.ok) {
    console.error(result.error);
    process.exit(2);
  }

  const findings = result.findings;
  const bySev = { critical: 0, high: 0, medium: 0, info: 0 };
  for (const f of findings) bySev[f.severity] = (bySev[f.severity] || 0) + 1;

  const report = {
    scannedAt: new Date().toISOString(),
    root: opts.root,
    summary: bySev,
    findingCount: findings.length,
    findings: findings.sort(
      (a, b) => severityRank(b.severity) - severityRank(a.severity) || a.package.localeCompare(b.package)
    ),
  };

  if (opts.report) {
    writeFileSync(opts.report, JSON.stringify(report, null, 2));
  }

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`FoxSchema node_modules security scan`);
    console.log(`Root: ${opts.root}`);
    console.log(
      `Findings: critical=${bySev.critical} high=${bySev.high} medium=${bySev.medium} (total ${findings.length})`
    );
    const show = findings.filter((f) => severityRank(f.severity) >= severityRank('high'));
    for (const f of show.slice(0, 80)) {
      console.log(`\n[${f.severity.toUpperCase()}] ${f.kind} · ${f.package}`);
      console.log(`  ${f.path}`);
      console.log(`  ${f.detail}`);
    }
    if (show.length > 80) console.log(`\n… ${show.length - 80} more high+ findings`);
    const med = bySev.medium;
    if (med) console.log(`\n(${med} medium lifecycle-script notes omitted from console; see --json / --report)`);
  }

  const threshold = opts.failOn === 'none' ? 99 : severityRank(opts.failOn);
  const worst = findings.reduce((m, f) => Math.max(m, severityRank(f.severity)), 0);
  if (worst >= threshold && threshold < 99) {
    console.error(`\nFAILED: findings at or above --fail-on ${opts.failOn}`);
    process.exit(1);
  }
  process.exit(0);
}

main();
