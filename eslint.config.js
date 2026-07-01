import tseslint from 'typescript-eslint';
import security from 'eslint-plugin-security';

export default tseslint.config(
  // ── Global ignores ──────────────────────────────────────────────────────────
  {
    ignores: [
      '**/dist/**',
      '**/dist-bin/**',
      '**/node_modules/**',
      '**/target/**',                              // Rust build artifacts
      'apps/desktop/src-tauri/gen/**',
      'apps/desktop/src-tauri/frontendDist/**',
      'apps/desktop/src-tauri/resources/**',       // Bundled server.mjs (minified, not authored)
    ],
  },

  // ── Security-focused rules for all TypeScript source ────────────────────────
  // We intentionally use only the TypeScript parser (for syntax support) but do
  // NOT enable tseslint.configs.recommended — those 200+ quality rules generate
  // hundreds of pre-existing false positives (no-explicit-any, no-unused-vars)
  // that drown out real security findings. Quality rules can be added separately
  // once the codebase has been incrementally cleaned up.
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tseslint.parser,
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
      security,
    },
    rules: {
      // Execution of child processes with non-literal arguments — command injection risk.
      'security/detect-child-process': 'error',

      // eval() or Function() called with an expression — arbitrary code execution.
      'security/detect-eval-with-expression': 'error',

      // Regex patterns vulnerable to catastrophic backtracking (ReDoS).
      'security/detect-unsafe-regex': 'error',

      // fs functions called with a variable path — warn; legitimate server code uses this.
      // Promote to 'error' once all sites have been reviewed and suppressed where safe.
      'security/detect-non-literal-fs-filename': 'warn',

      // detect-object-injection deliberately omitted: fires on every obj[key] access,
      // which is ubiquitous in the dialect registry and diff iteration code.
    },
  },
);
