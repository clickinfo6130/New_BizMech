/**
 * OCCT-backed STEP generator for radial-shaft oil seals (OSEAL).
 * Faithful port of `BearingCreator::CreateOilSeal`
 * (`C++Source/NewCreateBearingClass.cpp` line 3728-4146).
 *
 * What's an Oil Seal
 * ──────────────────
 * A radial shaft seal — also called an "oil seal" — sits in a housing
 * bore around a rotating shaft and prevents lubricant from escaping
 * (and contaminants from entering) the bearing cavity behind it. It
 * typically consists of:
 *
 *   1. An outer metal case that grips the housing bore (always present;
 *      shape depends on the variant).
 *   2. An optional inner metal case for SA/DA/GA variants (assembled
 *      construction — outer + inner cases sandwich the rubber).
 *   3. A rubber elastomer body bonded to the metal that includes the
 *      sealing lip and (for double-lip variants) a dust lip.
 *   4. An optional brass garter spring (torus) that biases the lip
 *      against the shaft to maintain contact under wear.
 *
 * Variants — 9 OilSealTypes encoded by 3 axes
 * ───────────────────────────────────────────
 *   axis 1 — lip count:
 *     S / SM / SA = single sealing lip
 *     D / DM / DA = double lip (sealing + dust lip)
 *     G / GM / GA = single lip, no spring (relaxed lip)
 *
 *   axis 2 — spring: only the G family lacks a garter spring.
 *
 *   axis 3 — outer case shape:
 *     [no suffix] (S/D/G)   = rubber-covered OD     (outerCaseType 0)
 *     M-suffix    (SM/DM/GM) = metal OD             (outerCaseType 1)
 *     A-suffix    (SA/DA/GA) = assembled — extra inner metal case
 *                                                    (outerCaseType 2)
 *
 * The variant is resolved from `req.dimensions.LipShape` (the partspec
 * column the C++ reference reads via `m_partData->Info.LipShape`); if
 * absent we default to `SM`, mirroring the C++ default at
 * `NewCreateBearingClass.h:105`.
 *
 * Geometry approach
 * ─────────────────
 * Each body is a closed planar profile in the XZ plane revolved around
 * the Z-axis (= seal axis). The seal's left face sits at Z=0 and the
 * right face at Z=W, matching the C++ sketch convention so the
 * Mate-OilSeal-YZ datum referenced by the bearing assembly stays at
 * Z=0.
 *
 * Two notable adjustments vs. the C++ source:
 *   1. Spring relief on the rubber profile: C++ uses ONE 180° arc
 *      (diametrically opposite endpoints). Our `makeProfileWireXZ`
 *      helper picks the SHORT arc and refuses to build semicircles
 *      (`endpoints may be diametrically opposite`), so we split the
 *      half-circle into TWO 90° quarter-arcs joined at the 3 o'clock
 *      midpoint.
 *   2. Garter spring profile: C++ uses two 180° arcs to draw the
 *      circle. We use four 90° quarter-arcs for the same reason.
 *   Both produce identical geometry once revolved (TOROIDAL_SURFACE
 *   either way).
 *
 * Material / colour application from the C++ reference (RGB
 * SetRenderStyle blocks, line 3774-3960) is NOT ported — STEP doesn't
 * carry per-body colour natively, and the multi-body manifold output
 * already keeps the cases / rubber / spring as separately selectable
 * solids in Inventor for the user to colour at import time.
 */
import type { CadGenerateRequest, CadGenerateResult } from '../../types.js';
import { FORMAT_EXT, FORMAT_MIME } from '../../types.js';
import {
  exportStepBytes,
  flattenBrepWithVoidsToManifolds,
  getOcct,
  makeProfileWireXZ,
  makeRevolZ,
  mergeShapesIntoMultibodySolid,
  type ProfilePoint2D,
  type ProfileSegment,
} from '../../core/occt.js';
import { bomFileName } from '../../core/bom-meta.js';
import type { BearingDims } from './dimensions.js';

type OilSealVariant =
  | 'S'  | 'D'  | 'G'
  | 'SM' | 'DM' | 'GM'
  | 'SA' | 'DA' | 'GA';

const SEAL_VARIANTS: readonly OilSealVariant[] = [
  'S', 'D', 'G', 'SM', 'DM', 'GM', 'SA', 'DA', 'GA',
];

/**
 * Convert a C++ sketch coord `(axial, radial)` into the OCCT XZ profile
 * `[radial, axial]`. Centralised so every profile coordinate reads in
 * the same `(axial, radial)` order as the C++ source — keeps porting
 * straightforward.
 */
const p = (axial: number, radial: number): ProfilePoint2D => [radial, axial];

export async function buildOsealStepViaOcct(
  req: CadGenerateRequest,
  dims: BearingDims,
): Promise<CadGenerateResult> {
  const started = Date.now();
  const oc = await getOcct();

  const variant = readSealVariant(req);
  const isDoubleLip = variant === 'D' || variant === 'DM' || variant === 'DA';
  const hasSpring = !(variant === 'G' || variant === 'GM' || variant === 'GA');
  const outerCaseType: 0 | 1 | 2 =
    variant === 'SM' || variant === 'DM' || variant === 'GM' ? 1
    : variant === 'SA' || variant === 'DA' || variant === 'GA' ? 2
    : 0;

  // ── Geometry constants — port of C++ lines 3735-3766. ──
  const Y_OD = dims.D2 / 2;
  const Y_ID = dims.d1 / 2;
  const H = Y_OD - Y_ID;
  const W = dims.B;

  const lip_interf = 0.2;
  const dust_gap = 0.1;
  const t1 = Math.min(1.5, W * 0.15);
  const t2 = Math.min(1.2, W * 0.12);
  const t_r = Math.min(1.0, H * 0.1);

  const Y_MOD = outerCaseType === 0 ? Y_OD - t_r : Y_OD;
  const Y_MID = Y_ID + H * 0.55;
  const m_left = outerCaseType === 2 ? W * 0.15 : W * 0.2;

  if (Y_MOD <= Y_MID) {
    throw new Error(
      `OSEAL ${req.partCode}: degenerate metal-case envelope ` +
        `(Y_MOD=${Y_MOD.toFixed(3)} ≤ Y_MID=${Y_MID.toFixed(3)}) — ` +
        `bore/OD/width too tight for the outer case profile to close.`,
    );
  }

  // ── 1. Outer metal case (always created — port of C++ 3962-3982). ──
  const outerCase = buildOuterMetalCase(oc, m_left, W, Y_MOD, Y_MID, t1);

  // ── 2. Inner metal case (only outerCaseType == 2). ──
  const innerCase =
    outerCaseType === 2
      ? buildInnerMetalCase(oc, m_left, W, Y_MOD, Y_MID, t1, t2)
      : null;

  // ── 3. Rubber elastomer body. ──
  const Cs_x = W * 0.485;
  const Cs_y = Y_ID + H * 0.30;
  const R_s = Math.min(H * 0.08, W * 0.08);
  const rubberBody = buildRubberBody(oc, {
    outerCaseType,
    isDoubleLip,
    hasSpring,
    Y_OD,
    Y_ID,
    Y_MOD,
    Y_MID,
    H,
    W,
    m_left,
    t1,
    t2,
    lip_interf,
    dust_gap,
    Cs_x,
    Cs_y,
    R_s,
  });

  // ── 4. Garter spring (only when hasSpring). ──
  const garterSpring = hasSpring ? buildGarterSpring(oc, Cs_x, Cs_y, R_s) : null;

  // ── 5. Merge into a single multi-body solid + STEP export. ──
  const bodies: unknown[] = [outerCase, rubberBody];
  if (innerCase) bodies.push(innerCase);
  if (garterSpring) bodies.push(garterSpring);
  const seal = mergeShapesIntoMultibodySolid(oc, bodies);

  const rawStep = exportStepBytes(oc, seal);
  const flattened = flattenBrepWithVoidsToManifolds(rawStep.toString('utf8'));
  const bytes = Buffer.from(flattened, 'utf8');
  const ext = FORMAT_EXT.STEP;

  return {
    bytes,
    format: 'STEP',
    mimeType: FORMAT_MIME.STEP,
    ext,
    backend: 'local',
    generatedMs: Date.now() - started,
    fileName: bomFileName(req, ext),
  };
}

/**
 * Build the always-present outer metal case (a thin C-channel ring
 * opening axially toward the seal's left face). Six straight edges, no
 * arcs — porting C++ lines 3965-3980.
 */
function buildOuterMetalCase(
  oc: unknown,
  m_left: number,
  W: number,
  Y_MOD: number,
  Y_MID: number,
  t1: number,
): unknown {
  const segments: ProfileSegment[] = [
    { kind: 'line', to: p(m_left, Y_MOD) },          // m1 → m2
    { kind: 'line', to: p(W, Y_MOD) },               // m2 → m3
    { kind: 'line', to: p(W, Y_MID) },               // m3 → m4
    { kind: 'line', to: p(W - t1, Y_MID) },          // m4 → m5
    { kind: 'line', to: p(W - t1, Y_MOD - t1) },     // m5 → m6
    { kind: 'line', to: p(m_left, Y_MOD - t1) },     // m6 → m1 (close)
  ];
  const wire = makeProfileWireXZ(oc, p(m_left, Y_MOD - t1), segments);
  return makeRevolZ(oc, wire);
}

/**
 * Build the optional inner metal case, present only on assembled
 * variants (SA/DA/GA — outerCaseType 2). It's a second C-channel
 * sandwiched inside the outer case — port of C++ lines 3987-4001.
 */
function buildInnerMetalCase(
  oc: unknown,
  m_left: number,
  W: number,
  Y_MOD: number,
  Y_MID: number,
  t1: number,
  t2: number,
): unknown {
  const segments: ProfileSegment[] = [
    { kind: 'line', to: p(m_left, Y_MOD - t1) },               // i1 → i2
    { kind: 'line', to: p(W - t1, Y_MOD - t1) },               // i2 → i3
    { kind: 'line', to: p(W - t1, Y_MOD - t1 - t2) },          // i3 → i4
    { kind: 'line', to: p(m_left + t2, Y_MOD - t1 - t2) },     // i4 → i5
    { kind: 'line', to: p(m_left + t2, Y_MID) },               // i5 → i6
    { kind: 'line', to: p(m_left, Y_MID) },                    // i6 → i1 (close)
  ];
  const wire = makeProfileWireXZ(oc, p(m_left, Y_MID), segments);
  return makeRevolZ(oc, wire);
}

interface RubberParams {
  outerCaseType: 0 | 1 | 2;
  isDoubleLip: boolean;
  hasSpring: boolean;
  Y_OD: number;
  Y_ID: number;
  Y_MOD: number;
  Y_MID: number;
  H: number;
  W: number;
  m_left: number;
  t1: number;
  t2: number;
  lip_interf: number;
  dust_gap: number;
  Cs_x: number;
  Cs_y: number;
  R_s: number;
}

/**
 * Build the rubber elastomer body — the most complex of the three
 * profiles. Single closed wire that:
 *
 *   1. Wraps over the outside of the metal case (or sits inside it for
 *      assembled variants).
 *   2. Drops down through the lip(s) which protrude radially below
 *      Y_ID by `lip_interf` (the static interference fit; designers
 *      see this as the seal's "as-drawn" lip diameter, smaller than
 *      the bore).
 *   3. Carves a hemicircular relief for the garter spring (the spring
 *      sits half-buried in the rubber, the lip pushed against the
 *      shaft by spring force).
 *
 * Port of C++ lines 4007-4108. The relief arc — a half-circle — must
 * be split into two quarter-arcs because `makeProfileWireXZ` rejects
 * exact semicircles (see file header).
 */
function buildRubberBody(oc: unknown, params: RubberParams): unknown {
  const {
    outerCaseType,
    isDoubleLip,
    hasSpring,
    Y_OD,
    Y_ID,
    Y_MOD,
    Y_MID,
    H,
    W,
    m_left,
    t1,
    t2,
    lip_interf,
    dust_gap,
    Cs_x,
    Cs_y,
    R_s,
  } = params;

  const segments: ProfileSegment[] = [];

  // ── Top-half profile (r1 → ... → P_last_top) — branches by case type. ──
  if (outerCaseType === 0) {
    // Rubber wraps OVER the metal case (metal is inset by t_r below Y_OD).
    // The notch r5→r6→r7→r8→r9 carves the cavity where the metal case
    // sits, leaving the rubber as the outer / left wall of the seal.
    segments.push(
      { kind: 'line', to: p(0, Y_OD - H * 0.05) },        // r1 → r2
      { kind: 'line', to: p(W * 0.05, Y_OD) },             // r2 → r3
      { kind: 'line', to: p(W, Y_OD) },                    // r3 → r4
      { kind: 'line', to: p(W, Y_MOD) },                   // r4 → r5
      { kind: 'line', to: p(m_left, Y_MOD) },              // r5 → r6
      { kind: 'line', to: p(m_left, Y_MOD - t1) },         // r6 → r7
      { kind: 'line', to: p(W - t1, Y_MOD - t1) },         // r7 → r8
      { kind: 'line', to: p(W - t1, Y_MID) },              // r8 → r9
      { kind: 'line', to: p(W, Y_MID) },                   // r9 → P_last_top
    );
  } else if (outerCaseType === 1) {
    // Rubber sits INSIDE the metal case (metal at Y_OD). No outer wrap.
    segments.push(
      { kind: 'line', to: p(0, Y_OD - H * 0.05) },         // r1 → r2
      { kind: 'line', to: p(W * 0.05, Y_OD) },              // r2 → r2_c
      { kind: 'line', to: p(m_left, Y_OD) },                // r2_c → r3
      { kind: 'line', to: p(m_left, Y_MOD - t1) },          // r3 → r4
      { kind: 'line', to: p(W - t1, Y_MOD - t1) },          // r4 → r5
      { kind: 'line', to: p(W - t1, Y_MID) },               // r5 → r6
      { kind: 'line', to: p(W, Y_MID) },                    // r6 → P_last_top
    );
  } else {
    // outerCaseType === 2 — assembled. Rubber sits inside outer case AND
    // wraps around the inner case's interior cavity.
    segments.push(
      { kind: 'line', to: p(0, Y_OD - H * 0.05) },                 // r1 → r2
      { kind: 'line', to: p(W * 0.05, Y_OD) },                      // r2 → r2_c
      { kind: 'line', to: p(m_left, Y_OD) },                        // r2_c → r3
      { kind: 'line', to: p(m_left, Y_MID) },                       // r3 → r4
      { kind: 'line', to: p(m_left + t2, Y_MID) },                  // r4 → r5
      { kind: 'line', to: p(m_left + t2, Y_MOD - t1 - t2) },        // r5 → r6
      { kind: 'line', to: p(W - t1, Y_MOD - t1 - t2) },             // r6 → r7
      { kind: 'line', to: p(W - t1, Y_MID) },                       // r7 → r8
      { kind: 'line', to: p(W, Y_MID) },                            // r8 → P_last_top
    );
  }

  // ── Lip profile (P_last_top → L1 → L2 → L3 → L4). Common to all variants. ──
  // L1's radial differs by lip count: double-lip gets a tighter dust lip
  // gap; single-lip clears more axial room before the main lip.
  const L1_y = isDoubleLip ? Y_ID + dust_gap : Y_ID + H * 0.2;
  const L2_y = isDoubleLip ? Y_ID + H * 0.2 : Y_ID + H * 0.15;
  segments.push(
    { kind: 'line', to: p(W, L1_y) },                          // P_last_top → L1
    { kind: 'line', to: p(W * 0.75, L2_y) },                   // L1 → L2
    { kind: 'line', to: p(W * 0.45, Y_ID - lip_interf) },      // L2 → L3 (lip apex)
    { kind: 'line', to: p(W * 0.35, Y_ID + H * 0.15) },        // L3 → L4
  );

  // ── Spring relief (or its V-groove substitute when no spring). ──
  if (hasSpring) {
    // Split the C++ 180° arc into two 90° quarter-arcs through the
    // 3 o'clock midpoint M = (Cs_x + R_s, Cs_y). The bulge points at
    // higher axial — the spring relief opens toward the seal's lip
    // side, with rubber material on the lower-axial side of the arc.
    const sCen = p(Cs_x, Cs_y);
    segments.push(
      { kind: 'line', to: p(Cs_x, Cs_y - R_s) },                            // L4 → L5 (6 o'clock)
      { kind: 'arc',  to: p(Cs_x + R_s, Cs_y), center: sCen, ccw: true },   // 6 → 3
      { kind: 'arc',  to: p(Cs_x, Cs_y + R_s), center: sCen, ccw: true },   // 3 → 12
    );
  } else {
    // No-spring: relaxed lip with a small V-groove. Coordinates from
    // C++ lines 4080-4082 verbatim — these L5/L6/L7 are unrelated to
    // the spring-case homonyms above; same identifier in the source.
    segments.push(
      { kind: 'line', to: p(W * 0.42, Y_ID + H * 0.35) },        // L4 → L5
      { kind: 'line', to: p(W * 0.55, Y_ID + H * 0.40) },        // L5 → L6
      { kind: 'line', to: p(W * 0.50, Y_ID + H * 0.45) },        // L6 → L7
    );
  }

  // ── Closing run L7 → L8 → r1. ──
  segments.push(
    { kind: 'line', to: p(0, Y_ID + H * 0.45) },           // L7 → L8
    { kind: 'line', to: p(0, Y_MID) },                     // L8 → r1 (close)
  );

  const wire = makeProfileWireXZ(oc, p(0, Y_MID), segments);
  return makeRevolZ(oc, wire);
}

/**
 * Build the brass garter spring — a torus revolved around the Z-axis.
 * The wire is a circle of radius R_s centered at (Cs_x, Cs_y) in the
 * XZ profile plane; revolution around Z produces a TOROIDAL_SURFACE
 * that any CAD reader recognises as a clean torus (correct minor /
 * major radii preserved for measurement).
 *
 * The C++ reference draws the circle with two 180° arcs (line 4120-4121).
 * Our short-arc helper rejects exact semicircles, so we use four 90°
 * quarter-arcs at the 3 / 12 / 9 / 6 o'clock points.
 */
function buildGarterSpring(
  oc: unknown,
  Cs_x: number,
  Cs_y: number,
  R_s: number,
): unknown {
  const sCen = p(Cs_x, Cs_y);
  // 3 o'clock starting point — picked arbitrarily; any of the 4
  // cardinal points works since the wire is closed.
  const start = p(Cs_x + R_s, Cs_y);
  const segments: ProfileSegment[] = [
    { kind: 'arc', to: p(Cs_x, Cs_y + R_s), center: sCen, ccw: true },  // 3 → 12
    { kind: 'arc', to: p(Cs_x - R_s, Cs_y), center: sCen, ccw: true },  // 12 → 9
    { kind: 'arc', to: p(Cs_x, Cs_y - R_s), center: sCen, ccw: true },  // 9 → 6
    { kind: 'arc', to: start,               center: sCen, ccw: true },  // 6 → 3 (close)
  ];
  const wire = makeProfileWireXZ(oc, start, segments);
  return makeRevolZ(oc, wire);
}

/**
 * Resolve the OilSealType from the request. The C++ reference reads
 * `m_partData->Info.LipShape` (the partspec column); we look for the
 * same field on `req.dimensions` along with a few common aliases. Any
 * unrecognised / missing value falls back to `SM` to mirror the C++
 * default at `NewCreateBearingClass.h:105`.
 */
function readSealVariant(req: CadGenerateRequest): OilSealVariant {
  const candidates = [
    req.dimensions['LipShape'],
    req.dimensions['lipShape'],
    req.dimensions['lip_shape'],
    req.dimensions['OilSealType'],
    req.dimensions['oilSealType'],
    req.dimensions['SealType'],
    req.dimensions['sealType'],
    req.dimensions['Type'],
    req.dimensions['형식'],
  ];
  for (const v of candidates) {
    if (v == null || v === '') continue;
    const s = String(v).trim().toUpperCase();
    if ((SEAL_VARIANTS as readonly string[]).includes(s)) {
      return s as OilSealVariant;
    }
  }
  return 'SM';
}
