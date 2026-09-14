import { getPath } from '../common/index.js';
/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/runtime/src/gates.ts).
 */
/**
 * Minimal gate expression evaluator for pipeline dependency gates.
 *
 * Supported forms:
 * - literals: true | false
 * - comparisons: payload.<path> (==|!=|>|>=|<|<=) <literal>
 * - truthiness: payload.<path>
 *
 * Context keys: payload (trigger payload), trigger (kind string), stats (future).
 */
export interface GateContext {
  payload?: unknown;
  trigger?: string;
  stats?: Record<string, unknown>;
}

export function evaluateGate(expression: string, context: GateContext): boolean {
  const source = expression.trim();
  if (!source) return true;
  if (source === 'true') return true;
  if (source === 'false') return false;

  const comparison = source.match(
    // eslint-disable-next-line security/detect-unsafe-regex -- false positive: each repeated segment starts with a literal '.', and the trailing (.+)$ runs once after a fixed operator
    /^(payload(?:\.[A-Za-z_][\w]*)*|trigger|stats(?:\.[A-Za-z_][\w]*)*)\s*(==|!=|>=|<=|>|<)\s*(.+)$/,
  );
  if (comparison) {
    const left = resolvePath(comparison[1]!, context);
    const op = comparison[2]!;
    const right = parseLiteral(comparison[3]!.trim());
    return compare(left, op, right);
  }

  // eslint-disable-next-line security/detect-unsafe-regex -- false positive: each repeated segment starts with a literal '.'
  if (/^(payload|trigger|stats)(?:\.[A-Za-z_][\w]*)*$/.test(source)) {
    return Boolean(resolvePath(source, context));
  }

  throw new Error(`unsupported gate expression: ${expression}`);
}

function resolvePath(path: string, context: GateContext): unknown {
  const [root, ...rest] = path.split('.');
  const base = root === 'payload' ? context.payload : root === 'trigger' ? context.trigger : context.stats;
  return rest.length ? getPath(base, rest.join('.')) : base;
}

function parseLiteral(raw: string): unknown {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'null') return null;
  // eslint-disable-next-line security/detect-unsafe-regex -- false positive: anchored number with one optional fraction, no overlapping repetition
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  if (
    (raw.startsWith('"') && raw.endsWith('"')) ||
    (raw.startsWith("'") && raw.endsWith("'"))
  ) {
    return raw.slice(1, -1);
  }
  return raw;
}

function compare(left: unknown, op: string, right: unknown): boolean {
  switch (op) {
    case '==':
      return left === right;
    case '!=':
      return left !== right;
    case '>':
      return Number(left) > Number(right);
    case '>=':
      return Number(left) >= Number(right);
    case '<':
      return Number(left) < Number(right);
    case '<=':
      return Number(left) <= Number(right);
    default:
      return false;
  }
}
