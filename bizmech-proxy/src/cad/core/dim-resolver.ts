/**
 * Dimension resolver — take a CadGenerateRequest and turn its loose
 * `dimensions` dictionary into a strictly-typed dim record that the
 * geometry generator can consume.
 *
 * Every part family defines its own `DimSpec` with an alias list per
 * canonical name. Example (bolt):
 *
 *   const spec: DimSpec<BoltDims> = {
 *     d: { aliases: ['d', 'M', '호칭'],          required: true },
 *     L: { aliases: ['L', '전체길이'],           fallback: ['Length_min'] },
 *     S: { aliases: ['B1(일반)', 'S'],           required: true },
 *     H: { aliases: ['H'],                       required: true },
 *   };
 *   const dims = resolveDims(req, spec, 'HBOLT');
 *
 * The first alias hit wins. If none hit and a `fallback` list is given,
 * it's tried too (useful for DB-only sentinel values like Length_min).
 * When a required dim is still missing/zero, `resolveDims` throws with
 * a structured error listing every alias tried and the dimension keys
 * that WERE present — this makes "why didn't my part generate?" trivial
 * to debug.
 */
import type { CadGenerateRequest } from '../types.js';

export interface DimRule {
  /** Canonical names to try in priority order. */
  aliases: readonly string[];
  /** Extra names tried only if every `aliases` entry missed (e.g. DB sentinels). */
  fallback?: readonly string[];
  /** When true, resolveDims throws if the value is missing or ≤ 0. */
  required?: boolean;
  /** If the value is missing/zero, this number is used instead (takes precedence over required). */
  default?: number;
}

export type DimSpec<T> = { readonly [K in keyof T]: DimRule };

export class DimensionMissingError extends Error {
  constructor(
    public partLabel: string,
    public missing: Array<{ key: string; tried: string[] }>,
    public present: string[],
  ) {
    const list = missing
      .map((m) => `${m.key} (tried ${m.tried.join('/')})`)
      .join('; ');
    super(
      `${partLabel}: cannot generate — missing or non-positive dimension(s): ${list}. ` +
        `Received keys: ${present.join(', ') || '(none)'}`,
    );
    this.name = 'DimensionMissingError';
  }
}

function resolveOne(req: CadGenerateRequest, names: readonly string[]): number | null {
  // Pass 1: exact key match
  for (const key of names) {
    const v = req.dimensions[key];
    if (v == null || v === '') continue;
    const n = typeof v === 'number' ? v : parseFloat(String(v));
    if (!Number.isNaN(n)) return n;
  }
  // Pass 2: case-insensitive match. Some DBs serialize keys with different
  // casing than our aliases (e.g. "length_min" vs "Length_min").
  const lower: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(req.dimensions)) lower[k.toLowerCase()] = v;
  for (const key of names) {
    const v = lower[key.toLowerCase()];
    if (v == null || v === '') continue;
    const n = typeof v === 'number' ? v : parseFloat(String(v));
    if (!Number.isNaN(n)) return n;
  }
  return null;
}

/**
 * Resolve every dim in `spec` from `req.dimensions`, returning a record
 * typed exactly like the spec's keys. Throws `DimensionMissingError` if
 * any required dim can't be resolved.
 *
 * @param partLabel short label used in error messages (e.g. "HBOLT")
 */
export function resolveDims<T extends { [K in keyof T]: number }>(
  req: CadGenerateRequest,
  spec: DimSpec<T>,
  partLabel = req.partCode,
): T {
  const out = {} as T;
  const missing: Array<{ key: string; tried: string[] }> = [];

  for (const [key, rule] of Object.entries(spec) as Array<[keyof T, DimRule]>) {
    let v = resolveOne(req, rule.aliases);
    if ((v == null || v <= 0) && rule.fallback?.length) {
      v = resolveOne(req, rule.fallback);
    }
    if ((v == null || v <= 0) && rule.default != null) {
      v = rule.default;
    }
    if (v == null || v <= 0) {
      if (rule.required) {
        missing.push({
          key: String(key),
          tried: [...rule.aliases, ...(rule.fallback ?? [])],
        });
      }
      (out as Record<string, number>)[String(key)] = 0;
    } else {
      (out as Record<string, number>)[String(key)] = v;
    }
  }

  if (missing.length) {
    throw new DimensionMissingError(
      partLabel,
      missing,
      Object.keys(req.dimensions ?? {}),
    );
  }
  return out;
}
