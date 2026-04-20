/**
 * dimensionMap — port of two PartManager transforms required for the
 * preview renderer to actually see values it understands:
 *
 *   1. ExtractDimensionData (line 4052)  — Korean column name → renderer key
 *      (사이즈 → d, 내경 → d1, 전체길이 → L, …)
 *   2. ParseAndMapDimensionJson (line 3876) — DB row key → renderer key
 *      (M → d, H → k, B1(일반) → s, C1(일반) → e, Ls → b, …)
 *
 * The draw routines in partRenderer2D.js look up values via `dimVal(dims,'D',…)`
 * style calls that are case-insensitive — so as long as we publish the value
 * under the expected letter (d, k, s, e, L, b, P, r, z, …) the renderer
 * will find it regardless of where it came from.
 */
export const COLUMN_TO_KEY_MAP: Record<string, string> = {
  // 호칭 / 지름 관련
  사이즈: 'd',
  size: 'd',
  호칭: 'd',
  호칭경: 'd',
  호칭지름: 'd',
  나사호칭: 'd',
  nominal: 'd',
  직경: 'd',
  내경: 'd1',
  외경: 'd2',

  // 길이
  전체길이: 'L',
  길이: 'L',
  전장: 'L',
  length: 'L',
  나사길이: 'b',
  나사부길이: 'b',
  threadlength: 'b',

  // 피치
  피치: 'P',
  pitch: 'P',

  // 머리
  머리높이: 'k',
  headheight: 'k',
  머리직경: 'dk',
  headdiameter: 'dk',

  // 폭
  '2면폭': 's',
  이면폭: 's',
  acrossflats: 's',
  width: 's',
  대각선: 'e',
  acrosscorners: 'e',

  // 높이 / 두께
  높이: 'm',
  너트높이: 'm',
  height: 'm',
  두께: 't',
  thickness: 't',

  // 소켓
  소켓: 's',
  socket: 's',
  육각홈: 's',
};

/**
 * DB field → renderer key mapping. Port of `ParseAndMapDimensionJson`
 * (DynamicUIManager.cs line 3876). The raw `partdimension.dimension_data`
 * JSON uses DB column names (M, H, Hs, B1(일반), C1(일반), Ls, Length_max,
 * …) but the 2D/3D part renderers were built against renamed keys
 * (d, k, k_max, s, e, b, L_max, …). Without this mapping the renderer
 * falls back to hard-coded defaults and the preview never visually changes
 * when the user picks a different size.
 */
export const DB_KEY_TO_RENDERER_KEY: Record<string, string> = {
  // 호칭경 / 내경
  M: 'd',
  d: 'd',
  d1: 'd1',
  d2: 'd2',

  // 머리 높이
  H: 'k',
  Hs: 'k_max',

  // 2면폭 (일반 / 소형 구분)
  'B1(일반)': 's',
  'B2(소형)': 's_small',

  // 대각선
  'C1(일반)': 'e',
  'C2(소형)': 'e_small',

  // 피치
  'P1(UNC)': 'P',
  'P2(UNF)': 'P_fine',
  tpL_p1: 'P1',
  tpL_p2: 'P2',

  // 나사부 길이 (L 범위별)
  'L<=125(Ls)': 'b_short',
  'L<=125(Ls1)': 'b_short',
  'L>=130&&L<=200(Ls)': 'b_medium',
  'L>=130&&L<=200(Ls2)': 'b_medium',
  'L>=220(Ls)': 'b_long',
  'L>=220(Ls3)': 'b_long',
  Ls: 'b',

  // 길이 범위
  Length_min: 'L_min',
  Length_max: 'L_max',

  // 기타 — 원본 키 그대로 유지
  S: 'S',
  r: 'r',
  z: 'z',
  H1: 'H1',
  hh: 'hh',
  r1: 'r1',
  V1: 'V1',
  V2: 'V2',
  S1: 'S1',
};

function normalize(s: string): string {
  return (s ?? '').trim().toLowerCase().replace(/\s+/g, '');
}

/** If the column name has a canonical English key, return it. */
export function mapColumnToKey(columnName: string): string | null {
  return COLUMN_TO_KEY_MAP[normalize(columnName)] ?? null;
}

/**
 * Merge spec option selections into a dimensions dict, adding both the
 * original option name AND — when a mapping exists — the English-key
 * alias (M, D, L, …) that the renderer looks up.
 *
 * ⚠ Critical rule: NEVER overwrite a numeric alias with a non-numeric
 * option value. HBOLT's 사이즈 has values like "M3", "M10", "M20" (string
 * with alphabetic prefix). `parseFloat("M10")` is NaN, so the renderer
 * would fall back to its hard-coded default (10mm) for EVERY size. Keep
 * the numeric `d=10` that already came from the partdimension.M → d
 * mapping instead.
 */
export function mergeOptionsIntoDimensions(
  base: Record<string, number | string>,
  optionValues: Record<string, string | number>,
): Record<string, number | string> {
  const out = { ...base };
  for (const [label, value] of Object.entries(optionValues)) {
    if (value == null || value === '') continue;
    // Always publish under the original Korean label — non-numeric values
    // are still useful for drawers that look them up by name (e.g. radio
    // selections like 머리형식="기본").
    out[label] = value;

    const alias = mapColumnToKey(label);
    if (!alias) continue;

    // Only publish under the renderer alias when the value parses to a
    // positive number. Otherwise skip to avoid clobbering a numeric alias
    // already set by applyDimensionKeyMapping (e.g. 사이즈="M10" would turn
    // d=10 into the NaN-producing string "M10").
    const n =
      typeof value === 'number' ? value : parseFloat(String(value));
    if (Number.isFinite(n) && n > 0) {
      out[alias] = n;
    } else if (!(alias in out)) {
      // Alias not set yet AND value isn't numeric — fall back to the
      // raw value so at least the renderer sees *something*.
      out[alias] = value;
    }
    // else: alias already has a value (likely numeric). Preserve it.
  }
  return out;
}

/**
 * Apply DB_KEY_TO_RENDERER_KEY to a partdimension.dimension_data dict.
 * Keeps the original keys so downstream code that reads them directly
 * still works, but also publishes the renamed (renderer-expected) keys.
 *
 * Numeric values are preserved; non-numeric values pass through unchanged.
 *
 * Port of DynamicUIManager.ParseAndMapDimensionJson (line 3864).
 */
export function applyDimensionKeyMapping(
  dimData: Record<string, number | string>,
): Record<string, number | string> {
  const out: Record<string, number | string> = {};
  for (const [rawKey, value] of Object.entries(dimData ?? {})) {
    if (value == null) continue;
    // keep the original key
    out[rawKey] = value;
    // publish under mapped key too (if mapping exists and not already set)
    const mapped = DB_KEY_TO_RENDERER_KEY[rawKey];
    if (mapped && !(mapped in out)) {
      out[mapped] = value;
    }
  }
  return out;
}

/**
 * Post-process: derive `L` (total length) and `b` (thread length) from
 * whatever the user selected or from the L-range buckets.
 * Port of the tail of ParseAndMapDimensionJson (line 3988-4012).
 */
export function resolveLengthAndThread(
  dims: Record<string, number | string>,
  selectedValues: Record<string, string | number>,
): Record<string, number | string> {
  const out = { ...dims };

  // 전체길이(L) — user-selected value wins, overriding any DB row default.
  const lengthCandidates = ['전체길이', '길이', '전장', 'Length', 'L'];
  for (const k of lengthCandidates) {
    const raw = selectedValues[k];
    if (raw == null || raw === '') continue;
    const n = typeof raw === 'number' ? raw : parseFloat(String(raw));
    if (!Number.isNaN(n) && n > 0) {
      out.L = n;
      break;
    }
  }

  // 나사부 길이(b) — derive from L if b_* ranges exist.
  if (out.L != null && out.b == null) {
    const L = typeof out.L === 'number' ? out.L : parseFloat(String(out.L));
    if (!Number.isNaN(L)) {
      if (L <= 125 && out.b_short != null) out.b = out.b_short;
      else if (L >= 130 && L <= 200 && out.b_medium != null) out.b = out.b_medium;
      else if (L >= 220 && out.b_long != null) out.b = out.b_long;
    }
  }

  // If no explicit L but L_min exists, default to L_min.
  if (out.L == null && out.L_min != null) {
    out.L = out.L_min;
  }

  return out;
}
