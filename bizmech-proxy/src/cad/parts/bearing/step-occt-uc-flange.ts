/**
 * OCCT-backed STEP generators for UC mounted-unit bearings with
 * FLANGE housings — UCF / UKF / UCFC / UKFC / UCFL / UKFL / UCFS /
 * UKFS. Faithful port of `BearingCreator::CreateFlangeHousing`
 * (`C++Source/NewCreateBearingClass.cpp` line 5166-5346) plus the
 * dispatch wrappers at lines 5972-6038.
 *
 * What's a unit-bearing flange housing
 * ────────────────────────────────────
 * A bolt-on cast-iron / pressed-steel housing that holds a UC (or UK)
 * insert bearing in a spherical seat and provides a flange face for
 * attaching to a machine's mounting plate. Eight partCodes covering
 * four flange shapes:
 *
 *   UCF  / UKF  — Square flange, no socket               (4 holes)
 *   UCFS / UKFS — Square flange WITH socket (spigot)     (4 holes)
 *   UCFC / UKFC — Round flange WITH socket (spigot)      (4 holes at 45°)
 *   UCFL / UKFL — Rhombus / oval flange, no socket       (2 holes)
 *
 * UC vs UK is just bore type (cylindrical vs taper) on the inner ring;
 * the housing geometry is identical, so all 8 codes share these four
 * housing shapes via flag booleans on a unified builder.
 *
 * Geometry / dispatch (C++ line 5166)
 * ───────────────────────────────────
 *   boltHoles  ∈ {2, 4}        // 2 for UCFL / UKFL, 4 for the rest
 *   isRoundBody = boolean      // true for UCFC / UKFC only
 *   hasSpigot  = boolean       // true for UCFS / UKFS / UCFC / UKFC
 *
 * Catalog dimensions used (with C++ fallbacks at line 5177-5187)
 *   L   — flange edge length / OD               (default D2 × 1.8)
 *   J   — bolt pitch                             (default L × 0.7)
 *   A   — flange short-axis width (UCFL only)    (default D2 × 1.1)
 *   FB  — flange base thickness                  (default D2 × 0.25)
 *   HW  — housing total width                    (default D2 × 0.7)
 *   H3  — spigot diameter (UCFS / UCFC only)     (default D2 × 1.3)
 *   f   — spigot depth (UCFS / UCFC only)        (default FB × 0.2)
 *   N   — bolt-hole diameter                     (default L × 0.1, mirrors C++ line 5292)
 *
 * Coordinate convention
 * ─────────────────────
 *   · Z = bearing axis (= C++ X axis)
 *   · Flange face is in the XY plane (= C++ YZ plane)
 *   · Flange BASE extrudes from Z=0 toward −Z by `val_FB`
 *   · BOSS extrudes from Z=0 toward +Z by `bossHeight = HW − FB`
 *   · SPIGOT extrudes from Z=−FB toward −Z by `val_f`
 *
 * Simplifications vs C++
 * ──────────────────────
 *   1. Rhombus / oval flange (UCFL / UKFL): the C++ has both a complex
 *      stadium-shape construction (3 tangent circles, line 5200-5236)
 *      AND a simplified rectangular fallback (`CreateOvalFlangeHousing`
 *      line 6244 "Simplified as rectangle"). We use the simplified
 *      rectangle (L × A); refining to the proper stadium is a future
 *      cleanup once a real DB row needs it.
 *   2. Spherical seat: built as a plain `boolCut` of an outerR-radius
 *      sphere from the housing's centre. The C++'s `CreateSphericalSeat
 *      Cut` (line 4696) carves a pair of spherical arcs plus a central
 *      oil groove; we omit the oil groove (cosmetic).
 *   3. Grease-nipple hole on the boss: skipped (cosmetic).
 *   4. Corner round cuts on the square flange's corners (C++ line
 *      5158-5209): skipped.
 */
import type { CadGenerateRequest, CadGenerateResult } from '../../types.js';
import { FORMAT_EXT, FORMAT_MIME } from '../../types.js';
import {
  boolCut,
  boolFuse,
  exportStepBytes,
  flattenBrepWithVoidsToManifolds,
  getOcct,
  makeBox,
  makeCylinder,
  makeSphere,
  mergeShapesIntoMultibodySolid,
  translateShape,
} from '../../core/occt.js';
import { bomFileName } from '../../core/bom-meta.js';
import type { BearingDims } from './dimensions.js';
import { buildUcbBodyShapes } from './step-occt-uc.js';

interface FlangeHousingOpts {
  boltHoles: 2 | 4;
  isRoundBody: boolean;
  hasSpigot: boolean;
}

// ── Public entry points — one per partCode group ──

/** UCF / UKF — square flange, 4 bolt holes, no socket. */
export async function buildUcfStepViaOcct(
  req: CadGenerateRequest,
  dims: BearingDims,
): Promise<CadGenerateResult> {
  return buildUnitBearing(req, dims, {
    boltHoles: 4,
    isRoundBody: false,
    hasSpigot: false,
  });
}

/** UCFS / UKFS — square flange, 4 bolt holes, with socket / spigot. */
export async function buildUcfsStepViaOcct(
  req: CadGenerateRequest,
  dims: BearingDims,
): Promise<CadGenerateResult> {
  return buildUnitBearing(req, dims, {
    boltHoles: 4,
    isRoundBody: false,
    hasSpigot: true,
  });
}

/** UCFC / UKFC — round flange, 4 bolt holes at 45°, with socket. */
export async function buildUcfcStepViaOcct(
  req: CadGenerateRequest,
  dims: BearingDims,
): Promise<CadGenerateResult> {
  return buildUnitBearing(req, dims, {
    boltHoles: 4,
    isRoundBody: true,
    hasSpigot: true,
  });
}

/** UCFL / UKFL — rhombus / oval flange (simplified rectangle), 2 bolt holes. */
export async function buildUcflStepViaOcct(
  req: CadGenerateRequest,
  dims: BearingDims,
): Promise<CadGenerateResult> {
  return buildUnitBearing(req, dims, {
    boltHoles: 2,
    isRoundBody: false,
    hasSpigot: false,
  });
}

// ── Shared implementation ──

async function buildUnitBearing(
  req: CadGenerateRequest,
  dims: BearingDims,
  opts: FlangeHousingOpts,
): Promise<CadGenerateResult> {
  const started = Date.now();
  const oc = await getOcct();

  // 1. Build the UC bearing body shapes (reuses the existing UCB code).
  const bearing = await buildUcbBodyShapes(oc, req, dims);

  // 2. Build the housing solid sized to the bearing's outer sphere.
  const housing = buildFlangeHousing(oc, req, dims, opts);

  // 3. Multi-body merge. Order matters for STEP readers — keep the
  //    housing first so it's the dominant solid in tree views.
  const merged = mergeShapesIntoMultibodySolid(oc, [
    housing,
    bearing.innerRing,
    bearing.outerRing,
    ...bearing.rollingBodies,
  ]);

  const rawStep = exportStepBytes(oc, merged);
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
 * Build the housing solid for the four flange variants. Order of
 * operations:
 *   1. Flange base (square / round / rectangle) extruded to -Z.
 *   2. Boss (cylinder centred on Z) extruded to +Z.
 *   3. Optional spigot (cylinder) extruded to -Z behind the base.
 *   4. Boolean-cut a sphere from the centre (the bearing seat).
 *   5. Boolean-cut a through-bore cylinder along Z.
 *   6. Boolean-cut N bolt holes along Z.
 */
function buildFlangeHousing(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  oc: any,
  req: CadGenerateRequest,
  dims: BearingDims,
  opts: FlangeHousingOpts,
): unknown {
  const outerR = dims.D2 / 2;

  // ── Catalog reads with C++ fallbacks (line 5177-5187). ──
  const val_L = readPositive(req, 'L', 'flangeOD') ?? dims.D2 * 1.8;
  const val_A = readPositive(req, 'A') ?? dims.D2 * 1.1;
  const val_FB = readPositive(req, 'FB', 'A1') ?? dims.D2 * 0.25;
  const val_J = readPositive(req, 'J') ?? val_L * 0.7;
  const val_HW = readPositive(req, 'HW') ?? dims.D2 * 0.7;
  const val_H3 = readPositive(req, 'H3') ?? dims.D2 * 1.3;
  const val_f = readPositive(req, 'f') ?? val_FB * 0.2;
  const val_N = readPositive(req, 'N') ?? val_L * 0.1;

  let bossHeight = val_HW - val_FB;
  if (bossHeight <= 0) bossHeight = val_FB * 0.5;

  // C++ line 5250 — boss diameter follows H3 if present, else 1.15 × D2.
  const frontBossDia =
    val_H3 > 0 ? val_H3 * 0.9 : dims.D2 * 1.15;
  const bossR = frontBossDia / 2;

  if (val_J >= val_L) {
    throw new Error(
      `Unit-bearing housing ${req.partCode}: bolt pitch J=${val_J} ≥ flange L=${val_L} ` +
        `— bolt holes would fall outside the flange.`,
    );
  }

  // ── 1. Flange base ──
  const halfL = val_L / 2;
  let base: unknown;
  if (opts.isRoundBody) {
    // Round: cylinder of radius L/2, axis along Z, extruded by FB.
    // makeCylinder's base is at origin; translate so it occupies [-FB, 0].
    const rawCyl = makeCylinder(oc, halfL, val_FB);
    base = translateShape(oc, rawCyl, 0, 0, -val_FB);
  } else if (opts.boltHoles === 4) {
    // Square: L × L extruded by FB.
    const rawBox = makeBox(oc, val_L, val_L, val_FB);
    // makeBox occupies [0,L] × [0,L] × [0,FB]; centre on origin, push to -Z.
    base = translateShape(oc, rawBox, -halfL, -halfL, -val_FB);
  } else {
    // Rhombus / oval (UCFL): simplified rectangle L × A. The "long"
    // axis (L) is along Y (perpendicular-but-perpendicular to bolt
    // alignment), with bolt holes at ±J/2 along Y. Match the C++
    // `CreateOvalFlangeHousing` simplification at line 6244-6276.
    const rawBox = makeBox(oc, val_A, val_L, val_FB);
    base = translateShape(oc, rawBox, -val_A / 2, -halfL, -val_FB);
  }

  // ── 2. Front boss (always a cylinder, centred on Z, +Z direction). ──
  // makeCylinder bottom is at origin; with base ending at z=0 the boss
  // grows from z=0 to z=bossHeight.
  const boss = makeCylinder(oc, bossR, bossHeight);

  let housing = boolFuse(oc, base, boss);

  // ── 3. Optional spigot (back-side cylinder for UCFS / UCFC). ──
  if (opts.hasSpigot) {
    const spigotR = val_H3 / 2;
    const spigotRaw = makeCylinder(oc, spigotR, val_f);
    // Place behind the flange base — back face at z = -FB - f, front face at z = -FB.
    const spigot = translateShape(oc, spigotRaw, 0, 0, -val_FB - val_f);
    housing = boolFuse(oc, housing, spigot);
  }

  // ── 4. Spherical seat (subtract a sphere of bearing OD from centre). ──
  // The bearing's outer ring has SPHERICAL_SURFACE OD of radius outerR
  // centred at the origin. A matching cavity in the housing lets the
  // bearing sit and self-align. Add 0.05 mm clearance so the boolean
  // doesn't tangentially touch the bearing's outer surface (which
  // makes OCCT's BOP fragile on some catalog rows).
  const seat = makeSphere(oc, [0, 0, 0], outerR + 0.05);
  housing = boolCut(oc, housing, seat);

  // ── 5. Through-bore cylinder along Z. ──
  // Radius = 85 % of bearing OD (C++ line 5282). Length must comfortably
  // span the entire housing axially in both directions so the cut
  // doesn't leave a thin film of metal at either face.
  const boreR = outerR * 0.85;
  const totalAxialExtent =
    bossHeight + val_FB + (opts.hasSpigot ? val_f : 0) + 2; // +2 for safe overshoot
  const boreCylRaw = makeCylinder(oc, boreR, totalAxialExtent * 2);
  const boreCyl = translateShape(oc, boreCylRaw, 0, 0, -totalAxialExtent);
  housing = boolCut(oc, housing, boreCyl);

  // ── 6. Bolt holes along Z. ──
  const boltR = val_N / 2;
  const j2 = val_J / 2;
  const holeLen = totalAxialExtent * 2;

  const holePositions: Array<[number, number]> = [];
  if (opts.boltHoles === 4) {
    if (opts.isRoundBody) {
      // Round: 4 at 45° on PCD = J — C++ line 5294-5300.
      const c45 = Math.SQRT1_2; // cos 45° = sin 45°
      holePositions.push(
        [j2 * c45, j2 * c45],
        [-j2 * c45, j2 * c45],
        [-j2 * c45, -j2 * c45],
        [j2 * c45, -j2 * c45],
      );
    } else {
      // Square: 4 corners — C++ line 5302-5308.
      holePositions.push(
        [j2, j2],
        [-j2, j2],
        [-j2, -j2],
        [j2, -j2],
      );
    }
  } else {
    // 2-hole (UCFL): along the long axis (Y in our simplified rect).
    holePositions.push([0, j2], [0, -j2]);
  }

  for (const [x, y] of holePositions) {
    const holeRaw = makeCylinder(oc, boltR, holeLen);
    const hole = translateShape(oc, holeRaw, x, y, -totalAxialExtent);
    housing = boolCut(oc, housing, hole);
  }

  return housing;
}

function readPositive(req: CadGenerateRequest, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = req.dimensions[k];
    if (v == null || v === '') continue;
    const n = typeof v === 'number' ? v : parseFloat(String(v));
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}
