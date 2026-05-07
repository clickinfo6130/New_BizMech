/**
 * OCCT-backed STEP generator for spherical roller bearings (SARB).
 *
 * Faithful port of `BearingCreator::CreateSphericalRollerBearing`
 * (`C++Source/NewCreateBearingClass.cpp` line 2221–2412). The bearing
 * is rendered as 2 rings + 2 rows of N "barrel" rollers — although the
 * C++ reference simplifies the rollers to plain CYLINDERs (not true
 * barrel-shaped surfaces), we match that to keep the geometry self-
 * consistent with the C++ reference's catalog ratios. Cage / guide-ring
 * cosmetic features are skipped (they're decorative, not measurable).
 *
 * Geometry overview (matches C++ formulas line 2238-2249)
 * ───────────────────────────────────────────────────────
 *   D_pw    = (d1 + D2) / 2                   // pitch diameter
 *   D_W     = (D2 - d1) × 0.25                // roller diameter
 *   roller_cx = B × 0.25                      // axial offset of each row
 *   roller_cy = D_pw / 2                      // pitch radius
 *   R_c     = √(roller_cx² + roller_cy²)      // origin → roller-centre
 *   R_sph   = R_c + D_W/2                     // outer raceway sphere radius
 *   L_eff   = B × 0.35                        // roller length
 *   numRollers/row = ⌊π · D_pw / (D_W × 1.4)⌋
 *
 *   shoulder_Y = D_pw/2 − D_W/2 + B × 0.04    // inner-ring shoulder peak
 *   groove_Y   = D_pw/2 − D_W/2               // inner-ring valley
 *
 * Roller axis tilt
 * ────────────────
 * The roller's revolution axis is perpendicular to the line from the
 * bearing centre to the roller centre — i.e. tangent to the outer
 * raceway sphere at the contact point. C++ encodes this as
 *   (cos_a, sin_a) = (roller_cy / R_c, −roller_cx / R_c)
 * — the unit vector of the perpendicular direction. We carry the same
 * formulas verbatim and feed them to `makeRevolAroundAxis`.
 *
 * Coordinate convention — same as DGBB / SCRB / TRB / SABB:
 *   · Z = bearing axis (axis of revolution for the rings + circular pattern)
 *   · Profiles in XZ plane (Y=0): X = radial, Z = axial
 *
 * NOTE: the C++ source's `boreType = Tapered` hardcode at line 2236
 * forces every SARB to a 1:12 tapered bore. We follow that — the
 * imported part will have a measurably tapered bore (one face at d1,
 * the opposite face at d1 + B/12). If a future request needs a
 * cylindrical-bore SARB, expose `boreType` via `m_options` / a new
 * partspec field and toggle here.
 */
import type { CadGenerateRequest, CadGenerateResult } from '../../types.js';
import { FORMAT_EXT, FORMAT_MIME } from '../../types.js';
import {
  exportStepBytes,
  flattenBrepWithVoidsToManifolds,
  getOcct,
  makeProfileWireXZ,
  makeRevolAroundAxis,
  makeRevolZ,
  mergeShapesIntoMultibodySolid,
  rotateShapeAroundZ,
  type ProfileSegment,
} from '../../core/occt.js';
import { bomFileName } from '../../core/bom-meta.js';
import type { BearingDims } from './dimensions.js';

const C_PLUS_PLUS_ROLLER_DIA_RATIO = 0.25;
const C_PLUS_PLUS_ROLLER_LEN_RATIO = 0.35;
const C_PLUS_PLUS_ROLLER_AXIAL_RATIO = 0.25;
const C_PLUS_PLUS_SHOULDER_OFFSET_RATIO = 0.04;
const C_PLUS_PLUS_TAPER_RECIPROCAL = 24; // 1:12 radius taper = 1/24 over diameter
const ROLLER_GAP_FACTOR = 1.4;
const CLAMPED_B_SAFETY = 0.9; // cap clamped_B at 0.9·R_sph (line 2267)

export async function buildSarbStepViaOcct(
  req: CadGenerateRequest,
  dims: BearingDims,
): Promise<CadGenerateResult> {
  const started = Date.now();
  const oc = await getOcct();

  // ── 1. Geometry constants (line 2238-2249) ──
  const D_pw = (dims.d1 + dims.D2) / 2;
  const D_W = (dims.D2 - dims.d1) * C_PLUS_PLUS_ROLLER_DIA_RATIO;
  const roller_cx = dims.B * C_PLUS_PLUS_ROLLER_AXIAL_RATIO;
  const roller_cy = D_pw / 2;
  const R_c = Math.hypot(roller_cx, roller_cy);
  const R_sph = R_c + D_W / 2;
  const L_eff = dims.B * C_PLUS_PLUS_ROLLER_LEN_RATIO;

  if (R_sph <= 0 || D_W <= 0 || L_eff <= 0) {
    throw new Error(
      `SARB ${req.partCode}: degenerate ratio output — D_W=${D_W.toFixed(3)} ` +
        `R_sph=${R_sph.toFixed(3)} L_eff=${L_eff.toFixed(3)}.`,
    );
  }

  const halfB = dims.B / 2;
  const clamped_B = Math.min(halfB, R_sph * CLAMPED_B_SAFETY);
  const Y_edge = Math.sqrt(R_sph * R_sph - clamped_B * clamped_B);

  // Roller axis unit vector: perpendicular to (origin → roller centre).
  // (cos_a, sin_a) is in C++ (axial, radial) sketch coords; in our
  // [radial, axial] notation it becomes (cos_a → radial component,
  // sin_a → axial component). Using the C++ name carries through the
  // C++ formulas with no sign confusion later.
  const cos_a = roller_cy / R_c;
  const sin_a = -roller_cx / R_c;
  const N_x = -sin_a; // outward-normal axial component
  const N_y = cos_a; // outward-normal radial component

  // Inner-ring shoulder + groove levels (line 2289-2290).
  const shoulder_Y = D_pw / 2 - D_W / 2 + dims.B * C_PLUS_PLUS_SHOULDER_OFFSET_RATIO;
  const groove_Y = D_pw / 2 - D_W / 2;

  // Tapered bore — one side at d1/2, the other at d1/2 + B/24
  // (1:12 diameter taper = 1:24 radius over the full width).
  const innerRadiusR = dims.d1 / 2;
  const innerRadiusL = innerRadiusR + (clamped_B * 2) / C_PLUS_PLUS_TAPER_RECIPROCAL;

  // ── 2. Outer ring profile (4 edges: 3 lines + 1 spherical arc) ──
  // CCW loop in [radial, axial]:
  //   pB1 = [D2/2, -clamped_B] → pB2 = [D2/2, +clamped_B]   (top OD face)
  //   pB2 → pB3 = [Y_edge, +clamped_B]                       (right wall)
  //   pB3 → pB4 = [Y_edge, -clamped_B]                       (spherical arc)
  //   pB4 → pB1                                              (left wall, closes)
  const outerR = dims.D2 / 2;
  const outerRingFace = makeProfileWireXZ(
    oc,
    [outerR, -clamped_B], // pB1
    [
      // 1. Top OD face (axial increasing, radial = outerR).
      { kind: 'line', to: [outerR, clamped_B] },
      // 2. Right wall (radial decreasing to spherical raceway entry).
      { kind: 'line', to: [Y_edge, clamped_B] },
      // 3. Spherical raceway arc — center [0, 0], radius R_sph, dipping
      //    OUTWARD (toward larger radial) on the metal side. The short
      //    arc passes through [R_sph, 0] which is ≥ Y_edge ⇒ inside
      //    the outer-ring metal. The C++ ccw=true flag is irrelevant
      //    here; our profile builder always picks the short arc.
      {
        kind: 'arc',
        to: [Y_edge, -clamped_B],
        center: [0, 0],
        ccw: false,
      },
      // 4. Left wall — radial increasing back to OD, closes loop.
      { kind: 'line', to: [outerR, -clamped_B] },
    ] satisfies ProfileSegment[],
  );
  const outerRing = makeRevolZ(oc, outerRingFace);

  // ── 3. Inner ring profile (7 lines, two V-grooves with peak) ──
  // Match C++ pI1..pI7 (line 2301-2307); CCW in [radial, axial]:
  //   pI1 = [innerRadiusR, +clamped_B]   right wall bottom (smaller bore)
  //   pI2 = [shoulder_Y, +clamped_B]     right wall top
  //   pI3 = [groove_Y, +roller_cx]       right groove valley
  //   pI4 = [shoulder_Y, 0]              centre peak
  //   pI5 = [groove_Y, -roller_cx]       left groove valley
  //   pI6 = [shoulder_Y, -clamped_B]     left wall top
  //   pI7 = [innerRadiusL, -clamped_B]   left wall bottom (larger bore — taper)
  //   pI7 → pI1: tapered bore, closes the loop
  const innerRingFace = makeProfileWireXZ(
    oc,
    [innerRadiusR, clamped_B], // pI1
    [
      // 1. pI1 → pI2: right wall up.
      { kind: 'line', to: [shoulder_Y, clamped_B] },
      // 2. pI2 → pI3: descend right shoulder to right groove valley.
      { kind: 'line', to: [groove_Y, roller_cx] },
      // 3. pI3 → pI4: ascend right groove to centre peak.
      { kind: 'line', to: [shoulder_Y, 0] },
      // 4. pI4 → pI5: descend centre peak to left groove valley.
      { kind: 'line', to: [groove_Y, -roller_cx] },
      // 5. pI5 → pI6: ascend left groove to left shoulder.
      { kind: 'line', to: [shoulder_Y, -clamped_B] },
      // 6. pI6 → pI7: left wall down (radial decreasing to taper bore).
      { kind: 'line', to: [innerRadiusL, -clamped_B] },
      // 7. pI7 → pI1: tapered bore (radial decreasing if innerRadiusL >
      //    innerRadiusR). Closes the loop.
      { kind: 'line', to: [innerRadiusR, clamped_B] },
    ] satisfies ProfileSegment[],
  );
  const innerRing = makeRevolZ(oc, innerRingFace);

  // ── 4. Rollers — two rows of N tilted cylinders ──
  // Right row: profile centred at (roller_cy, +roller_cx) with axis
  // direction (cos_a, sin_a) in [radial, axial]. Profile is a closed
  // parallelogram p1-p2-p3-p4 where:
  //   p1, p2 lie on the revolution axis (axis side of profile)
  //   p4, p3 are offset by D_W/2 in the outward-normal direction
  // Revolving the profile around the (p1, p2) axis produces a cylinder
  // of radius D_W/2 and length L_eff with the requested tilt.
  const rollerCount = computeRollerCount(D_pw, D_W);
  const masterRollerRight = buildRollerSolid(
    oc,
    /* axialCentre */ roller_cx,
    /* radialCentre */ roller_cy,
    L_eff,
    D_W,
    cos_a,
    sin_a,
    N_x,
    N_y,
  );
  // Left row: mirror axially. The roller's geometry mirrors across
  // axial=0, which means flipping the sign of the axial components of
  // both the axis direction and the normal. The radial components stay.
  const masterRollerLeft = buildRollerSolid(
    oc,
    /* axialCentre */ -roller_cx,
    /* radialCentre */ roller_cy,
    L_eff,
    D_W,
    cos_a, // radial axis component (unchanged under axial mirror)
    -sin_a, // axial axis component (flipped)
    -N_x, // axial normal component (flipped)
    N_y, // radial normal component (unchanged)
  );

  const rollers: unknown[] = [];
  for (let i = 0; i < rollerCount; i++) {
    const angle = (2 * Math.PI * i) / rollerCount;
    rollers.push(rotateShapeAroundZ(oc, masterRollerRight, angle, /* share */ false));
    rollers.push(rotateShapeAroundZ(oc, masterRollerLeft, angle, /* share */ false));
  }

  // ── 5. Merge into a single multi-body solid + STEP export ──
  const bearing = mergeShapesIntoMultibodySolid(oc, [innerRing, outerRing, ...rollers]);

  const rawStep = exportStepBytes(oc, bearing);
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
 * Build one tilted-cylinder roller solid centred at the given (radial,
 * axial) point with axis direction (cosA, sinA) in [radial, axial] and
 * outward normal (Nx_axial, Ny_radial). The profile is a closed
 * parallelogram p1-p2-p3-p4; revolving it around the (p1, p2) axis
 * produces a cylinder of radius D_W/2 and length L_eff.
 */
function buildRollerSolid(
  oc: unknown,
  axialCentre: number,
  radialCentre: number,
  L_eff: number,
  D_W: number,
  cosA: number,
  sinA: number,
  Nx_axial: number,
  Ny_radial: number,
): unknown {
  const halfL = L_eff / 2;
  const halfD = D_W / 2;

  // Axis-side endpoints (on the revolution axis itself). Note: in C++
  // sketch space (axial, radial) the formulas are
  //   p1 = (rx − halfL·cos_a, ry − halfL·sin_a)
  //   p2 = (rx + halfL·cos_a, ry + halfL·sin_a)
  // — and our [radial, axial] swap reverses argument order:
  //   p1 = [ry − halfL·sin_a, rx − halfL·cos_a]
  // (cos_a ↦ axial component, sin_a ↦ radial component in this swap).
  const p1Axial = axialCentre - halfL * cosA;
  const p1Radial = radialCentre - halfL * sinA;
  const p2Axial = axialCentre + halfL * cosA;
  const p2Radial = radialCentre + halfL * sinA;

  // Outer-side endpoints — offset by halfD in the outward-normal
  // direction (Nx_axial, Ny_radial).
  const p3Axial = p2Axial + halfD * Nx_axial;
  const p3Radial = p2Radial + halfD * Ny_radial;
  const p4Axial = p1Axial + halfD * Nx_axial;
  const p4Radial = p1Radial + halfD * Ny_radial;

  const profileWire = makeProfileWireXZ(
    oc as never,
    [p1Radial, p1Axial],
    [
      { kind: 'line', to: [p2Radial, p2Axial] },
      { kind: 'line', to: [p3Radial, p3Axial] },
      { kind: 'line', to: [p4Radial, p4Axial] },
      { kind: 'line', to: [p1Radial, p1Axial] },
    ] satisfies ProfileSegment[],
  );

  // Revolution axis: line through (p1Radial, 0, p1Axial) in world XYZ
  // (Y=0 since profile lies in XZ plane), direction (p2-p1) normalised.
  const axisDirRadial = p2Radial - p1Radial;
  const axisDirAxial = p2Axial - p1Axial;
  const axisLen = Math.hypot(axisDirRadial, axisDirAxial);
  return makeRevolAroundAxis(
    oc as never,
    profileWire,
    [p1Radial, 0, p1Axial],
    [axisDirRadial / axisLen, 0, axisDirAxial / axisLen],
  );
}

/**
 * Per-row roller count (line 2249). C++ uses gap factor 1.4 (slightly
 * tighter than the cylindrical-roller default of 1.45, since spherical
 * rollers are fatter and need closer packing on the curved raceway).
 * Catalog Z is intentionally ignored for SRB — same reasoning as SABB:
 * catalogs vary between per-row and total Z, and the C++ formula is
 * what produces the visible roller density designers expect.
 */
function computeRollerCount(D_pw: number, D_W: number): number {
  return Math.max(6, Math.floor((Math.PI * D_pw) / (D_W * ROLLER_GAP_FACTOR)));
}
