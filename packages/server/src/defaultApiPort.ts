/**
 * Default listen port for the Fox Schema API / single-origin UI server.
 * Shared by Docker, `npm run dev` API, and CLI (`foxschema open` uses the same).
 * 3210 avoids the crowded 3000/3001 band used by many Node apps.
 */
export const DEFAULT_API_PORT = 3210;
