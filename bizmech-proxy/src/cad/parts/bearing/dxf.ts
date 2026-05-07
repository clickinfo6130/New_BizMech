/**
 * DXF generators for the bearing family — kind-aware dispatch.
 *
 * Each bearing kind has a distinct 2D topology so a one-size-fits-all
 * DXF would mis-represent half the catalog. This module groups the
 * kinds by drawing topology and produces the matching cross-section +
 * front-view layout. Dimensions on every DXF stay in mm (the proxy
 * works in mm internally).
 *
 * Supported kinds (matches `bearing/index.ts:BearingKind`)
 * ────────────────────────────────────────────────────────
 *   Radial ball + roller — DGBB, ACBB, SABB, SARB, SCRB, DCRB, STRB,
 *     DTRB, SNRB, SHNRB, FLBB, DRBB
 *      → side view: two ring profiles (mirrored top/bottom) + raceway
 *        groove arcs; front view: inner / outer / pitch circles.
 *      → SABB has a SPHERICAL outer raceway (one big arc, no grooves
 *        on the outer ring).
 *      → FLBB adds an extra flange-disk rectangle.
 *
 *   Cage + rollers only (no rings) — CNRB
 *      → side view: many roller rectangles between bore + OD lines;
 *        front view: 2 circles (no inner ring).
 *
 *   UC insert bearing — UCB
 *      → side view: spherical OD (one big arc) + inner ring rectangles
 *        + balls; front view: same as DGBB.
 *
 *   UC flange variants — UCF / UKF / UCFC / UKFC / UCFL / UKFL / UCFS
 *     / UKFS
 *      → side view: housing outline + UC bearing seated inside;
 *        front view: housing footprint (square / round / rhombus) +
 *        bolt-hole pattern + bearing circles.
 *
 *   Thrust bearings — STBB, TCRB, DTBB, TSARB, TACBB, DTABB
 *      → side view: 2 (or 3) flat washers stacked AXIALLY with rolling
 *        elements between (NOT concentric like radial bearings);
 *        front view: 2 concentric circles + roller / ball pattern.
 *
 *   Oil seal — OSEAL
 *      → side view: seal cross-section (outer case shell + rubber lip
 *        + optional garter spring circle); front view: 2 circles.
 */
import type { CadGenerateRequest, CadGenerateResult } from '../../types.js';
import { assembleDxfFile } from '../../formats/dxf.js';
import {
  arc,
  circle,
  fmtLabel,
  horizontalDim,
  line,
  proportionalTextSize,
  text,
  verticalDim,
} from '../../core/dxf.js';
import type { BearingDims } from './dimensions.js';

/**
 * Bearing-DXF kind identifier — same string values as the runtime
 * `BearingKind` in `bearing/index.ts`. Kept as a wide string union
 * here to avoid an import cycle.
 */
export type DxfBearingKind =
  | 'DeepGrooveBall'
  | 'CylindricalRoller'
  | 'CylindricalRollerDouble'
  | 'TaperRoller'
  | 'TaperRollerDouble'
  | 'SelfAligningBall'
  | 'SphericalRoller'
  | 'NeedleRoller'
  | 'NeedleRollerGauge'
  | 'NeedleRollerDrawnCup'
  | 'ThrustBall'
  | 'ThrustBallDouble'
  | 'ThrustBallAngularContact'
  | 'ThrustBallDoubleAngularContact'
  | 'UCBearing'
  | 'UCBearingSquareFlange'
  | 'UCBearingSquareFlangeSocket'
  | 'UCBearingRoundFlangeSocket'
  | 'UCBearingRhombusFlange'
  | 'AngularContactBall'
  | 'ThrustRoller'
  | 'ThrustRollerSpherical'
  | 'BallScrewSupport'
  | 'Flanged'
  | 'OilSeal';

/**
 * Top-level dispatcher. The `kind` parameter is optional for backward
 * compatibility — callers that don't pass it get the radial-ball style
 * (fine for DGBB / SCRB / similar). Code in `bearing/index.ts` always
 * passes the kind.
 */
export function buildBearingDxf(
  req: CadGenerateRequest,
  dims: BearingDims,
  kind?: DxfBearingKind,
): CadGenerateResult {
  switch (kind) {
    case 'ThrustBall':
    case 'ThrustBallDouble':
    case 'ThrustBallAngularContact':
    case 'ThrustBallDoubleAngularContact':
    case 'ThrustRoller':
    case 'ThrustRollerSpherical':
      return buildThrustBearingDxf(req, dims, kind);
    case 'OilSeal':
      return buildOilSealDxf(req, dims);
    case 'UCBearing':
      return buildUcInsertDxf(req, dims);
    case 'UCBearingSquareFlange':
    case 'UCBearingSquareFlangeSocket':
    case 'UCBearingRoundFlangeSocket':
    case 'UCBearingRhombusFlange':
      return buildUcFlangeDxf(req, dims, kind);
    case 'NeedleRollerGauge':
      return buildCnrbDxf(req, dims);
    case 'Flanged':
      return buildRadialBearingDxf(req, dims, { hasFlangeDisk: true });
    case 'SelfAligningBall':
      return buildRadialBearingDxf(req, dims, { sphericalOuter: true });
    default:
      // DGBB / ACBB / SCRB / DCRB / STRB / DTRB / SARB / SNRB / SHNRB /
      // DRBB / NeedleRoller etc. all share the same radial-bearing 2D.
      return buildRadialBearingDxf(req, dims);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Radial bearing DXF (DGBB family + its variants)
// ─────────────────────────────────────────────────────────────────────

interface RadialDxfOpts {
  hasFlangeDisk?: boolean;
  sphericalOuter?: boolean;
}

function buildRadialBearingDxf(
  req: CadGenerateRequest,
  dims: BearingDims,
  opts: RadialDxfOpts = {},
): CadGenerateResult {
  const halfB = dims.B / 2;
  const innerR = dims.d1 / 2;
  const outerR = dims.D2 / 2;
  const pitchR = (dims.d1 + dims.D2) / 4;
  const grooveR = ((dims.D2 - dims.d1) * 0.3) / 2 * 1.02;
  const shoulderH_Inner = pitchR - grooveR * 0.8;
  const shoulderH_Outer = pitchR + grooveR * 0.8;
  const grooveHalfW = grooveR * 0.6;

  const scale = Math.max(dims.D2, dims.B * 5);
  const textSize = proportionalTextSize(scale);
  const off = Math.max(textSize * 2.5, 4);

  const sideGap = dims.D2 * 0.4;
  const frontCx = halfB + outerR + sideGap;
  const frontCy = 0;

  return assembleDxfFile(req, (b) => {
    for (const sgn of [1, -1] as const) {
      // Inner ring outline (with groove on the inside-of-ring face).
      line(b, -halfB, sgn * innerR, halfB, sgn * innerR);
      line(b, -halfB, sgn * innerR, -halfB, sgn * shoulderH_Inner);
      line(b, halfB, sgn * innerR, halfB, sgn * shoulderH_Inner);
      line(b, -halfB, sgn * shoulderH_Inner, -grooveHalfW, sgn * shoulderH_Inner);
      line(b, halfB, sgn * shoulderH_Inner, grooveHalfW, sgn * shoulderH_Inner);
      if (sgn === 1) arc(b, 0, sgn * pitchR, grooveR, 180, 360);
      else arc(b, 0, sgn * pitchR, grooveR, 0, 180);

      // Outer ring outline. SABB has a single SPHERICAL raceway on the
      // outer ring instead of a grooved one — draw a single big arc
      // spanning the full width of the inside face.
      line(b, -halfB, sgn * outerR, halfB, sgn * outerR);
      line(b, -halfB, sgn * outerR, -halfB, sgn * shoulderH_Outer);
      line(b, halfB, sgn * outerR, halfB, sgn * shoulderH_Outer);
      if (opts.sphericalOuter) {
        // A single raceway arc spanning the full B from shoulder-left
        // to shoulder-right, dipping outward toward the OD.
        // Sphere-equivalent in 2D = an arc with center near the bearing
        // axis at radius ≈ pitchR + grooveR.
        if (sgn === 1) arc(b, 0, sgn * (pitchR + grooveR * 1.3), grooveR * 1.3, 200, 340);
        else arc(b, 0, sgn * (pitchR + grooveR * 1.3), grooveR * 1.3, 20, 160);
      } else {
        line(b, -halfB, sgn * shoulderH_Outer, -grooveHalfW, sgn * shoulderH_Outer);
        line(b, halfB, sgn * shoulderH_Outer, grooveHalfW, sgn * shoulderH_Outer);
        if (sgn === 1) arc(b, 0, sgn * pitchR, grooveR, 0, 180);
        else arc(b, 0, sgn * pitchR, grooveR, 180, 360);
      }
    }

    // Centerline through the side view.
    line(b, -halfB - off, 0, halfB + off, 0, 'CENTER');

    // Optional flange disk on the −axial side (FLBB): rectangle from
    // axial = -halfB to axial = -halfB + flangeThk, radial = outerR to
    // flangeR.
    if (opts.hasFlangeDisk) {
      const flangeR = (dims.D2 * 1.3) / 2;
      const flangeThk = dims.B * 0.15;
      for (const sgn of [1, -1] as const) {
        line(b, -halfB, sgn * outerR, -halfB, sgn * flangeR);
        line(b, -halfB, sgn * flangeR, -halfB + flangeThk, sgn * flangeR);
        line(b, -halfB + flangeThk, sgn * flangeR, -halfB + flangeThk, sgn * outerR);
      }
    }

    // ── Front view ──
    circle(b, frontCx, frontCy, outerR);
    circle(b, frontCx, frontCy, innerR);
    circle(b, frontCx, frontCy, pitchR, 'DIM');
    if (opts.hasFlangeDisk) {
      const flangeR = (dims.D2 * 1.3) / 2;
      circle(b, frontCx, frontCy, flangeR);
    }
    line(b, frontCx - outerR - off, frontCy, frontCx + outerR + off, frontCy, 'CENTER');
    line(b, frontCx, frontCy - outerR - off, frontCx, frontCy + outerR + off, 'CENTER');

    // ── Dimensions ──
    horizontalDim(b, -halfB, halfB, -outerR - off, -outerR - off * 2,
      `B=${fmtLabel(dims.B)}`, textSize);
    verticalDim(b, frontCy - innerR, frontCy + innerR,
      frontCx + outerR + off, frontCx + outerR + off * 2,
      `Ø${fmtLabel(dims.d1)}`, textSize);
    verticalDim(b, frontCy - outerR, frontCy + outerR,
      frontCx + outerR + off * 4, frontCx + outerR + off * 5,
      `Ø${fmtLabel(dims.D2)}`, textSize);

    text(b, 0, -outerR - off * 4, textSize * 1.3,
      `${req.partCode}  ${dims.d1}×${dims.D2}×${dims.B}`);
  });
}

// ─────────────────────────────────────────────────────────────────────
// CNRB DXF — cage + rollers only, no rings
// ─────────────────────────────────────────────────────────────────────

function buildCnrbDxf(req: CadGenerateRequest, dims: BearingDims): CadGenerateResult {
  const halfB = dims.B / 2;
  const innerR = dims.d1 / 2;
  const outerR = dims.D2 / 2;
  const RD = (dims.D2 - dims.d1) * 0.4; // needle "diameter" as a fraction
  const pitchR = (dims.d1 + dims.D2) / 4;

  const scale = Math.max(dims.D2, dims.B * 5);
  const textSize = proportionalTextSize(scale);
  const off = Math.max(textSize * 2.5, 4);
  const frontCx = halfB + outerR + dims.D2 * 0.4;

  return assembleDxfFile(req, (b) => {
    // Side view: bore + OD reference lines, plus needle rectangles.
    for (const sgn of [1, -1] as const) {
      line(b, -halfB, sgn * innerR, halfB, sgn * innerR, 'HIDDEN');
      line(b, -halfB, sgn * outerR, halfB, sgn * outerR, 'HIDDEN');
      // Needle (one per half) — rectangle at pitchR ± RD/2.
      const needleHalfL = halfB - 1;
      const needleHalfW = RD / 2;
      line(b, -needleHalfL, sgn * (pitchR - needleHalfW), needleHalfL, sgn * (pitchR - needleHalfW));
      line(b, -needleHalfL, sgn * (pitchR + needleHalfW), needleHalfL, sgn * (pitchR + needleHalfW));
      line(b, -needleHalfL, sgn * (pitchR - needleHalfW), -needleHalfL, sgn * (pitchR + needleHalfW));
      line(b, needleHalfL, sgn * (pitchR - needleHalfW), needleHalfL, sgn * (pitchR + needleHalfW));
    }
    line(b, -halfB - off, 0, halfB + off, 0, 'CENTER');

    // Front view: 2 dashed reference circles + pitch circle.
    circle(b, frontCx, 0, outerR, 'HIDDEN');
    circle(b, frontCx, 0, innerR, 'HIDDEN');
    circle(b, frontCx, 0, pitchR, 'DIM');
    line(b, frontCx - outerR - off, 0, frontCx + outerR + off, 0, 'CENTER');
    line(b, frontCx, -outerR - off, frontCx, outerR + off, 'CENTER');

    horizontalDim(b, -halfB, halfB, -outerR - off, -outerR - off * 2,
      `B=${fmtLabel(dims.B)}`, textSize);
    verticalDim(b, -outerR, outerR,
      frontCx + outerR + off, frontCx + outerR + off * 2,
      `Ø${fmtLabel(dims.D2)}`, textSize);
    text(b, 0, -outerR - off * 4, textSize * 1.3,
      `${req.partCode}  ${dims.d1}×${dims.D2}×${dims.B}  (cage+roller, no rings)`);
  });
}

// ─────────────────────────────────────────────────────────────────────
// UC insert bearing — spherical OD outer ring
// ─────────────────────────────────────────────────────────────────────

function buildUcInsertDxf(req: CadGenerateRequest, dims: BearingDims): CadGenerateResult {
  const halfB = dims.B / 2;
  const innerR = dims.d1 / 2;
  const outerR = dims.D2 / 2;
  const pitchR = (dims.d1 + dims.D2) / 4;
  const cWidth = dims.D2 * 0.35; // C++ default
  const halfC = cWidth / 2;
  const intersect_R = Math.sqrt(outerR * outerR - halfC * halfC);

  const scale = Math.max(dims.D2, dims.B * 5);
  const textSize = proportionalTextSize(scale);
  const off = Math.max(textSize * 2.5, 4);
  const frontCx = halfB + outerR + dims.D2 * 0.4;

  return assembleDxfFile(req, (b) => {
    for (const sgn of [1, -1] as const) {
      // Inner ring outline (extra-wide for set-screw mounting).
      line(b, -halfB, sgn * innerR, halfB, sgn * innerR);
      line(b, -halfB, sgn * innerR, -halfB, sgn * pitchR);
      line(b, halfB, sgn * innerR, halfB, sgn * pitchR);

      // Outer ring with SPHERICAL OD — single big arc spanning ±halfC.
      line(b, -halfC, sgn * intersect_R, halfC, sgn * intersect_R, 'HIDDEN');
      // Spherical arc — center at origin, radius outerR, spanning the
      // axial range ±halfC.
      const halfArcAngle = Math.atan2(halfC, intersect_R) * 180 / Math.PI;
      if (sgn === 1) arc(b, 0, 0, outerR, 90 - halfArcAngle, 90 + halfArcAngle);
      else arc(b, 0, 0, outerR, 270 - halfArcAngle, 270 + halfArcAngle);
      // Inner shoulder of outer ring.
      line(b, -halfC, sgn * intersect_R, -halfC, sgn * pitchR);
      line(b, halfC, sgn * intersect_R, halfC, sgn * pitchR);
    }
    line(b, -halfB - off, 0, halfB + off, 0, 'CENTER');

    // Front view — same as DGBB but with extra circle for OD sphere.
    circle(b, frontCx, 0, outerR);
    circle(b, frontCx, 0, innerR);
    circle(b, frontCx, 0, pitchR, 'DIM');
    line(b, frontCx - outerR - off, 0, frontCx + outerR + off, 0, 'CENTER');
    line(b, frontCx, -outerR - off, frontCx, outerR + off, 'CENTER');

    horizontalDim(b, -halfB, halfB, -outerR - off, -outerR - off * 2,
      `B=${fmtLabel(dims.B)}`, textSize);
    verticalDim(b, -innerR, innerR,
      frontCx + outerR + off, frontCx + outerR + off * 2,
      `Ø${fmtLabel(dims.d1)}`, textSize);
    verticalDim(b, -outerR, outerR,
      frontCx + outerR + off * 4, frontCx + outerR + off * 5,
      `Ø${fmtLabel(dims.D2)}`, textSize);
    text(b, 0, -outerR - off * 4, textSize * 1.3,
      `${req.partCode}  Ø${dims.d1}×Ø${dims.D2}×${dims.B}`);
  });
}

// ─────────────────────────────────────────────────────────────────────
// UC flange housings
// ─────────────────────────────────────────────────────────────────────

function buildUcFlangeDxf(
  req: CadGenerateRequest,
  dims: BearingDims,
  kind:
    | 'UCBearingSquareFlange'
    | 'UCBearingSquareFlangeSocket'
    | 'UCBearingRoundFlangeSocket'
    | 'UCBearingRhombusFlange',
): CadGenerateResult {
  const outerR = dims.D2 / 2;
  const innerR = dims.d1 / 2;
  // Catalog fallbacks — match step-occt-uc-flange.ts's defaults.
  const val_L = readPositive(req, 'L', 'flangeOD') ?? dims.D2 * 1.8;
  const val_J = readPositive(req, 'J') ?? val_L * 0.7;
  const val_A = readPositive(req, 'A') ?? dims.D2 * 1.1;
  const val_FB = readPositive(req, 'FB', 'A1') ?? dims.D2 * 0.25;
  const val_HW = readPositive(req, 'HW') ?? dims.D2 * 0.7;
  const val_H3 = readPositive(req, 'H3') ?? dims.D2 * 1.3;
  const val_f = readPositive(req, 'f') ?? val_FB * 0.2;
  const val_N = readPositive(req, 'N') ?? val_L * 0.1;
  const hasSpigot =
    kind === 'UCBearingSquareFlangeSocket' ||
    kind === 'UCBearingRoundFlangeSocket';
  const isRound = kind === 'UCBearingRoundFlangeSocket';
  const is2Hole = kind === 'UCBearingRhombusFlange';

  const bossHeight = Math.max(val_HW - val_FB, val_FB * 0.5);
  const bossR = (val_H3 > 0 ? val_H3 * 0.9 : dims.D2 * 1.15) / 2;
  const halfL = val_L / 2;

  const scale = Math.max(val_L, dims.D2);
  const textSize = proportionalTextSize(scale);
  const off = Math.max(textSize * 2.5, 4);

  // Side view occupies axial range [-(FB+f), bossHeight].
  const sideXmin = -val_FB - (hasSpigot ? val_f : 0);
  const sideXmax = bossHeight;
  const frontCx = sideXmax + halfL + dims.D2 * 0.6;

  return assembleDxfFile(req, (b) => {
    // ── Side view (axial cross-section) ──
    // Housing outline: flange base + boss + optional spigot, mirrored.
    for (const sgn of [1, -1] as const) {
      // Flange base — rectangle from sideXmin (or -val_FB) to 0, radial 0 to halfL.
      line(b, -val_FB, sgn * halfL, 0, sgn * halfL);                    // outer edge
      line(b, -val_FB, sgn * halfL, -val_FB, sgn * (isRound ? halfL : halfL)); // back face
      // Boss — radial bossR, axial 0 to bossHeight.
      line(b, 0, sgn * bossR, bossHeight, sgn * bossR);
      line(b, bossHeight, sgn * bossR, bossHeight, sgn * outerR, 'HIDDEN'); // boss face
      // Step from base outer edge down to boss radius.
      line(b, 0, sgn * halfL, 0, sgn * bossR);
      // Bearing seat shown as dashed reference.
      line(b, -outerR * 0.5, sgn * outerR, outerR * 0.5, sgn * outerR, 'HIDDEN');
      // Spigot if any.
      if (hasSpigot) {
        const spigotR = val_H3 / 2;
        line(b, -val_FB, sgn * spigotR, -val_FB - val_f, sgn * spigotR);
        line(b, -val_FB - val_f, sgn * spigotR, -val_FB - val_f, sgn * (spigotR > halfL ? halfL : 0));
        line(b, -val_FB, sgn * halfL, -val_FB, sgn * spigotR);
      }
    }
    // Centerline.
    line(b, sideXmin - off, 0, sideXmax + off, 0, 'CENTER');

    // ── Front view (looking down the bearing axis) ──
    if (isRound) {
      circle(b, frontCx, 0, halfL); // round flange OD
    } else if (is2Hole) {
      // Rhombus simplified to L × A rectangle.
      const halfA = val_A / 2;
      line(b, frontCx - halfA, halfL, frontCx + halfA, halfL);
      line(b, frontCx + halfA, halfL, frontCx + halfA, -halfL);
      line(b, frontCx + halfA, -halfL, frontCx - halfA, -halfL);
      line(b, frontCx - halfA, -halfL, frontCx - halfA, halfL);
    } else {
      // Square L × L.
      line(b, frontCx - halfL, halfL, frontCx + halfL, halfL);
      line(b, frontCx + halfL, halfL, frontCx + halfL, -halfL);
      line(b, frontCx + halfL, -halfL, frontCx - halfL, -halfL);
      line(b, frontCx - halfL, -halfL, frontCx - halfL, halfL);
    }
    // Bearing circles in the centre of the front view.
    circle(b, frontCx, 0, outerR, 'HIDDEN');
    circle(b, frontCx, 0, innerR);
    circle(b, frontCx, 0, bossR, 'HIDDEN');

    // Bolt holes.
    const boltR = val_N / 2;
    const j2 = val_J / 2;
    if (is2Hole) {
      circle(b, frontCx, j2, boltR);
      circle(b, frontCx, -j2, boltR);
    } else if (isRound) {
      const c45 = Math.SQRT1_2;
      circle(b, frontCx + j2 * c45, j2 * c45, boltR);
      circle(b, frontCx - j2 * c45, j2 * c45, boltR);
      circle(b, frontCx - j2 * c45, -j2 * c45, boltR);
      circle(b, frontCx + j2 * c45, -j2 * c45, boltR);
    } else {
      // Square: 4 corners at ±J/2.
      circle(b, frontCx + j2, j2, boltR);
      circle(b, frontCx - j2, j2, boltR);
      circle(b, frontCx - j2, -j2, boltR);
      circle(b, frontCx + j2, -j2, boltR);
    }
    line(b, frontCx - halfL - off, 0, frontCx + halfL + off, 0, 'CENTER');
    line(b, frontCx, -halfL - off, frontCx, halfL + off, 'CENTER');

    // Dimensions.
    horizontalDim(b, sideXmin, sideXmax, -halfL - off * 1.5, -halfL - off * 2.5,
      `${fmtLabel(sideXmax - sideXmin)}`, textSize);
    verticalDim(b, -halfL, halfL,
      frontCx + halfL + off, frontCx + halfL + off * 2,
      `${fmtLabel(val_L)}`, textSize);
    verticalDim(b, -j2, j2,
      frontCx + halfL + off * 4, frontCx + halfL + off * 5,
      `J=${fmtLabel(val_J)}`, textSize);

    text(b, 0, -halfL - off * 4, textSize * 1.3,
      `${req.partCode}  Ø${dims.d1}×L=${val_L}`);
  });
}

// ─────────────────────────────────────────────────────────────────────
// Thrust bearings — flat washers stacked axially
// ─────────────────────────────────────────────────────────────────────

function buildThrustBearingDxf(
  req: CadGenerateRequest,
  dims: BearingDims,
  kind:
    | 'ThrustBall'
    | 'ThrustBallDouble'
    | 'ThrustBallAngularContact'
    | 'ThrustBallDoubleAngularContact'
    | 'ThrustRoller'
    | 'ThrustRollerSpherical',
): CadGenerateResult {
  const halfT = dims.B / 2;
  const innerR = dims.d1 / 2;
  const outerR = dims.D2 / 2;
  const pitchR = (dims.d1 + dims.D2) / 4;
  const RD = Math.min(dims.B * 0.35, (dims.D2 - dims.d1) * 0.15);
  const isDouble =
    kind === 'ThrustBallDouble' ||
    kind === 'ThrustBallDoubleAngularContact';
  const isRoller =
    kind === 'ThrustRoller' || kind === 'ThrustRollerSpherical';

  const scale = Math.max(dims.D2, dims.B * 5);
  const textSize = proportionalTextSize(scale);
  const off = Math.max(textSize * 2.5, 4);
  const frontCx = halfT + outerR + dims.D2 * 0.4;

  return assembleDxfFile(req, (b) => {
    // Side view: shaft washer on −axial side, housing washer on +axial.
    // Each washer occupies a small axial extent and the full radial
    // range from d/2 to D/2.
    for (const sgn of [1, -1] as const) {
      const washerThk = isDouble ? halfT * 0.4 : halfT * 0.85;
      // Shaft washer.
      line(b, -halfT, sgn * innerR, -halfT, sgn * outerR);
      line(b, -halfT, sgn * outerR, -halfT + washerThk, sgn * outerR);
      line(b, -halfT + washerThk, sgn * outerR, -halfT + washerThk, sgn * innerR);
      line(b, -halfT + washerThk, sgn * innerR, -halfT, sgn * innerR);
      // Housing washer.
      line(b, halfT - washerThk, sgn * innerR, halfT - washerThk, sgn * outerR);
      line(b, halfT - washerThk, sgn * outerR, halfT, sgn * outerR);
      line(b, halfT, sgn * outerR, halfT, sgn * innerR);
      line(b, halfT, sgn * innerR, halfT - washerThk, sgn * innerR);
      // Optional central washer for double-direction (DTBB / DTABB).
      if (isDouble) {
        const cThk = halfT * 0.4;
        line(b, -cThk, sgn * innerR, -cThk, sgn * outerR);
        line(b, -cThk, sgn * outerR, cThk, sgn * outerR);
        line(b, cThk, sgn * outerR, cThk, sgn * innerR);
        line(b, cThk, sgn * innerR, -cThk, sgn * innerR);
      }
      // Rolling element (one drawn per half). Ball = circle, roller = rect.
      const elemX = isDouble ? -halfT * 0.35 : 0;
      if (isRoller) {
        line(b, elemX - RD / 2, sgn * (pitchR - RD * 0.4), elemX + RD / 2, sgn * (pitchR - RD * 0.4));
        line(b, elemX + RD / 2, sgn * (pitchR - RD * 0.4), elemX + RD / 2, sgn * (pitchR + RD * 0.4));
        line(b, elemX + RD / 2, sgn * (pitchR + RD * 0.4), elemX - RD / 2, sgn * (pitchR + RD * 0.4));
        line(b, elemX - RD / 2, sgn * (pitchR + RD * 0.4), elemX - RD / 2, sgn * (pitchR - RD * 0.4));
      } else {
        circle(b, elemX, sgn * pitchR, RD / 2);
        if (isDouble) circle(b, -elemX, sgn * pitchR, RD / 2);
      }
    }
    line(b, -halfT - off, 0, halfT + off, 0, 'CENTER');

    // Front view — concentric circles + a pitch-circle reference.
    circle(b, frontCx, 0, outerR);
    circle(b, frontCx, 0, innerR);
    circle(b, frontCx, 0, pitchR, 'DIM');
    line(b, frontCx - outerR - off, 0, frontCx + outerR + off, 0, 'CENTER');
    line(b, frontCx, -outerR - off, frontCx, outerR + off, 'CENTER');

    horizontalDim(b, -halfT, halfT, -outerR - off, -outerR - off * 2,
      `T=${fmtLabel(dims.B)}`, textSize);
    verticalDim(b, -innerR, innerR,
      frontCx + outerR + off, frontCx + outerR + off * 2,
      `Ø${fmtLabel(dims.d1)}`, textSize);
    verticalDim(b, -outerR, outerR,
      frontCx + outerR + off * 4, frontCx + outerR + off * 5,
      `Ø${fmtLabel(dims.D2)}`, textSize);
    text(b, 0, -outerR - off * 4, textSize * 1.3,
      `${req.partCode}  Ø${dims.d1}×Ø${dims.D2}×T${dims.B}`);
  });
}

// ─────────────────────────────────────────────────────────────────────
// Oil seal — radial cross-section profile
// ─────────────────────────────────────────────────────────────────────

function buildOilSealDxf(req: CadGenerateRequest, dims: BearingDims): CadGenerateResult {
  const W = dims.B;
  const halfW = W / 2;
  const innerR = dims.d1 / 2;
  const outerR = dims.D2 / 2;
  const H = outerR - innerR;

  const scale = Math.max(dims.D2, W * 5);
  const textSize = proportionalTextSize(scale);
  const off = Math.max(textSize * 2.5, 4);
  const frontCx = halfW + outerR + dims.D2 * 0.4;

  return assembleDxfFile(req, (b) => {
    // Side view: simplified seal cross-section (rectangle + lip indication).
    for (const sgn of [1, -1] as const) {
      // Outer envelope (case + rubber back).
      line(b, -halfW, sgn * innerR, halfW, sgn * innerR);                 // bore line
      line(b, -halfW, sgn * outerR, halfW, sgn * outerR);                 // OD line
      line(b, -halfW, sgn * innerR, -halfW, sgn * outerR);                // left face
      line(b, halfW, sgn * innerR, halfW, sgn * outerR);                  // right face
      // Lip — radial dip below innerR on the inner-axial side.
      const lipApexR = innerR - 0.2;
      const lipL = -halfW + W * 0.35;
      const lipMid = -halfW + W * 0.45;
      const lipR = -halfW + W * 0.6;
      line(b, lipL, sgn * (innerR + H * 0.15), lipMid, sgn * lipApexR, 'HIDDEN');
      line(b, lipMid, sgn * lipApexR, lipR, sgn * (innerR + H * 0.15), 'HIDDEN');
      // Garter spring indication — small circle near the lip.
      circle(b, lipMid + W * 0.05, sgn * (innerR + H * 0.3), W * 0.07, 'HIDDEN');
    }
    line(b, -halfW - off, 0, halfW + off, 0, 'CENTER');

    // Front view — bore + OD circles.
    circle(b, frontCx, 0, outerR);
    circle(b, frontCx, 0, innerR);
    line(b, frontCx - outerR - off, 0, frontCx + outerR + off, 0, 'CENTER');
    line(b, frontCx, -outerR - off, frontCx, outerR + off, 'CENTER');

    horizontalDim(b, -halfW, halfW, -outerR - off, -outerR - off * 2,
      `B=${fmtLabel(W)}`, textSize);
    verticalDim(b, -innerR, innerR,
      frontCx + outerR + off, frontCx + outerR + off * 2,
      `Ø${fmtLabel(dims.d1)}`, textSize);
    verticalDim(b, -outerR, outerR,
      frontCx + outerR + off * 4, frontCx + outerR + off * 5,
      `Ø${fmtLabel(dims.D2)}`, textSize);
    text(b, 0, -outerR - off * 4, textSize * 1.3,
      `${req.partCode}  Ø${dims.d1}×Ø${dims.D2}×${dims.B}`);
  });
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
