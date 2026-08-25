/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Per-target circuit breaker for database calls.
 *
 * Without one, a database that is down or hanging costs the same on every
 * request: each caller waits out the full connect timeout, holding a socket and
 * a request slot the whole time. A handful of unreachable targets is enough to
 * saturate the API, with requests queueing behind engines that will not
 * answer.
 *
 * The breaker turns the second and subsequent failures into an instant, cheap
 * rejection until the target has had time to recover, and then lets exactly one
 * request through to find out.
 *
 * Three states:
 *
 *   closed    — calls pass through; consecutive failures are counted.
 *   open      — calls are rejected immediately, no socket opened, until
 *               `resetAfterMs` has elapsed.
 *   half-open — one trial call is admitted. Success closes the breaker;
 *               failure re-opens it for another cooldown.
 *
 * Deliberately per-process and in-memory, matching the rest of this app: a
 * shared breaker would need shared state, and the value here is protecting
 * *this* process from wasting itself on a dead target.
 */

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerOptions {
  /** Consecutive failures before the breaker opens. */
  failureThreshold?: number;
  /** How long to stay open before admitting a trial call. */
  resetAfterMs?: number;
  /**
   * Successes required in half-open before closing. More than one is useful
   * when a target flaps — a single lucky call should not declare it healthy.
   */
  successThreshold?: number;
  /** Injectable for tests; defaults to Date.now. */
  now?: () => number;
}

export interface CircuitSnapshot {
  key: string;
  state: CircuitState;
  failures: number;
  /** When an open breaker will admit its next trial call. */
  openUntil: number | null;
  lastError: string | null;
}

/** Thrown instead of attempting a call the breaker is refusing. */
export class CircuitOpenError extends Error {
  readonly code = 'CIRCUIT_OPEN';
  constructor(
    readonly target: string,
    readonly retryAfterMs: number,
    lastError: string | null
  ) {
    super(
      `${target} is not responding, so Fox Schema stopped trying for ${Math.ceil(
        retryAfterMs / 1000
      )}s.${lastError ? ` Last error: ${lastError}` : ''}`
    );
    this.name = 'CircuitOpenError';
  }
}

interface Circuit {
  state: CircuitState;
  failures: number;
  successes: number;
  openUntil: number;
  lastError: string | null;
  /**
   * Half-open admits exactly one trial. Without this flag, every concurrent
   * caller that arrives after the cooldown (multi-destination SQL Editor,
   * compare retries) would open a socket again — the pile-up the breaker
   * exists to stop, recurring every resetAfterMs.
   */
  trialInFlight: boolean;
}

/** Far above any real deployment's distinct-target count. */
const MAX_CIRCUITS = 5_000;

const DEFAULTS = {
  failureThreshold: 3,
  resetAfterMs: 15_000,
  successThreshold: 1,
};

/**
 * Some failures say nothing about the target's health.
 *
 * A syntax error or a permission denial is a perfectly healthy server telling
 * you no — counting those would trip the breaker on a user's typo and lock them
 * out of a database that is working fine. Only failures that mean "could not
 * reach or could not finish" should count.
 */
export function isAvailabilityFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  const code = (error as { code?: unknown } | null)?.code;
  const codeText = typeof code === 'string' ? code : '';

  const availability = [
    'ECONNREFUSED',
    'ECONNRESET',
    'ETIMEDOUT',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'ENOTFOUND',
    'EPIPE',
    'EAI_AGAIN',
  ];
  if (availability.includes(codeText)) return true;

  return /econnrefused|econnreset|etimedout|ehostunreach|enetunreach|enotfound|socket hang up|connection (refused|timed out|terminated|closed)|could not connect|timeout expired|server closed the connection|connection to .* could not be established|communication error/i.test(
    message
  );
}

export class CircuitBreaker {
  private readonly circuits = new Map<string, Circuit>();
  private readonly failureThreshold: number;
  private readonly resetAfterMs: number;
  private readonly successThreshold: number;
  private readonly now: () => number;

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? DEFAULTS.failureThreshold;
    this.resetAfterMs = options.resetAfterMs ?? DEFAULTS.resetAfterMs;
    this.successThreshold = options.successThreshold ?? DEFAULTS.successThreshold;
    this.now = options.now ?? Date.now;
  }

  private circuit(key: string): Circuit {
    let c = this.circuits.get(key);
    if (!c) {
      // Keys come from connection details, so a caller able to invent targets
      // could otherwise grow this without limit. Healthy circuits carry no
      // state worth keeping, so they are the ones to drop.
      if (this.circuits.size >= MAX_CIRCUITS) {
        for (const [k, existing] of this.circuits) {
          if (existing.state === 'closed' && existing.failures === 0) this.circuits.delete(k);
        }
        // Still full means they are genuinely all failing; keep the oldest
        // rather than grow, since an open circuit is the state that saves work.
        if (this.circuits.size >= MAX_CIRCUITS) {
          const oldest = this.circuits.keys().next().value;
          if (oldest !== undefined) this.circuits.delete(oldest);
        }
      }
      c = {
        state: 'closed',
        failures: 0,
        successes: 0,
        openUntil: 0,
        lastError: null,
        trialInFlight: false,
      };
      this.circuits.set(key, c);
    }
    return c;
  }

  /** State right now, applying any elapsed cooldown. */
  stateOf(key: string): CircuitState {
    const c = this.circuits.get(key);
    if (!c) return 'closed';
    if (c.state === 'open' && this.now() >= c.openUntil) {
      c.state = 'half-open';
      c.successes = 0;
      c.trialInFlight = false;
    }
    return c.state;
  }

  /**
   * Run `fn` under the breaker.
   *
   * Rejects with CircuitOpenError — without calling `fn` — while open, and
   * while a half-open trial is already in flight (only one probe at a time).
   */
  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const state = this.stateOf(key);
    const c = this.circuit(key);

    if (state === 'open') {
      throw new CircuitOpenError(key, Math.max(0, c.openUntil - this.now()), c.lastError);
    }

    // Half-open: claim the single trial slot synchronously before any await,
    // so concurrent callers cannot all slip through between the state check
    // and the probe.
    let holdingTrial = false;
    if (state === 'half-open') {
      if (c.trialInFlight) {
        throw new CircuitOpenError(
          key,
          Math.max(1_000, Math.ceil(this.resetAfterMs / 10)),
          c.lastError
        );
      }
      c.trialInFlight = true;
      holdingTrial = true;
    }

    try {
      const result = await fn();
      this.recordSuccess(key);
      return result;
    } catch (error) {
      // A rejected query is not a broken server; see isAvailabilityFailure.
      if (isAvailabilityFailure(error)) this.recordFailure(key, error);
      else this.recordSuccess(key);
      throw error;
    } finally {
      if (holdingTrial) c.trialInFlight = false;
    }
  }

  recordSuccess(key: string): void {
    const c = this.circuit(key);
    if (c.state === 'half-open') {
      c.successes += 1;
      if (c.successes >= this.successThreshold) this.reset(key);
      return;
    }
    c.failures = 0;
    c.lastError = null;
  }

  recordFailure(key: string, error?: unknown): void {
    const c = this.circuit(key);
    c.lastError = error instanceof Error ? error.message : error ? String(error) : null;

    // A failed trial call means the target is still down — go straight back to
    // open rather than granting more trials on the same cooldown.
    if (c.state === 'half-open') {
      c.state = 'open';
      c.openUntil = this.now() + this.resetAfterMs;
      c.successes = 0;
      return;
    }

    c.failures += 1;
    if (c.failures >= this.failureThreshold) {
      c.state = 'open';
      c.openUntil = this.now() + this.resetAfterMs;
    }
  }

  /** Force a target closed — used after the user edits a connection. */
  reset(key: string): void {
    this.circuits.delete(key);
  }

  resetAll(): void {
    this.circuits.clear();
  }

  /** Open circuits, for a health endpoint or an operator-facing banner. */
  snapshot(): CircuitSnapshot[] {
    const out: CircuitSnapshot[] = [];
    for (const [key] of this.circuits) {
      const state = this.stateOf(key);
      const c = this.circuit(key);
      out.push({
        key,
        state,
        failures: c.failures,
        openUntil: state === 'open' ? c.openUntil : null,
        lastError: c.lastError,
      });
    }
    return out;
  }
}

/**
 * The breaker guarding outbound database calls.
 *
 * One shared instance so every code path sees the same target health — a
 * per-caller breaker would each have to learn the target is down separately,
 * which is most of the cost this is meant to avoid.
 */
export const dbCircuitBreaker = new CircuitBreaker({
  failureThreshold: Number(process.env.FOX_CIRCUIT_FAILURES) || DEFAULTS.failureThreshold,
  resetAfterMs: Number(process.env.FOX_CIRCUIT_RESET_MS) || DEFAULTS.resetAfterMs,
});

/**
 * Identity of the thing that can be down: host, port and database.
 *
 * Not the full connection string — that carries credentials, and two users of
 * the same server should share its health rather than each discovering the
 * outage alone.
 */
export function circuitKey(
  provider: string,
  options: { host?: string; port?: number; database?: string }
): string {
  const host = options.host ?? 'local';
  const port = options.port ?? '';
  const database = options.database ?? '';
  return `${provider}://${host}${port ? `:${port}` : ''}/${database}`;
}
