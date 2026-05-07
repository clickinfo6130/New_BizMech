/**
 * Bearing dimension resolver — port of `BearingDimensions` (PartData.h
 * line 707) restricted to the fields actually consumed by the Phase 1
 * (Deep Groove Ball Bearing) generator.
 *
 * Field naming
 * ────────────
 * Matches the C++ struct exactly so future generators (Cylindrical /
 * Taper / Spherical / mounted units) can extend `BearingDims` without
 * renaming. The DB's `partdimension.dimension_data` JSON uses the same
 * keys, so most rows resolve via a single direct lookup.
 *
 * Core (DGBB requires these)
 * ──────────────────────────
 *   d1  — inner diameter / bore                 (internal:  shaft fit)
 *   D2  — outer diameter / OD                   (external:  housing fit)
 *   B   — width along the bearing axis
 *   r   — corner fillet radius; 0 → fallback B × 0.05 (matches C++)
 *
 * Snap-ring groove (optional, present on outer-ring variants)
 * ────────────────────────────────────────────────────────────
 *   Ga  — groove axial position from face
 *   Gb  — groove axial width
 *   GD  — groove diameter
 *
 * Strict mode
 * ───────────
 * Per the project rule "downloaded geometry must be measurable" the
 * resolver throws on missing core fields rather than silently
 * defaulting — designers expect the imported STEP to match the catalog
 * row exactly.
 */
import type { CadGenerateRequest } from '../../types.js';
import { resolveDims, type DimSpec } from '../../core/dim-resolver.js';

export interface BearingCoreDims {
  /** Inner diameter (bore) — shaft fit; e.g. 15 mm for 6202. */
  d1: number;
  /** Outer diameter (OD) — housing fit; e.g. 35 mm for 6202. */
  D2: number;
  /** Axial width / thickness; e.g. 11 mm for 6202. */
  B: number;
}

export interface BearingDims extends BearingCoreDims {
  /**
   * Corner fillet radius. The C++ reference defaults to B × 0.05 when
   * the DB row has 0 / missing — we mirror that so geometry stays
   * identical to the as-drawn part, even for catalog rows that omit
   * the field.
   */
  r: number;
  /**
   * Outer-ring corner fillet radius — used by the cylindrical roller
   * generator to match the C++ profile (line 1972: `r1 = r * 0.5` when
   * the DB row omits it). DGBB uses `r` for both rings so this is
   * resolved but identical to `r` for that family.
   */
  r1: number;
  /** Snap-ring groove axial position from face — undefined if none. */
  Ga?: number;
  /** Snap-ring groove axial width — undefined if none. */
  Gb?: number;
  /** Snap-ring groove diameter — undefined if none. */
  GD?: number;
}

const BEARING_CORE_DIM_SPEC: DimSpec<BearingCoreDims> = {
  d1: {
    aliases: ['d1', 'd', 'bore', '내경'],
    required: true,
  },
  D2: {
    aliases: ['D2', 'D', 'OD', '외경'],
    required: true,
  },
  B: {
    // 'H' is the catalog symbol for total assembly height on thrust
    // bearings (TCRB / TBB / TNRB / TSARB) — semantically the same
    // axial extent that radial bearings call B / width.
    aliases: ['B', 'H', 'width', '폭'],
    required: true,
  },
};

function readNumberAlias(req: CadGenerateRequest, aliases: string[]): number | null {
  for (const k of aliases) {
    const v = req.dimensions[k];
    if (v == null || v === '') continue;
    const n = typeof v === 'number' ? v : parseFloat(String(v));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/**
 * Resolve a complete BearingDims from a request.
 *   1. `resolveDims` enforces the three core fields (d1, D2, B); throws
 *      if any are absent — see resolver doc for the exact message.
 *   2. Optional fields read non-strictly; any negative / NaN values
 *      reduce to undefined.
 *   3. Sanity guards: d1 < D2, B > 0 — throws on violation so we never
 *      ship a STEP describing impossible geometry.
 */
export function resolveBearingDims(
  req: CadGenerateRequest,
  partLabel: string,
): BearingDims {
  const core = resolveDims(req, BEARING_CORE_DIM_SPEC, partLabel);

  if (core.d1 <= 0 || core.D2 <= 0 || core.B <= 0) {
    throw new Error(
      `${partLabel}: bearing dimensions must be positive — got ` +
        `d1=${core.d1} D2=${core.D2} B=${core.B}`,
    );
  }
  if (core.d1 >= core.D2) {
    throw new Error(
      `${partLabel}: inner diameter (d1=${core.d1}) must be smaller ` +
        `than outer diameter (D2=${core.D2})`,
    );
  }

  // Corner fillets — DB values if present and positive, else C++'s
  // default formulas. `r` is the inner ring's corner; `r1` is the
  // outer ring's (smaller, by C++ convention `r1 = r × 0.5` when the
  // catalog row omits it — line 1972 of NewCreateBearingClass.cpp).
  const rRaw = readNumberAlias(req, ['r', 'fillet']);
  const r = rRaw && rRaw > 0 ? rRaw : core.B * 0.05;
  const r1Raw = readNumberAlias(req, ['r1']);
  const r1 = r1Raw && r1Raw > 0 ? r1Raw : r * 0.5;

  // Snap-ring groove fields are pure passthrough — the generator
  // checks for `undefined` to decide whether to carve the groove.
  const Ga = readNumberAlias(req, ['Ga']);
  const Gb = readNumberAlias(req, ['Gb']);
  const GD = readNumberAlias(req, ['GD']);

  return {
    ...core,
    r,
    r1,
    Ga: Ga != null && Ga > 0 ? Ga : undefined,
    Gb: Gb != null && Gb > 0 ? Gb : undefined,
    GD: GD != null && GD > 0 ? GD : undefined,
  };
}
