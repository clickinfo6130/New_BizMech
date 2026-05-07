/**
 * OCCT-backed STEP generator for angular-contact ball bearings (ACBB,
 * single row). Faithful port of the SingleRow branch of
 * `BearingCreator::CreateAngularContactBallBearing`
 * (`C++Source/NewCreateBearingClass.cpp` line 1530–1763).
 *
 * What makes ACBB distinct from DGBB
 * ──────────────────────────────────
 * The ball-raceway contact line passes through the ball centre at a
 * non-zero angle from the radial direction (the "contact angle" α,
 * typically 15° / 25° / 30° / 40°). To produce that contact geometry
 * the OUTER ring's raceway has an asymmetric profile: the groove arc's
 * RIGHT endpoint is offset by `(BD/2) × (sinα, cosα)` from the pitch
 * point, so the right shoulder sits axially-outward AND radially-higher
 * than the left shoulder. The inner ring's profile is symmetric (its
 * groove is just a regular toroidal arc); the asymmetry only shows up
 * on the outer ring.
 *
 * Geometry
 * ────────
 *   pitchR        = (d1 + D2) / 4
 *   val_BD        = (D2 - d1) × 0.3                  // ball diameter, DGBB convention
 *   grooveR       = val_BD / 2                       // raceway groove radius
 *   shoulderY_In  = (d1 + (D2-d1)/3) / 2            // inner-ring shoulder
 *   shoulderY_Out = (D2 - (D2-d1)/3) / 2            // outer-ring shoulder (LEFT side)
 *   contactAngle  = catalog `a_2` (deg) if present, else 15°
 *   getPtIn.x     = √(grooveR² − (shoulderY_In − pitchR)²)
 *                                                    // chord-on-groove half-width
 *   oP4 (right groove end on outer ring):
 *     oP4x = (BD/2) × sin α
 *     oP4y = pitchR + (BD/2) × cos α
 *   ballCount     = ⌊π · pcd / (BD × gap)⌋ − 1       // C++ line 1722
 *                   gap = 1.15 (standard) or 1.35 (UltraHighSpeed)
 *
 * Coordinate convention — same as the rest of the bearing family.
 *
 * Variants NOT covered by this generator (Phase 3b):
 *   · DualRowType DB / DF / DT (paired/quadruplet bearings)
 *   · MatchedAngularContactBall (paired matched bearing)
 *   · FourPointContactBall (Gothic-arch raceway, 4-point contact)
 *   · UltraHighSpeed variant (UHSACBB) uses BD × 0.65 + gap = 1.35
 */
import type { CadGenerateRequest, CadGenerateResult } from '../../types.js';
import { FORMAT_EXT, FORMAT_MIME } from '../../types.js';
import {
  exportStepBytes,
  flattenBrepWithVoidsToManifolds,
  getOcct,
  makeProfileWireXZ,
  makeRevolZ,
  makeSphere,
  mergeShapesIntoMultibodySolid,
  rotateShapeAroundZ,
  type ProfileSegment,
} from '../../core/occt.js';
import { bomFileName } from '../../core/bom-meta.js';
import type { BearingDims } from './dimensions.js';

const C_PLUS_PLUS_BALL_DIA_RATIO = 0.3;
const DEFAULT_CONTACT_ANGLE_DEG = 15;
const STANDARD_GAP_FACTOR = 1.15;
const SHOULDER_INNER_RATIO = 1 / 3; // shoulderY_In = d1/2 + (D-d)/3 × 0.5

export async function buildAcbbStepViaOcct(
  req: CadGenerateRequest,
  dims: BearingDims,
): Promise<CadGenerateResult> {
  const started = Date.now();
  const oc = await getOcct();

  // ── 1. Geometry constants ──
  const innerR = dims.d1 / 2;
  const outerR = dims.D2 / 2;
  const halfB = dims.B / 2;
  const r = dims.r;
  const r1 = dims.r1;

  const ballDia =
    readPositiveNumber(req, 'Dw') ?? (dims.D2 - dims.d1) * C_PLUS_PLUS_BALL_DIA_RATIO;
  const grooveR = ballDia / 2;
  const pitchR =
    (readPositiveNumber(req, 'dm') ?? (dims.d1 + dims.D2) / 2) / 2;

  const contactAngleDeg = readPositiveNumber(req, 'a_2') ?? DEFAULT_CONTACT_ANGLE_DEG;
  const contactAngle = (contactAngleDeg * Math.PI) / 180;

  const shoulderY_In =
    (dims.d1 + (dims.D2 - dims.d1) * SHOULDER_INNER_RATIO) / 2;
  const shoulderY_Out =
    (dims.D2 - (dims.D2 - dims.d1) * SHOULDER_INNER_RATIO) / 2;

  // Symmetric raceway endpoint (used on inner ring + left side of outer
  // ring). Pythagorean half-width where the chord at radial=shoulderY
  // meets the groove circle.
  const dy_In = pitchR - shoulderY_In;
  const getPtInSq = grooveR * grooveR - dy_In * dy_In;
  if (getPtInSq <= 0) {
    throw new Error(
      `ACBB ${req.partCode}: degenerate inner raceway — shoulder line ` +
        `${shoulderY_In.toFixed(3)} can't reach groove of radius ${grooveR.toFixed(3)} ` +
        `(centre at radial=${pitchR.toFixed(3)}).`,
    );
  }
  const getPtInX = Math.sqrt(getPtInSq);

  // Asymmetric right-side endpoint on the outer-ring groove. C++ line
  // 1676-1677: oP4 = (BD/2 × sinα, pitchR + BD/2 × cosα). The left
  // endpoint stays at the symmetric (-getPtInX, shoulderY_Out) — that's
  // what makes the outer-ring profile asymmetric.
  const oP4x = (ballDia / 2) * Math.sin(contactAngle);
  const oP4y = pitchR + (ballDia / 2) * Math.cos(contactAngle);

  // Right wall transition point on outer ring (C++ line 1687):
  // ptOut5 = (halfB, (D/2 - shoulderY_Out - r) × 0.5 + shoulderY_Out)
  // — midpoint between (shoulderY_Out) and (D/2 - r) at axial = halfB.
  const ptOut5_radial = (outerR - shoulderY_Out - r) * 0.5 + shoulderY_Out;

  // ── 2. Inner ring profile (symmetric, 8 edges) ──
  const innerRingFace = makeProfileWireXZ(
    oc,
    [innerR + r, halfB], // ptIn0: bore-fillet end on right axial face
    [
      // 1. ptIn0 → ptIn1: right wall going UP (radial+) to shoulder.
      { kind: 'line', to: [shoulderY_In, halfB] },
      // 2. ptIn1 → ptIn2: right shoulder going axial-leftward.
      { kind: 'line', to: [shoulderY_In, getPtInX] },
      // 3. Raceway groove arc (concave, dipping inward toward bore).
      {
        kind: 'arc',
        to: [shoulderY_In, -getPtInX],
        center: [pitchR, 0],
        ccw: false,
      },
      // 4. ptIn3 → ptIn4: left shoulder going axial-leftward.
      { kind: 'line', to: [shoulderY_In, -halfB] },
      // 5. ptIn4 → ptIn5: left wall going DOWN (radial-) to bore-fillet.
      { kind: 'line', to: [innerR + r1, -halfB] },
      // 6. Left bore-bottom fillet (90° arc).
      {
        kind: 'arc',
        to: [innerR, -halfB + r1],
        center: [innerR + r1, -halfB + r1],
        ccw: true,
      },
      // 7. Bore floor — axial increasing at radial=innerR.
      { kind: 'line', to: [innerR, halfB - r] },
      // 8. Right bore-bottom fillet (closes loop).
      {
        kind: 'arc',
        to: [innerR + r, halfB],
        center: [innerR + r, halfB - r],
        ccw: true,
      },
    ] satisfies ProfileSegment[],
  );
  const innerRing = makeRevolZ(oc, innerRingFace);

  // ── 3. Outer ring profile (asymmetric, 8 edges) ──
  // The asymmetric raceway: LEFT endpoint at standard shoulderY_Out,
  // RIGHT endpoint at oP4 (offset by contact angle). Then a transition
  // diagonal up to the right wall midpoint, then a second segment up
  // to the right top fillet — see C++ line 1690-1701 for the literal
  // sketch sequence.
  const outerRingFace = makeProfileWireXZ(
    oc,
    [outerR, halfB - r1], // ptOut0: top-right OD just before fillet
    [
      // 1. ptOut0 → ptOut1: top OD face axial-leftward.
      { kind: 'line', to: [outerR, -halfB + r] },
      // 2. Left top fillet (90° arc).
      {
        kind: 'arc',
        to: [outerR - r, -halfB],
        center: [outerR - r, -halfB + r],
        ccw: true,
      },
      // 3. ptOutL_T → ptOutL_B: left wall going down to shoulder level.
      { kind: 'line', to: [shoulderY_Out, -halfB] },
      // 4. ptOutL_B → ptOut3: left shoulder axial-rightward to groove
      //    LEFT endpoint (symmetric, at -getPtInX).
      { kind: 'line', to: [shoulderY_Out, -getPtInX] },
      // 5. Asymmetric raceway groove arc — short arc dipping outward
      //    (toward OD). LEFT endpoint at shoulderY_Out level, RIGHT
      //    endpoint at oP4 (higher radial + further axial). The contact
      //    angle direction is encoded in this asymmetry.
      {
        kind: 'arc',
        to: [oP4y, oP4x],
        center: [pitchR, 0],
        ccw: true,
      },
      // 6. ptOut4 → ptOut5: transition diagonal — from groove right
      //    endpoint UP to the right-wall midpoint at axial=halfB.
      { kind: 'line', to: [ptOut5_radial, halfB] },
      // 7. ptOut5 → ptOutR_T: right wall going UP to fillet start.
      { kind: 'line', to: [outerR - r1, halfB] },
      // 8. Right top fillet (closes loop).
      {
        kind: 'arc',
        to: [outerR, halfB - r1],
        center: [outerR - r1, halfB - r1],
        ccw: true,
      },
    ] satisfies ProfileSegment[],
  );
  const outerRing = makeRevolZ(oc, outerRingFace);

  // ── 4. Balls ──
  const ballR = ballDia / 2;
  const masterBall = makeSphere(oc, [pitchR, 0, 0], ballR);
  const ballCount = computeBallCount(req, pitchR, ballDia);
  const balls: unknown[] = [];
  for (let i = 0; i < ballCount; i++) {
    const angle = (2 * Math.PI * i) / ballCount;
    balls.push(rotateShapeAroundZ(oc, masterBall, angle, /* share */ false));
  }

  // ── 5. Merge into a single multi-body solid + STEP export ──
  const bearing = mergeShapesIntoMultibodySolid(oc, [innerRing, outerRing, ...balls]);

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
 * Ball count from C++ line 1722:
 *   ballCount = floor(π × pcd / (BD × gapFactor)) − 1
 * The "− 1" reflects the cage tolerance — one ball position is
 * occupied by the cage's filling slot. Catalog Z is honoured when
 * present and ≥ 6, since ACBB rows usually carry an authoritative Z.
 */
function computeBallCount(
  req: CadGenerateRequest,
  pitchR: number,
  ballDia: number,
): number {
  const dbZ = req.dimensions['Z'];
  if (dbZ != null && dbZ !== '') {
    const n = typeof dbZ === 'number' ? dbZ : parseFloat(String(dbZ));
    if (Number.isFinite(n) && n >= 6) return Math.floor(n);
  }
  const pitchDia = pitchR * 2;
  return Math.max(
    6,
    Math.floor((Math.PI * pitchDia) / (ballDia * STANDARD_GAP_FACTOR)) - 1,
  );
}

function readPositiveNumber(req: CadGenerateRequest, key: string): number | undefined {
  const v = req.dimensions[key];
  if (v == null || v === '') return undefined;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}
