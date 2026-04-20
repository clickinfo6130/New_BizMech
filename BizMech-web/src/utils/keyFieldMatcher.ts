/**
 * keyFieldMatcher — map a dimensionmeta key-field name to a spec option.
 *
 * The shipped DBs aren't perfectly consistent with PartManager: the same
 * concept ("standard number", "size") is sometimes labeled differently in
 * the spec JSON than in `dimensionmeta`. For example:
 *
 *   dimensionmeta.field_name       spec option.name
 *   ──────────────────────────     ─────────────────────
 *   표준번호                        규격(표준번호)
 *   List                          사이즈
 *   호칭                          호칭 / 사이즈
 *   규격/제조사                    규격/제조사
 *
 * This helper walks through 3 matching strategies in order:
 *   1. Exact normalized match
 *   2. Substring containment
 *   3. Alias map (manually curated)
 */
import type { PartOption } from '@/types';

const FIELD_ALIASES: Record<string, string[]> = {
  list: ['사이즈', 'size', '호칭'],
  size: ['사이즈', 'list', '호칭'],
  표준번호: ['규격', '규격표준번호', 'standardno', 'standardnumber'],
  호칭: ['사이즈', '호칭번호', 'size', 'list'],
  '규격제조사': ['규격/제조사', '규격', '제조사'],
  규격: ['규격제조사', '표준번호'],
};

function normalize(s: string | undefined | null): string {
  if (!s) return '';
  return s
    .trim()
    .toLowerCase()
    .replace(/[()（）\[\]【】\s\/_-]/g, '')
    .replace(/：|:/g, '');
}

/**
 * Try to find the spec option that corresponds to the given key-field name.
 * Returns null if no reasonable match exists.
 */
export function findOptionForKeyField(
  options: PartOption[],
  fieldName: string,
): PartOption | null {
  if (!fieldName) return null;
  const target = normalize(fieldName);

  // Strategy 1 — exact normalized match
  for (const o of options) {
    if (normalize(o.name) === target) return o;
  }

  // Strategy 2 — substring containment (either direction)
  for (const o of options) {
    const n = normalize(o.name);
    if (!n) continue;
    if (n.includes(target) || target.includes(n)) return o;
  }

  // Strategy 3 — alias map
  const aliases = FIELD_ALIASES[target] ?? [];
  for (const alias of aliases) {
    const na = normalize(alias);
    for (const o of options) {
      if (normalize(o.name) === na) return o;
    }
  }
  return null;
}

/**
 * Opposite direction — given a spec option, ask whether it corresponds to
 * any of the key-field names. Used for deduping the spec list.
 */
export function isSpecOptionCoveredByKeyField(
  option: PartOption,
  keyFieldNames: string[],
): boolean {
  const on = normalize(option.name);
  if (!on) return false;
  for (const k of keyFieldNames) {
    const kn = normalize(k);
    if (!kn) continue;
    if (kn === on) return true;
    if (on.includes(kn) || kn.includes(on)) return true;
    const aliases = FIELD_ALIASES[kn] ?? [];
    for (const a of aliases) {
      if (normalize(a) === on) return true;
    }
  }
  return false;
}
