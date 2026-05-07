/**
 * OCCT-backed STEP generator for the Oilless family — non-rolling
 * oil-impregnated bushings, washers, plates, spherical bearings, and
 * guide pins. Faithful port of `BearingCreator::CreateOillessComponent`
 * (`C++Source/NewCreateBearingClass.cpp` line 4543-4615) plus its
 * profile helpers (`DrawSleeveProfile` 4148, `DrawFlangeProfile` 4182,
 * `DrawWasherProfile` 4217, `DrawPlateProfile` 4242, `DrawSphericalProfile`
 * 4264, `DrawPinProfile` 4295).
 *
 * Six shape types — all dispatched from one file
 * ──────────────────────────────────────────────
 *   Sleeve       — plain hollow cylinder            (d1, D2, L)
 *   Flange       — flanged sleeve                   (d1, D2, FD, T, L)
 *   ThrustWasher — flat annular disc                (d1, D2, T)
 *   Plate        — rectangular block (extrude!)     (B, L, T)
 *   Spherical    — sleeve with bulged spherical OD  (d1, D2, L; R = D2·1.1/2)
 *   Pin          — solid pin, plain or headed       (D2, L; opt FD, T)
 *
 * Note Plate is the only one that's NOT a solid of revolution — it's
 * an axis-aligned extrusion of a B×L rectangle by T (`makeBox`). The
 * other five are revolved profiles around the Z-axis.
 *
 * Skipped vs. C++
 * ───────────────
 * `AddSpecificDetails` (line 4335) layers in cosmetic features —
 * graphite-plug pattern, mounting holes, DRY-bearing slit, CBP V-groove,
 * LUBOGPP tap hole. None affects measurable bearing dimensions; all
 * deferred. The downloaded STEP is a clean primary-shape solid.
 *
 * Catalog overrides bug
 * ─────────────────────
 * The C++ profile helpers (Flange/Washer/Plate/Spherical/Pin) include
 * leftover hardcoded overrides like `Y_ID = 15.0 / m_unit;` after the
 * DB-read block — they always force fixed dimensions regardless of the
 * catalog row. These are clearly debug code per the project's "match
 * C++ when it works, deviate when clearly buggy" rule, so we use the
 * DB values directly.
 *
 * partCode → shape mapping
 * ────────────────────────
 * Mirrors `BearingCreator::SetBearingType` line 8516-8546 with two
 * fixes: (1) Plate-suffix codes (SWURWP, SWURSCBP) take precedence
 * over their Sleeve / ThrustWasher prefixes (SWURW, SWUCBP); (2)
 * Flange-suffix codes (LUBOHBF) take precedence over their Sleeve
 * prefix (LUBOHB). The C++ checks Sleeve first and would mis-classify
 * "LUBOHBF" as Sleeve.
 */
import type { CadGenerateRequest, CadGenerateResult } from '../../types.js';
import { FORMAT_EXT, FORMAT_MIME } from '../../types.js';
import {
  exportStepBytes,
  flattenBrepWithVoidsToManifolds,
  getOcct,
  makeBox,
  makeProfileWireXZ,
  makeRevolZ,
  type ProfilePoint2D,
  type ProfileSegment,
} from '../../core/occt.js';
import { bomFileName } from '../../core/bom-meta.js';

export type OillessShape =
  | 'Sleeve' | 'Flange' | 'ThrustWasher' | 'Plate' | 'Spherical' | 'Pin';

const p = (axial: number, radial: number): ProfilePoint2D => [radial, axial];

/**
 * partCode substring → shape mapping. Order matters: more-specific
 * codes (Flange / Plate) are listed before their Sleeve / ThrustWasher
 * substring siblings to avoid the C++ misclassification bugs noted in
 * the file header.
 */
const SHAPE_PATTERNS: ReadonlyArray<readonly [string, OillessShape]> = [
  // Flange — must precede Sleeve since LUBOHBF / LUBOHFB contain LUBOHB.
  ['SWURFB',  'Flange'],
  ['DRYFBUSH','Flange'],
  ['LUBOHBF', 'Flange'],
  ['LUBOHFB', 'Flange'],
  ['LUBOLBFG','Flange'],
  // Plate — must precede ThrustWasher (SWURWP contains SWURW) and
  // Spherical / Sleeve substrings.
  ['SWURSCBP','Plate'],
  ['SWUCBP',  'Plate'],
  ['SWURWP',  'Plate'],
  ['SWURSP',  'Plate'],
  ['SWURSL',  'Plate'],
  // ThrustWasher
  ['SWURFF',  'ThrustWasher'],
  ['DRYTWAS', 'ThrustWasher'],
  ['LUBOLBTB','ThrustWasher'],
  ['LUBOTW',  'ThrustWasher'],
  ['SWURW',   'ThrustWasher'],
  // Spherical
  ['SWUROB',  'Spherical'],
  ['LUBOLUBS','Spherical'],
  // Pin
  ['LUBOGPP', 'Pin'],
  // Sleeve — catch-all, listed last because its substrings overlap with
  // the more-specific codes above.
  ['DRYBUSH', 'Sleeve'],
  ['LUBOLBGS','Sleeve'],
  ['LUBOLEBG','Sleeve'],
  ['LUBOHGB', 'Sleeve'],
  ['LUBOLBG', 'Sleeve'],
  ['LUBOHB',  'Sleeve'],
  ['SWURZB',  'Sleeve'],
  ['SWURB',   'Sleeve'],
];

/** Every partCode that the Oilless dispatcher claims. */
export const OILLESS_CODES: readonly string[] = SHAPE_PATTERNS.map(([code]) => code);

/**
 * Resolve the OillessShape for a partCode, or `null` if no pattern
 * matched. Substring matching is intentional — the C++ uses
 * `CString::Find()` so partial matches (e.g. real partspec rows like
 * "DRYBUSH-12-15") still classify correctly.
 */
export function classifyOillessShape(partCode: string): OillessShape | null {
  const code = partCode.toUpperCase();
  for (const [pattern, shape] of SHAPE_PATTERNS) {
    if (code.includes(pattern)) return shape;
  }
  return null;
}

export async function buildOillessStepViaOcct(
  req: CadGenerateRequest,
): Promise<CadGenerateResult> {
  const started = Date.now();
  const oc = await getOcct();

  const shape = classifyOillessShape(req.partCode);
  if (!shape) {
    throw new Error(
      `Oilless: partCode "${req.partCode}" did not match any known shape ` +
        `pattern. Add it to SHAPE_PATTERNS in step-occt-oilless.ts.`,
    );
  }

  const isDry = req.partCode.toUpperCase().includes('DRY');

  let body: unknown;
  switch (shape) {
    case 'Sleeve':       body = buildSleeve(oc, req, isDry); break;
    case 'Flange':       body = buildFlange(oc, req); break;
    case 'ThrustWasher': body = buildThrustWasher(oc, req); break;
    case 'Plate':        body = buildPlate(oc, req); break;
    case 'Spherical':    body = buildSpherical(oc, req); break;
    case 'Pin':          body = buildPin(oc, req); break;
  }

  const rawStep = exportStepBytes(oc, body);
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
 * Read the first positive numeric value from `req.dimensions` matching
 * any of the supplied keys. Returns `null` when nothing usable is
 * present so the caller can apply a per-shape default.
 */
function readPositive(req: CadGenerateRequest, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = req.dimensions[k];
    if (v == null || v === '') continue;
    const n = typeof v === 'number' ? v : parseFloat(String(v));
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

// ──────────────────────────────────────────────────────────────────────
// Shape builders. Each produces one revolved (or extruded) solid.
// Coordinate convention: C++ sketch coord (axial, radial) maps to
// OCCT XZ profile [radial, axial] via the `p` helper at top of file.
// ──────────────────────────────────────────────────────────────────────

/**
 * Plain hollow sleeve — port of `DrawSleeveProfile` (line 4148).
 * Falls back to the C++'s DRY-thinwall rule when D2 is absent (Y_OD =
 * Y_ID + 1.5 mm), reproducing the wrap-and-fold sheet-metal bushing
 * geometry of the dry family.
 */
function buildSleeve(oc: unknown, req: CadGenerateRequest, isDry: boolean): unknown {
  const d1 = readPositive(req, 'd1', 'd', 'bore', '내경') ?? 15;
  let D2 = readPositive(req, 'D2', 'D', 'OD', '외경');
  const L = readPositive(req, 'L', 'length', '길이') ?? 30;
  if (D2 == null) D2 = isDry ? d1 + 1.5 : 20;
  if (D2 <= d1) {
    throw new Error(
      `Oilless Sleeve ${req.partCode}: D2 (${D2}) must exceed d1 (${d1}).`,
    );
  }

  const Y_ID = d1 / 2;
  const Y_OD = D2 / 2;
  const segments: ProfileSegment[] = [
    { kind: 'line', to: p(0, Y_OD) },
    { kind: 'line', to: p(L, Y_OD) },
    { kind: 'line', to: p(L, Y_ID) },
    { kind: 'line', to: p(0, Y_ID) },
  ];
  const wire = makeProfileWireXZ(oc, p(0, Y_ID), segments);
  return makeRevolZ(oc, wire);
}

/**
 * Flanged sleeve — port of `DrawFlangeProfile` (line 4182). Six-edge
 * profile with the flange (radial = Y_FD) at the axial=0 face and the
 * sleeve OD (Y_OD) running from axial=T to axial=L.
 */
function buildFlange(oc: unknown, req: CadGenerateRequest): unknown {
  const d1 = readPositive(req, 'd1', 'd', 'bore') ?? 15;
  const D2 = readPositive(req, 'D2', 'D', 'OD') ?? 20;
  const FD = readPositive(req, 'FD', 'flangeOD') ?? 25;
  const T  = readPositive(req, 'T', 'thickness', '두께') ?? 5;
  const L  = readPositive(req, 'L', 'length') ?? 30;
  if (D2 <= d1 || FD <= D2 || T <= 0 || L <= T) {
    throw new Error(
      `Oilless Flange ${req.partCode}: invalid geometry ` +
        `(d1=${d1}, D2=${D2}, FD=${FD}, T=${T}, L=${L}).`,
    );
  }

  const Y_ID = d1 / 2;
  const Y_OD = D2 / 2;
  const Y_FD = FD / 2;
  const segments: ProfileSegment[] = [
    { kind: 'line', to: p(0, Y_FD) },           // p1 → p2
    { kind: 'line', to: p(T, Y_FD) },           // p2 → p3
    { kind: 'line', to: p(T, Y_OD) },           // p3 → p4
    { kind: 'line', to: p(L, Y_OD) },           // p4 → p5
    { kind: 'line', to: p(L, Y_ID) },           // p5 → p6
    { kind: 'line', to: p(0, Y_ID) },           // p6 → p1 (close)
  ];
  const wire = makeProfileWireXZ(oc, p(0, Y_ID), segments);
  return makeRevolZ(oc, wire);
}

/**
 * Flat annular thrust washer — port of `DrawWasherProfile` (line 4217).
 * Same rectangular profile as Sleeve but `T` plays the role of L —
 * thin disk extending from Y_ID to Y_OD axially [0, T].
 */
function buildThrustWasher(oc: unknown, req: CadGenerateRequest): unknown {
  const d1 = readPositive(req, 'd1', 'd') ?? 15;
  const D2 = readPositive(req, 'D2', 'D') ?? 25;
  const T  = readPositive(req, 'T', 'thickness') ?? 3;
  if (D2 <= d1) {
    throw new Error(`Oilless ThrustWasher ${req.partCode}: D2 (${D2}) ≤ d1 (${d1}).`);
  }

  const Y_ID = d1 / 2;
  const Y_OD = D2 / 2;
  const segments: ProfileSegment[] = [
    { kind: 'line', to: p(0, Y_OD) },
    { kind: 'line', to: p(T, Y_OD) },
    { kind: 'line', to: p(T, Y_ID) },
    { kind: 'line', to: p(0, Y_ID) },
  ];
  const wire = makeProfileWireXZ(oc, p(0, Y_ID), segments);
  return makeRevolZ(oc, wire);
}

/**
 * Rectangular plate — port of `DrawPlateProfile` (line 4242) +
 * extrude block at line 4574-4596. The C++ handles a partCode-based
 * thickness fallback (SWURSL → 5 mm thin liner; SWUCBP / SWURSCBP →
 * 30 mm cam-bottom block; else 15 mm wear plate); we mirror that.
 *
 * Unlike the other shapes this is NOT a solid of revolution — it's a
 * B × L × T axis-aligned box. Built via `makeBox` which is much faster
 * than going through wire / face / extrude primitives.
 */
function buildPlate(oc: unknown, req: CadGenerateRequest): unknown {
  const B = readPositive(req, 'B', 'width', '폭') ?? 30;
  const L = readPositive(req, 'L', 'length', '길이') ?? 50;

  const code = req.partCode.toUpperCase();
  const defaultT =
    code.includes('SWURSL') ? 5 :
    code.includes('SWUCBP') || code.includes('SWURSCBP') ? 30 :
    15;
  const T = readPositive(req, 'T', 'thickness', '두께') ?? defaultT;

  return makeBox(oc, B, L, T);
}

/**
 * Spherical-OD sleeve — port of `DrawSphericalProfile` (line 4264).
 * The OD bulges outward in a circular arc instead of a straight
 * cylinder; useful for self-aligning slide-bearing applications.
 *
 * The C++ derives R = Y_OD · 1.1 (10 % over the nominal OD) and trims
 * the arc to start / end at radial = `drop = sqrt(R² − (L/2)²)`. The
 * arc passes through (axial=L/2, radial=R) — the apex — making the
 * sphere sit at the axial midpoint.
 *
 * Our short-arc helper picks the bulged arc automatically (the only
 * < π arc between the two endpoints on this circle is the upper one
 * passing through the apex).
 */
function buildSpherical(oc: unknown, req: CadGenerateRequest): unknown {
  const d1 = readPositive(req, 'd1', 'd') ?? 15;
  const D2 = readPositive(req, 'D2', 'D') ?? 25;
  const L  = readPositive(req, 'L', 'length') ?? 20;
  if (D2 <= d1) {
    throw new Error(`Oilless Spherical ${req.partCode}: D2 (${D2}) ≤ d1 (${d1}).`);
  }

  const Y_ID = d1 / 2;
  const Y_OD = D2 / 2;
  const R = Y_OD * 1.1;
  if (R <= L / 2) {
    throw new Error(
      `Oilless Spherical ${req.partCode}: bulge radius R=${R.toFixed(3)} ≤ L/2=${(L / 2).toFixed(3)} ` +
        `— catalog L is too long relative to D2 for the C++'s 1.1× formula.`,
    );
  }
  const drop = Math.sqrt(R * R - (L / 2) * (L / 2));
  if (drop <= Y_ID) {
    throw new Error(
      `Oilless Spherical ${req.partCode}: arc starts below bore (drop=${drop.toFixed(3)} ≤ Y_ID=${Y_ID}).`,
    );
  }

  const segments: ProfileSegment[] = [
    { kind: 'line', to: p(0, drop) },                                    // p1 → p2
    { kind: 'arc',  to: p(L, drop), center: p(L / 2, 0), ccw: false },   // p2 → p3 (bulge through apex)
    { kind: 'line', to: p(L, Y_ID) },                                    // p3 → p4
    { kind: 'line', to: p(0, Y_ID) },                                    // p4 → p1 (close)
  ];
  const wire = makeProfileWireXZ(oc, p(0, Y_ID), segments);
  return makeRevolZ(oc, wire);
}

/**
 * Solid pin — port of `DrawPinProfile` (line 4295). Plain straight
 * cylinder when only D2 + L are provided; switches to a stepped
 * profile (head + shank) when both FD and T are present in the
 * catalog row, mirroring the C++ branch at line 4310.
 *
 * The closing edge runs along the Z-axis (radial=0). OCCT's revolve
 * collapses this to the rotation axis, producing a normal solid pin
 * with no interior cavity.
 */
function buildPin(oc: unknown, req: CadGenerateRequest): unknown {
  const D2 = readPositive(req, 'D2', 'D') ?? 10;
  const L  = readPositive(req, 'L', 'length') ?? 50;
  const FD = readPositive(req, 'FD', 'headOD');
  const T  = readPositive(req, 'T', 'headThk');

  const Y_OD = D2 / 2;

  if (FD != null && T != null && FD > D2 && T > 0 && T < L) {
    const Y_Head = FD / 2;
    const segments: ProfileSegment[] = [
      { kind: 'line', to: p(0, Y_Head) },     // p1 → p2
      { kind: 'line', to: p(T, Y_Head) },     // p2 → p3
      { kind: 'line', to: p(T, Y_OD) },       // p3 → p4
      { kind: 'line', to: p(L, Y_OD) },       // p4 → p5
      { kind: 'line', to: p(L, 0) },          // p5 → p6
      { kind: 'line', to: p(0, 0) },          // p6 → p1 (close along axis)
    ];
    const wire = makeProfileWireXZ(oc, p(0, 0), segments);
    return makeRevolZ(oc, wire);
  }

  // Plain straight pin — solid cylinder.
  const segments: ProfileSegment[] = [
    { kind: 'line', to: p(0, Y_OD) },
    { kind: 'line', to: p(L, Y_OD) },
    { kind: 'line', to: p(L, 0) },
    { kind: 'line', to: p(0, 0) },
  ];
  const wire = makeProfileWireXZ(oc, p(0, 0), segments);
  return makeRevolZ(oc, wire);
}
