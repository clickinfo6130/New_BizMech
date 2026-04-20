/**
 * jsonCell — normalise a Postgres column value that may be either a raw
 * JSON string (TEXT column) or an already-parsed object / array (JSONB
 * column). `node-postgres` auto-parses JSONB which makes `JSON.parse()`
 * throw SyntaxError on the already-parsed case.
 *
 * Also tolerates:
 *   · `null` / `undefined` → fallback
 *   · empty string         → fallback
 *   · double-encoded JSON  → parse twice
 */
export function jsonCell<T = unknown>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === 'object') return value as T;
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  try {
    const parsed = JSON.parse(trimmed);
    // Handle accidentally double-encoded strings.
    if (typeof parsed === 'string') {
      try {
        return JSON.parse(parsed) as T;
      } catch {
        return parsed as unknown as T;
      }
    }
    return parsed as T;
  } catch {
    return fallback;
  }
}
