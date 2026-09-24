/** Map DB unique/duplicate constraint failures to a friendly Error. */
import { errorMessage } from '@foxschema/sql';
export function rethrowUniqueViolation(err: unknown, message: string): never {
  const msg = errorMessage(err);
  if (/unique|duplicate/i.test(msg)) throw new Error(message);
  throw err instanceof Error ? err : new Error(msg);
}
