/**
 * The contract every feature service is written against.
 *
 * A service never sees `req` or `res`. It takes a typed input plus an
 * ActorContext and returns typed output or throws a ServiceError. Transports
 * (REST today, GraphQL later) translate in both directions.
 *
 * This is what makes a second transport cheap: the permission check lives with
 * the business logic instead of in Express middleware, so a GraphQL resolver
 * cannot accidentally skip it. Every RBAC gap found so far came from a second
 * code path re-implementing a check.
 */
import type { Permission } from '../../shared/permissions';

export interface ActorContext {
  /** Undefined for an unauthenticated caller. */
  readonly userId: string | undefined;
  /** True when the actor holds (or subsumes) the permission. */
  can(permission: Permission): boolean;
}

export type ServiceErrorCode =
  | 'unauthenticated'
  | 'forbidden'
  | 'invalid_input'
  | 'not_found'
  | 'failed';

/** HTTP status per code — the REST transport's whole translation table. */
const STATUS: Record<ServiceErrorCode, number> = {
  unauthenticated: 401,
  forbidden: 403,
  invalid_input: 400,
  not_found: 404,
  failed: 500,
};

export class ServiceError extends Error {
  readonly code: ServiceErrorCode;

  constructor(code: ServiceErrorCode, message: string) {
    super(message);
    this.name = 'ServiceError';
    this.code = code;
  }

  get status(): number {
    return STATUS[this.code];
  }
}

/** Throw unless the actor holds `permission`. */
export function requirePermission(actor: ActorContext, permission: Permission): void {
  if (!actor.userId) {
    throw new ServiceError('unauthenticated', 'Authentication required');
  }
  if (!actor.can(permission)) {
    throw new ServiceError('forbidden', `Permission denied: this action needs "${permission}".`);
  }
}

/**
 * Map any thrown value to an HTTP status + message.
 *
 * Non-ServiceError throws become 500 with their own message, matching what the
 * route handlers did before the extraction — a driver error still reaches the
 * client rather than being flattened to something generic.
 */
export function toHttpError(error: unknown, fallback: string): { status: number; error: string } {
  if (error instanceof ServiceError) return { status: error.status, error: error.message };
  return { status: 500, error: error instanceof Error ? error.message : fallback };
}
