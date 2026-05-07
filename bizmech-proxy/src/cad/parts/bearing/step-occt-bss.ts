/**
 * OCCT-backed STEP generator for ball-screw support bearings (DRBB —
 * double-row 60° angular contact). Faithful port of
 * `BearingCreator::CreateBallScrewSupportBearing` (`C++Source/NewCreate
 * BearingClass.cpp` line 2702-2902).
 *
 * Why this bearing is unusual
 * ───────────────────────────
 * Ball screws drive linear-axis machinery — the bearing has to absorb
 * both axial and minor radial loads at high RPM, so the 60° contact
 * angle is "asymmetric": each row's outer-ring shoulder is DEEP
 * (load-supporting side) and the opposite face is SHALLOW (assembly
 * relief). The two rows mirror each other so the combined assembly
 * carries axial loads in BOTH directions.
 *
 * Each ring's profile encodes this with four asymmetric raceway points
 * per row (A, B, C, D for outer; E, F, G, H for inner) — see C++
 * lines 2783-2793. The shoulder and relief sides are linked via a
 * pythagorean-on-groove-circle calculation that keeps each raceway-arc
 * endpoint strictly on a circle of radius `grooveR` centred at the
 * row's pitch point.
 *
 * Geometry overview
 * ─────────────────
 *   pitchR     = (d1 + D2) / 4
 *   ballR      = min((D-d)/2 × 0.45, B/4 × 0.8)
 *   grooveR    = ballR × 1.04
 *   rowDist    = B × 0.25
 *   cX_L = -rowDist;  cX_R = +rowDist           // axial centres of each row
 *   dx_shoulder_ideal = grooveR × 0.95          // load-supporting side
 *   dx_relief_ideal   = grooveR × 0.50          // assembly side
 *   ballCount/row     = ⌊π · pcd / (BD × 1.15)⌋
 *
 * Coordinate convention — same as the rest of the bearing family.
 *
 * Cage NOT modeled (cosmetic — would need a thin-walled shell with
 * 2N pocket cuts for the two rows of balls).
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

const BALL_RADIAL_RATIO = 0.45;
const BALL_WIDTH_RATIO = 0.8; // applied to (B/4)
const GROOVE_RATIO = 1.04;
const ROW_DIST_RATIO = 0.25;
const SHOULDER_IDEAL_RATIO = 0.95;
const RELIEF_IDEAL_RATIO = 0.50;
const BALL_GAP_FACTOR = 1.15;
const RELIEF_LIMIT_RATIO = 0.8;

export async function buildDrbbStepViaOcct(
  req: CadGenerateRequest,
  dims: BearingDims,
): Promise<CadGenerateResult> {
  const started = Date.now();
  const oc = await getOcct();

  // ── 1. Geometry constants (line 2718-2793) ──
  const innerR = dims.d1 / 2;
  const outerR = dims.D2 / 2;
  const halfB = dims.B / 2;
  const r = dims.r;
  const pitchR = (dims.d1 + dims.D2) / 4;

  const max_ballR_radial = ((dims.D2 - dims.d1) / 2) * BALL_RADIAL_RATIO;
  const max_ballR_width = (dims.B / 4) * BALL_WIDTH_RATIO;
  const ballR =
    readPositiveNumber(req, 'Dw') != null
      ? (readPositiveNumber(req, 'Dw') as number) / 2
      : Math.min(max_ballR_radial, max_ballR_width);
  const grooveR = ballR * GROOVE_RATIO;
  const rowDist = dims.B * ROW_DIST_RATIO;
  const cX_L = -rowDist;
  const cX_R = +rowDist;

  // Asymmetric shoulder / relief offsets — each row's outer-ring deep
  // shoulder sits AWAY from the row's centre, the relief sits TOWARD
  // the row's centre. Inner ring mirrors the topology.
  const max_dx_relief = rowDist * RELIEF_LIMIT_RATIO;
  const max_dx_shoulder = halfB * RELIEF_LIMIT_RATIO - rowDist;
  const dx_shoulder_ideal = grooveR * SHOULDER_IDEAL_RATIO;
  const dx_relief_ideal = grooveR * RELIEF_IDEAL_RATIO;

  let dx_shoulder_O = Math.min(dx_shoulder_ideal, max_dx_shoulder);
  let dx_relief_O = Math.min(dx_relief_ideal, max_dx_relief);
  let dx_shoulder_I = Math.min(dx_shoulder_ideal, max_dx_relief);
  let dx_relief_I = Math.min(dx_relief_ideal, max_dx_shoulder);

  if (dx_shoulder_O <= 0 || dx_relief_O <= 0 || dx_shoulder_I <= 0 || dx_relief_I <= 0) {
    throw new Error(
      `DRBB ${req.partCode}: degenerate raceway offsets — dx_shoulder_O=${dx_shoulder_O.toFixed(3)} ` +
        `dx_relief_O=${dx_relief_O.toFixed(3)} dx_shoulder_I=${dx_shoulder_I.toFixed(3)} ` +
        `dx_relief_I=${dx_relief_I.toFixed(3)}. B is too narrow for the standard 0.25/0.8 ratios.`,
    );
  }

  // Outer-ring raceway radial heights (line 2752-2765).
  let max_HO = outerR - r - 0.2;
  if (max_HO < pitchR + grooveR * 0.99) max_HO = pitchR + grooveR * 0.99;

  let H_shoulder_O = pitchR + Math.sqrt(grooveR * grooveR - dx_shoulder_O * dx_shoulder_O);
  if (H_shoulder_O > max_HO) {
    H_shoulder_O = max_HO;
    dx_shoulder_O = Math.sqrt(grooveR * grooveR - (H_shoulder_O - pitchR) ** 2);
  }
  let H_relief_O = pitchR + Math.sqrt(grooveR * grooveR - dx_relief_O * dx_relief_O);
  if (H_relief_O > max_HO) {
    H_relief_O = max_HO;
    dx_relief_O = Math.sqrt(grooveR * grooveR - (H_relief_O - pitchR) ** 2);
  }

  // Inner-ring raceway radial heights (line 2767-2781).
  let min_HI = innerR + r + 0.2;
  if (min_HI > pitchR - grooveR * 0.99) min_HI = pitchR - grooveR * 0.99;

  let H_shoulder_I = pitchR - Math.sqrt(grooveR * grooveR - dx_shoulder_I * dx_shoulder_I);
  if (H_shoulder_I < min_HI) {
    H_shoulder_I = min_HI;
    dx_shoulder_I = Math.sqrt(grooveR * grooveR - (pitchR - H_shoulder_I) ** 2);
  }
  let H_relief_I = pitchR - Math.sqrt(grooveR * grooveR - dx_relief_I * dx_relief_I);
  if (H_relief_I < min_HI) {
    H_relief_I = min_HI;
    dx_relief_I = Math.sqrt(grooveR * grooveR - (pitchR - H_relief_I) ** 2);
  }

  // Outer-ring raceway points (A B C D, line 2783-2787).
  // A=left-shoulder, B=left-relief, C=right-relief, D=right-shoulder.
  const Ax = cX_L - dx_shoulder_O;
  const Bx = cX_L + dx_relief_O;
  const Cx = cX_R - dx_relief_O;
  const Dx = cX_R + dx_shoulder_O;

  // Inner-ring raceway points (E F G H, line 2789-2793).
  // E=left-relief, F=left-shoulder, G=right-shoulder, H=right-relief.
  const Ex = cX_L - dx_relief_I;
  const Fx = cX_L + dx_shoulder_I;
  const Gx = cX_R - dx_shoulder_I;
  const Hx = cX_R + dx_relief_I;

  // ── 2. Outer ring profile (10 edges) ──
  // CCW in [radial, axial], starting at the right-side bottom corner
  // where the right wall meets H_shoulder_O.
  const outerRingFace = makeProfileWireXZ(
    oc,
    [H_shoulder_O, halfB], // pO_TR_bot
    [
      // 1. Right wall — radial increasing (H_shoulder_O → outerR-r).
      { kind: 'line', to: [outerR - r, halfB] },
      // 2. Right top fillet (90° arc).
      {
        kind: 'arc',
        to: [outerR, halfB - r],
        center: [outerR - r, halfB - r],
        ccw: true,
      },
      // 3. Top OD face — axial decreasing.
      { kind: 'line', to: [outerR, -halfB + r] },
      // 4. Left top fillet.
      {
        kind: 'arc',
        to: [outerR - r, -halfB],
        center: [outerR - r, -halfB + r],
        ccw: true,
      },
      // 5. Left wall — radial decreasing back to H_shoulder_O.
      { kind: 'line', to: [H_shoulder_O, -halfB] },
      // 6. Left shoulder — axial+ from -halfB to A.
      { kind: 'line', to: [H_shoulder_O, Ax] },
      // 7. LEFT RACEWAY ARC — A → B (asymmetric: shoulder to relief).
      //    Centre at (cX_L, pitchR), short arc dipping outward.
      {
        kind: 'arc',
        to: [H_relief_O, Bx],
        center: [pitchR, cX_L],
        ccw: false,
      },
      // 8. Middle bridge between the two rows at relief level (B → C).
      { kind: 'line', to: [H_relief_O, Cx] },
      // 9. RIGHT RACEWAY ARC — C → D.
      {
        kind: 'arc',
        to: [H_shoulder_O, Dx],
        center: [pitchR, cX_R],
        ccw: false,
      },
      // 10. Right shoulder — axial+ from D back to halfB (closes loop).
      { kind: 'line', to: [H_shoulder_O, halfB] },
    ] satisfies ProfileSegment[],
  );
  const outerRing = makeRevolZ(oc, outerRingFace);

  // ── 3. Inner ring profile (10 edges) ──
  // The inner ring has a CENTRE RIDGE (peak between the two grooves at
  // the H_shoulder_I level), with relief level on each end. Profile
  // walks: bore → right side wall → right shoulder fillet → right relief
  // → right raceway arc (H to G) → centre peak (G to F) → left raceway
  // arc (F to E) → left relief → left shoulder fillet → left side wall →
  // bore (closing).
  const innerRingFace = makeProfileWireXZ(
    oc,
    [innerR, halfB], // pI_BR_bot (right end of bore)
    [
      // 1. Right wall — radial+ from bore (innerR) to (H_relief_I - r).
      { kind: 'line', to: [H_relief_I - r, halfB] },
      // 2. Right shoulder fillet (90° arc on the OUTER-corner of the ring).
      {
        kind: 'arc',
        to: [H_relief_I, halfB - r],
        center: [H_relief_I - r, halfB - r],
        ccw: true,
      },
      // 3. Right relief surface — axial- from halfB-r to Hx.
      { kind: 'line', to: [H_relief_I, Hx] },
      // 4. RIGHT RACEWAY ARC — H → G (relief to shoulder, inverted from outer).
      {
        kind: 'arc',
        to: [H_shoulder_I, Gx],
        center: [pitchR, cX_R],
        ccw: false,
      },
      // 5. Centre peak — radial=H_shoulder_I, axial Gx → Fx.
      { kind: 'line', to: [H_shoulder_I, Fx] },
      // 6. LEFT RACEWAY ARC — F → E.
      {
        kind: 'arc',
        to: [H_relief_I, Ex],
        center: [pitchR, cX_L],
        ccw: false,
      },
      // 7. Left relief surface — axial- from Ex to -halfB+r.
      { kind: 'line', to: [H_relief_I, -halfB + r] },
      // 8. Left shoulder fillet.
      {
        kind: 'arc',
        to: [H_relief_I - r, -halfB],
        center: [H_relief_I - r, -halfB + r],
        ccw: true,
      },
      // 9. Left wall — radial- back to bore (innerR).
      { kind: 'line', to: [innerR, -halfB] },
      // 10. Bore floor — axial+ at radial=innerR (closes loop).
      { kind: 'line', to: [innerR, halfB] },
    ] satisfies ProfileSegment[],
  );
  const innerRing = makeRevolZ(oc, innerRingFace);

  // ── 4. Balls — two rows, each at axial=±rowDist, radial=pitchR ──
  const ballsPerRow = computeBallsPerRow(pitchR, ballR);
  const masterBall_L = makeSphere(oc, [pitchR, 0, cX_L], ballR);
  const masterBall_R = makeSphere(oc, [pitchR, 0, cX_R], ballR);
  const balls: unknown[] = [];
  for (let i = 0; i < ballsPerRow; i++) {
    const angle = (2 * Math.PI * i) / ballsPerRow;
    balls.push(rotateShapeAroundZ(oc, masterBall_L, angle, /* share */ false));
    balls.push(rotateShapeAroundZ(oc, masterBall_R, angle, /* share */ false));
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

function computeBallsPerRow(pitchR: number, ballR: number): number {
  const pitchDia = pitchR * 2;
  const ballDia = ballR * 2;
  return Math.max(6, Math.floor((Math.PI * pitchDia) / (ballDia * BALL_GAP_FACTOR)));
}

function readPositiveNumber(req: CadGenerateRequest, key: string): number | undefined {
  const v = req.dimensions[key];
  if (v == null || v === '') return undefined;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}
