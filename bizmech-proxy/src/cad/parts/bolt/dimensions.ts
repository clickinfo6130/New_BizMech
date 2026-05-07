/**
 * Shared dimension record for every bolt variant.
 *
 * Every bolt type uses the same 4 core dims (d, L, S, H). Thread
 * parameters (pitch + threadLength) are optional — if absent from the
 * DB row they are filled in from the ISO 898-1 / KS B 0201 coarse
 * table and ISO 888 thread-length formula respectively. Per-variant
 * extras (e.g. socket depth for Socket Head, angle for Countersunk)
 * go into extensions resolved by that variant's own module.
 */
import type { CadGenerateRequest } from '../../types.js';
import { resolveDims, type DimSpec } from '../../core/dim-resolver.js';

export interface BoltCoreDims {
  /** Shaft (nominal) diameter — M10 → 10. */
  d: number;
  /** Overall shaft length (bearing surface to tip). */
  L: number;
  /** Head across-flats (hex) or outer diameter (round-head variants). */
  S: number;
  /** Head height. */
  H: number;
}

export interface BoltDims extends BoltCoreDims {
  /**
   * Thread pitch in mm. 0 ⇒ unthreaded bolt (stud end etc.). When the
   * DB row lacks P1/P2, this is auto-filled from the ISO coarse table
   * for the given `d`.
   */
  pitch: number;
  /**
   * Length of the threaded region measured from the TIP toward the
   * head, in mm. 0 ⇒ no thread. When the DB row lacks Ls*, this is
   * auto-filled from the ISO 888 formula (2d + 6 for L ≤ 125, etc.).
   */
  threadLength: number;
  /**
   * Thread minor diameter (d1) — depth of thread ≈ 0.5413 × P, so
   * d_minor = d − 2·h3 ≈ d − 1.0825·P. Used for both the 3D
   * minor-cylinder STEP geometry and the DXF cosmetic-thread lines.
   */
  minorD: number;
  /** Thread designation — "M10×1.5", "UNC 3/8-16", etc. Rendered on DXF. */
  threadDesignation: string;
}

/** Required core dims — d, L, S, H. Thread data is resolved separately. */
export const BOLT_CORE_DIM_SPEC: DimSpec<BoltCoreDims> = {
  d: {
    aliases: ['d', 'M', '호칭', '호칭경', 'diameter', 'nominal_diameter'],
    required: true,
  },
  L: {
    aliases: ['L', 'length', '전체길이', 'totalLength'],
    fallback: ['Length_min', 'Length_default'],
    required: true,
  },
  S: {
    aliases: ['B1(일반)', 'B1', 'acrossFlats', '머리폭', 'hexS', 'B2(소형)', 'B2', 'S'],
    required: true,
  },
  H: {
    aliases: ['H', 'H1', 'headHeight', '머리높이'],
    required: true,
  },
};

// ─────────────────────────────────────────────────────────────────────
// Thread — ISO 898-1 coarse pitch table + ISO 888 thread-length rules
// ─────────────────────────────────────────────────────────────────────

/** ISO 898-1 / KS B 0201 coarse pitch by nominal diameter (mm). */
const ISO_COARSE_PITCH: Record<number, number> = {
  2: 0.4, 2.5: 0.45, 3: 0.5, 3.5: 0.6, 4: 0.7, 5: 0.8,
  6: 1.0, 7: 1.0, 8: 1.25, 10: 1.5, 12: 1.75,
  14: 2.0, 16: 2.0, 18: 2.5, 20: 2.5, 22: 2.5,
  24: 3.0, 27: 3.0, 30: 3.5, 33: 3.5, 36: 4.0,
  39: 4.0, 42: 4.5, 45: 4.5, 48: 5.0, 52: 5.0,
};

function coarsePitch(d: number): number {
  if (ISO_COARSE_PITCH[d]) return ISO_COARSE_PITCH[d];
  // For non-standard sizes, interpolate to the nearest smaller standard.
  const keys = Object.keys(ISO_COARSE_PITCH).map(Number).sort((a, b) => a - b);
  let last = keys[0];
  for (const k of keys) {
    if (k > d) break;
    last = k;
  }
  return ISO_COARSE_PITCH[last] ?? 1.0;
}

/**
 * ISO 888 thread-length rule:
 *   L ≤ 125:           Ls = 2d + 6
 *   125 < L ≤ 200:     Ls = 2d + 12
 *   L > 200:           Ls = 2d + 25
 * If the resulting Ls > L the bolt is fully threaded (Ls = L).
 */
function iso888ThreadLength(d: number, L: number): number {
  let Ls: number;
  if (L <= 125) Ls = 2 * d + 6;
  else if (L <= 200) Ls = 2 * d + 12;
  else Ls = 2 * d + 25;
  return Math.min(L, Ls);
}

/** Thread minor diameter (depth h3 ≈ 0.5413 × P per ISO 68-1). */
export function computeMinorDiameter(d: number, pitch: number): number {
  if (pitch <= 0) return d;
  return Number((d - 1.0825 * pitch).toFixed(4));
}

function resolveNumberAlias(req: CadGenerateRequest, aliases: string[]): number | null {
  for (const k of aliases) {
    const v = req.dimensions[k];
    if (v == null || v === '') continue;
    const n = typeof v === 'number' ? v : parseFloat(String(v));
    if (!Number.isNaN(n) && n > 0) return n;
  }
  return null;
}

function resolveStringAlias(req: CadGenerateRequest, aliases: string[]): string | null {
  for (const k of aliases) {
    const v = req.dimensions[k];
    if (v == null || v === '') continue;
    const s = typeof v === 'string' ? v : String(v);
    if (s.trim()) return s.trim();
  }
  return null;
}

/**
 * Resolve the full BoltDims from a request:
 *   1. Core dims (required) — resolveDims throws if any are missing.
 *   2. Thread pitch — DB field P1(UNC) / P2(UNF) / pitch, else ISO coarse.
 *   3. Thread length — DB fields Ls1/2/3 picked by L bracket, else ISO 888.
 *   4. minorD and threadDesignation are derived.
 *
 * The caller passes `partLabel` for error messages.
 */
export function resolveBoltDims(req: CadGenerateRequest, partLabel: string): BoltDims {
  const core = resolveDims(req, BOLT_CORE_DIM_SPEC, partLabel);

  // Pitch — prefer DB value, fall back to ISO coarse, allow 0 to mean "no thread".
  let pitch = resolveNumberAlias(req, ['pitch', 'P', 'P1(UNC)', 'P2(UNF)']) ?? 0;
  if (pitch <= 0) pitch = coarsePitch(core.d);

  // Thread length — prefer the DB bracket that matches L, else ISO 888.
  const ls1 = resolveNumberAlias(req, ['L<=125(Ls1)', 'Ls1', 'threadLength', 'Lt', 'Ls']);
  const ls2 = resolveNumberAlias(req, ['L>=130&&L<=200(Ls2)', 'Ls2']);
  const ls3 = resolveNumberAlias(req, ['L>=220(Ls3)', 'Ls3']);
  let threadLength: number;
  if (core.L <= 125 && ls1 != null) threadLength = ls1;
  else if (core.L > 125 && core.L <= 200 && ls2 != null) threadLength = ls2;
  else if (core.L > 200 && ls3 != null) threadLength = ls3;
  else threadLength = iso888ThreadLength(core.d, core.L);
  // Safety: thread length can't exceed shaft length.
  threadLength = Math.min(threadLength, core.L);

  const minorD = computeMinorDiameter(core.d, pitch);

  const prefix =
    resolveStringAlias(req, ['threadStandard', 'standard', '규격']) ?? 'M';
  const threadDesignation =
    pitch > 0 ? `${prefix}${formatNum(core.d)}×${formatNum(pitch)}` : '';

  return {
    ...core,
    pitch,
    threadLength,
    minorD,
    threadDesignation,
  };
}

function formatNum(n: number): string {
  const s = Number(n.toFixed(3)).toString();
  return s.includes('.') ? s : s;
}
