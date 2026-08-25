/** Map DB unique/duplicate constraint failures to a friendly Error. */
export function rethrowUniqueViolation(err: unknown, message: string): never {
  const msg = err instanceof Error ? err.message : String(err);
  if (/unique|duplicate/i.test(msg)) throw new Error(message);
  throw err instanceof Error ? err : new Error(msg);
}
