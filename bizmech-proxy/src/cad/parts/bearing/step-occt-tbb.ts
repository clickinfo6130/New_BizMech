/**
 * OCCT-backed STEP generator for thrust ball bearings (STBB — single
 * direction). Faithful port of the SingleDirection branch of
 * `BearingCreator::CreateThrustBallBearing` (`C++Source/NewCreate
 * BearingClass.cpp` line 2906–3026 + the shared ball/cage block at
 * 3283-3375). Cage geometry is intentionally skipped — it's a
 * cosmetic rectangle revolved around the axis with N pocket cuts that
 * doesn't affect any measurable dimension users pull from the imported
 * STEP.
 *
 * Variant coverage (this generator)
 * ─────────────────────────────────
 * Only `ThrustBallType.SingleDirection` (= partCode STBB). The other
 * three variants — DoubleDirection (DTBB), DoubleAngularContact
 * (DTABB), PrecisionAngularContact (TACBB / HSTACBB / DDTACBB) —
 * each have a different ring topology and need separate generators in
 * Phase 2f.
 *
 * Geometry (matches C++ SingleDirection path)
 * ───────────────────────────────────────────
 *   pitchR     = (d1 + D2) / 4
 *   clr        = min(0.5, (D2-d1) × 0.05)              // assembly clearance
 *   ballR      = min(max_ball_rad, halfB × 0.45)       // line 2935
 *               where max_ball_rad = (D2-d1)/4 × 0.75
 *   grR        = ballR × 1.05                          // raceway groove arc radius
 *   gap        = ballR × 0.2                           // axial gap from washer face
 *   dy         = √(grR² - gap²)                        // groove half-width on washer face
 *   numBalls   = ⌊π · 2·pitchR / (ballR · 2 · 1.15)⌋
 *   safe_r     = min(r, (halfB-gap)·0.4, (D2-d1)/2·0.15)
 *
 *   Shaft Washer (-half_B side):
 *     ID = d1/2, OD = D2/2 - clr
 *     Axial range: [-half_B, -gap]
 *     Right-side raceway groove dipping inward toward axial=0
 *
 *   Housing Washer (+half_B side):
 *     ID = d1/2 + clr, OD = D2/2
 *     Axial range: [+gap, +half_B]
 *     Left-side raceway groove dipping inward toward axial=0
 *
 *   Balls: spheres of radius ballR centered at (axial=0, radial=pitchR),
 *   pattern around bearing axis numBalls times.
 *
 * Coordinate convention — same as the rest of the bearing family:
 *   · Z = bearing axis
 *   · Profiles in XZ plane: X = radial, Z = axial
 *   · CCW boundaries with metal interior on the LEFT
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

const C_PLUS_PLUS_BALL_RAD_RATIO = 0.75; // line 2930: (D-d)/4 × 0.75
const C_PLUS_PLUS_HALF_B_RATIO = 0.45; // line 2935: halfB × 0.45 cap
const C_PLUS_PLUS_GROOVE_RATIO = 1.05; // line 2943: grR = ballR × 1.05
const C_PLUS_PLUS_GAP_RATIO = 0.2; // line 2944
const BALL_GAP_FACTOR = 1.15; // line 3286
const CLR_DIAM_RATIO = 0.05; // line 2927
const SAFE_R_WIDTH_RATIO = 0.4; // line 2949
const SAFE_R_HEIGHT_RATIO = 0.15; // line 2950
const MIN_BALL_RAD = 0.5;
const MIN_SAFE_R = 0.05;

export async function buildStbbStepViaOcct(
  req: CadGenerateRequest,
  dims: BearingDims,
): Promise<CadGenerateResult> {
  const started = Date.now();
  const oc = await getOcct();

  // ── 1. Geometry constants (line 2922-2953) ──
  const halfB = dims.B / 2;
  const pitchR = (dims.d1 + dims.D2) / 4;
  const clr = Math.min(0.5, (dims.D2 - dims.d1) * CLR_DIAM_RATIO);

  const max_ball_rad = ((dims.D2 - dims.d1) / 4) * C_PLUS_PLUS_BALL_RAD_RATIO;
  let ballR = Math.min(max_ball_rad, halfB * C_PLUS_PLUS_HALF_B_RATIO);
  if (ballR < MIN_BALL_RAD) ballR = MIN_BALL_RAD;

  const grR = ballR * C_PLUS_PLUS_GROOVE_RATIO;
  const gap = ballR * C_PLUS_PLUS_GAP_RATIO;
  const dySq = grR * grR - gap * gap;
  if (dySq <= 0) {
    throw new Error(
      `STBB ${req.partCode}: degenerate raceway groove — gap=${gap.toFixed(3)} ≥ ` +
        `grR=${grR.toFixed(3)}. Bearing ball / width geometry is invalid.`,
    );
  }
  const dy = Math.sqrt(dySq);

  // safe_r — protects the corner fillets from collapsing onto each
  // other when r is large vs the available width / cross-section.
  let safe_r = dims.r;
  const max_r_width = (halfB - gap) * SAFE_R_WIDTH_RATIO;
  const max_r_height = (dims.D2 / 2 - dims.d1 / 2) * SAFE_R_HEIGHT_RATIO;
  const max_r = Math.min(max_r_width, max_r_height);
  if (safe_r > max_r) safe_r = max_r;
  if (safe_r < MIN_SAFE_R) safe_r = MIN_SAFE_R;

  // Washer dimensions (line 2964-2965).
  const p_ID_S = dims.d1 / 2;
  const p_OD_S = dims.D2 / 2 - clr;
  const p_ID_H = dims.d1 / 2 + clr;
  const p_OD_H = dims.D2 / 2;

  // ── 2. Shaft Washer profile (10 edges) ──
  // Axial range: [-half_B, -gap]
  // CCW in [radial, axial], starting at top-right inset for fillet (p1).
  const shaftXR = -gap;
  const shaftXL = -halfB;
  const shaftYB = p_ID_S;
  const shaftYT = p_OD_S;
  const shaftWasherFace = makeProfileWireXZ(
    oc,
    [shaftYT, shaftXR - safe_r], // p1
    [
      // 1. p1 → p2: top OD face, axial decreasing.
      { kind: 'line', to: [shaftYT, shaftXL + safe_r] },
      // 2. p2 → p3: top-LEFT corner fillet (CCW).
      {
        kind: 'arc',
        to: [shaftYT - safe_r, shaftXL],
        center: [shaftYT - safe_r, shaftXL + safe_r],
        ccw: true,
      },
      // 3. p3 → p4: left wall, radial decreasing toward bore.
      { kind: 'line', to: [shaftYB + safe_r, shaftXL] },
      // 4. p4 → p5: bottom-LEFT corner fillet.
      {
        kind: 'arc',
        to: [shaftYB, shaftXL + safe_r],
        center: [shaftYB + safe_r, shaftXL + safe_r],
        ccw: true,
      },
      // 5. p5 → p6: bore floor, axial increasing.
      { kind: 'line', to: [shaftYB, shaftXR - safe_r] },
      // 6. p6 → p7: bottom-RIGHT corner fillet.
      {
        kind: 'arc',
        to: [shaftYB + safe_r, shaftXR],
        center: [shaftYB + safe_r, shaftXR - safe_r],
        ccw: true,
      },
      // 7. p7 → p8: right wall going up to groove start.
      { kind: 'line', to: [pitchR - dy, shaftXR] },
      // 8. p8 → p9: RACEWAY GROOVE arc (concave, dips into metal toward
      //    -axial). Centre at [pitchR, 0] — the ball's centre. Short arc
      //    is on the metal-side apex (axial = -grR), distance gap-grR
      //    from the washer face.
      {
        kind: 'arc',
        to: [pitchR + dy, shaftXR],
        center: [pitchR, 0],
        ccw: false,
      },
      // 9. p9 → p10: right wall continuing up past groove.
      { kind: 'line', to: [shaftYT - safe_r, shaftXR] },
      // 10. p10 → p1: top-RIGHT corner fillet (closes loop).
      {
        kind: 'arc',
        to: [shaftYT, shaftXR - safe_r],
        center: [shaftYT - safe_r, shaftXR - safe_r],
        ccw: true,
      },
    ] satisfies ProfileSegment[],
  );
  const shaftWasher = makeRevolZ(oc, shaftWasherFace);

  // ── 3. Housing Washer profile (10 edges, mirror of shaft washer) ──
  // Axial range: [+gap, +half_B]; raceway groove on the LEFT side
  // (axial = +gap), dipping toward +axial.
  const housingXL = gap;
  const housingXR = halfB;
  const housingYB = p_ID_H;
  const housingYT = p_OD_H;
  const housingWasherFace = makeProfileWireXZ(
    oc,
    [housingYT, housingXR - safe_r], // p1
    [
      // 1. p1 → p2: top OD face axial decreasing.
      { kind: 'line', to: [housingYT, housingXL + safe_r] },
      // 2. p2 → p3: top-LEFT corner fillet.
      {
        kind: 'arc',
        to: [housingYT - safe_r, housingXL],
        center: [housingYT - safe_r, housingXL + safe_r],
        ccw: true,
      },
      // 3. p3 → p4: left wall going down to groove top.
      { kind: 'line', to: [pitchR + dy, housingXL] },
      // 4. p4 → p5: RACEWAY GROOVE arc (concave, dips into metal toward
      //    +axial). Centre at [pitchR, 0] = ball centre.
      {
        kind: 'arc',
        to: [pitchR - dy, housingXL],
        center: [pitchR, 0],
        ccw: false,
      },
      // 5. p5 → p6: left wall continuing down to bottom-left fillet.
      { kind: 'line', to: [housingYB + safe_r, housingXL] },
      // 6. p6 → p7: bottom-LEFT fillet.
      {
        kind: 'arc',
        to: [housingYB, housingXL + safe_r],
        center: [housingYB + safe_r, housingXL + safe_r],
        ccw: true,
      },
      // 7. p7 → p8: bore floor axial increasing.
      { kind: 'line', to: [housingYB, housingXR - safe_r] },
      // 8. p8 → p9: bottom-RIGHT fillet.
      {
        kind: 'arc',
        to: [housingYB + safe_r, housingXR],
        center: [housingYB + safe_r, housingXR - safe_r],
        ccw: true,
      },
      // 9. p9 → p10: right wall radial increasing toward OD.
      { kind: 'line', to: [housingYT - safe_r, housingXR] },
      // 10. p10 → p1: top-RIGHT fillet (closes).
      {
        kind: 'arc',
        to: [housingYT, housingXR - safe_r],
        center: [housingYT - safe_r, housingXR - safe_r],
        ccw: true,
      },
    ] satisfies ProfileSegment[],
  );
  const housingWasher = makeRevolZ(oc, housingWasherFace);

  // ── 4. Balls — sphere at (radial=pitchR, axial=0), pattern N times ──
  const masterBall = makeSphere(oc, [pitchR, 0, 0], ballR);
  const ballCount = computeBallCount(pitchR, ballR);
  const balls: unknown[] = [];
  for (let i = 0; i < ballCount; i++) {
    const angle = (2 * Math.PI * i) / ballCount;
    balls.push(rotateShapeAroundZ(oc, masterBall, angle, /* share */ false));
  }

  // ── 5. Merge into a single multi-body solid + STEP export ──
  const bearing = mergeShapesIntoMultibodySolid(oc, [shaftWasher, housingWasher, ...balls]);

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
 * Double-direction thrust ball bearing (DTBB) — port of the
 * `ThrustBallType.DoubleDirection` branch in `BearingCreator::Create
 * ThrustBallBearing` (C++ line 3027-3098).
 *
 * What's a DTBB
 * ─────────────
 * A 5-piece thrust bearing: ONE central shaft washer with TWO raceway
 * grooves (one on each axial face), TWO housing washers (left + right)
 * each with one raceway groove, and TWO rows of balls (one on each
 * side of the central washer). Carries axial load in BOTH directions
 * — the central washer mounts on the shaft and the housing washers
 * sit against the housing on either side.
 *
 * Geometry (line 2929-2945, 3027-3098)
 * ────────────────────────────────────
 *   ball_pos_X = halfB × 0.35           // axial offset of each ball row from centre
 *   ballR      = min(maxBallRad×0.8, (halfB - ball_pos_X)×0.7)
 *                                       // smaller balls than STBB to fit two rows
 *   grR        = ballR × 1.05
 *   gap        = ballR × 0.2
 *   dy         = √(grR² − gap²)
 *
 *   Central shaft washer (axial range [-cx, +cx] where cx = ball_pos_X − gap):
 *     ID = d1/2, OD = D2/2 − clr
 *     Two raceway grooves at axial = ±ball_pos_X dipping outward (+radial).
 *
 *   Housing washers (axial [hx, half_B] and mirror; hx = ball_pos_X + gap):
 *     ID = d1/2 + clr, OD = D2/2
 *     One raceway groove at axial = ±ball_pos_X dipping inward (−radial).
 */
export async function buildDtbbStepViaOcct(
  req: CadGenerateRequest,
  dims: BearingDims,
): Promise<CadGenerateResult> {
  const started = Date.now();
  const oc = await getOcct();

  const halfB = dims.B / 2;
  const r = dims.r;
  const clr = Math.min(0.5, (dims.D2 - dims.d1) * CLR_DIAM_RATIO);
  const pitchR = (dims.d1 + dims.D2) / 4;

  const max_ball_rad = ((dims.D2 - dims.d1) / 4) * C_PLUS_PLUS_BALL_RAD_RATIO;
  const ball_pos_X = halfB * 0.35;
  let ballR = Math.min(max_ball_rad * 0.8, (halfB - ball_pos_X) * 0.7);
  if (ballR < MIN_BALL_RAD) ballR = MIN_BALL_RAD;

  const grR = ballR * C_PLUS_PLUS_GROOVE_RATIO;
  const gap = ballR * C_PLUS_PLUS_GAP_RATIO;
  const dy = Math.sqrt(Math.max(0, grR * grR - gap * gap));

  let safe_r = r;
  const max_r_width = (halfB - ball_pos_X - gap) * SAFE_R_WIDTH_RATIO;
  const max_r_height = (dims.D2 / 2 - dims.d1 / 2) * SAFE_R_HEIGHT_RATIO;
  const max_r = Math.min(max_r_width, max_r_height);
  if (safe_r > max_r) safe_r = max_r;
  if (safe_r < MIN_SAFE_R) safe_r = MIN_SAFE_R;

  const C_ID = dims.d1 / 2;
  const C_OD = dims.D2 / 2 - clr;
  const H_ID = dims.d1 / 2 + clr;
  const H_OD = dims.D2 / 2;

  const cx = ball_pos_X - gap;
  const hx = ball_pos_X + gap;

  if (cx <= 0 || hx >= halfB) {
    throw new Error(
      `DTBB ${req.partCode}: degenerate axial layout — cx=${cx.toFixed(3)} ` +
        `hx=${hx.toFixed(3)} half_B=${halfB.toFixed(3)}.`,
    );
  }

  // ── Central shaft washer (12 segments: 6 lines + 4 corner fillets + 2 grooves). ──
  // Profile points are direct ports of C++ line 3036-3060, mapped to
  // OCCT [radial, axial]. The two grooves dip into the +radial side
  // (toward the OD) — the C++ uses `false` (CW) for grooves and `true`
  // (CCW) for corner fillets; our short-arc helper picks correctly.
  const centralWasher = makeRevolZ(
    oc,
    makeProfileWireXZ(
      oc,
      [C_ID + safe_r, cx], // p1
      [
        // p1 → p2: right side, going up to groove bottom.
        { kind: 'line', to: [pitchR - dy, cx] },
        // p2 → p3: right groove arc (dips toward +radial).
        { kind: 'arc', to: [pitchR + dy, cx], center: [pitchR, ball_pos_X], ccw: false },
        // p3 → p4: continuing up to top-right corner.
        { kind: 'line', to: [C_OD - safe_r, cx] },
        // p4 → p5: top-right corner fillet.
        { kind: 'arc', to: [C_OD, cx - safe_r], center: [C_OD - safe_r, cx - safe_r], ccw: true },
        // p5 → p6: top edge across to left side.
        { kind: 'line', to: [C_OD, -cx + safe_r] },
        // p6 → p7: top-left corner fillet.
        { kind: 'arc', to: [C_OD - safe_r, -cx], center: [C_OD - safe_r, -cx + safe_r], ccw: true },
        // p7 → p8: left side, going down toward left groove.
        { kind: 'line', to: [pitchR + dy, -cx] },
        // p8 → p9: left groove arc.
        { kind: 'arc', to: [pitchR - dy, -cx], center: [pitchR, -ball_pos_X], ccw: false },
        // p9 → p10: continuing down to bottom-left.
        { kind: 'line', to: [C_ID + safe_r, -cx] },
        // p10 → p11: bottom-left corner fillet.
        { kind: 'arc', to: [C_ID, -cx + safe_r], center: [C_ID + safe_r, -cx + safe_r], ccw: true },
        // p11 → p12: bottom edge across to right side.
        { kind: 'line', to: [C_ID, cx - safe_r] },
        // p12 → p1: bottom-right corner fillet (closes).
        { kind: 'arc', to: [C_ID + safe_r, cx], center: [C_ID + safe_r, cx - safe_r], ccw: true },
      ] satisfies ProfileSegment[],
    ),
  );

  // ── Housing washer builder (used for both sides — left is built and
  //    placed on the +axial side, then a mirrored copy is built directly
  //    via the symmetric profile on the -axial side).
  // Profile from C++ line 3069-3089 (right washer, axial range [hx, half_B]).
  const buildHousingWasher = (axialDir: 1 | -1): unknown => {
    // For axialDir = +1: right washer at axial [hx, half_B], groove at +ball_pos_X.
    // For axialDir = -1: left washer at axial [-half_B, -hx], groove at -ball_pos_X.
    const xR = axialDir === 1 ? halfB : -halfB;
    const xL = axialDir === 1 ? hx : -hx;
    const groove_axial = axialDir * ball_pos_X;
    // Outer (xR) is the housing-mating face (plain rectangle); inner
    // (xL) is the ball-facing face with the groove dipping inward (−radial).
    return makeRevolZ(
      oc,
      makeProfileWireXZ(
        oc,
        [H_ID + safe_r, xR], // pR1
        [
          // pR1 → pR2: outer face going up at xR.
          { kind: 'line', to: [H_OD - safe_r, xR] },
          // pR2 → pR3: outer top corner fillet.
          { kind: 'arc', to: [H_OD, xR - axialDir * safe_r], center: [H_OD - safe_r, xR - axialDir * safe_r], ccw: true },
          // pR3 → pR4: top edge across to inner side.
          { kind: 'line', to: [H_OD, xL + axialDir * safe_r] },
          // pR4 → pR5: inner top corner fillet.
          { kind: 'arc', to: [H_OD - safe_r, xL], center: [H_OD - safe_r, xL + axialDir * safe_r], ccw: true },
          // pR5 → pR6: inner side going down to groove top.
          { kind: 'line', to: [pitchR + dy, xL] },
          // pR6 → pR7: groove arc dipping toward −radial (axial=ball_pos_X is the dip apex).
          { kind: 'arc', to: [pitchR - dy, xL], center: [pitchR, groove_axial], ccw: false },
          // pR7 → pR8: continuing down to bottom inner corner.
          { kind: 'line', to: [H_ID + safe_r, xL] },
          // pR8 → pR9: inner bottom corner fillet.
          { kind: 'arc', to: [H_ID, xL + axialDir * safe_r], center: [H_ID + safe_r, xL + axialDir * safe_r], ccw: true },
          // pR9 → pR10: bottom edge back across to outer side.
          { kind: 'line', to: [H_ID, xR - axialDir * safe_r] },
          // pR10 → pR1: outer bottom corner fillet (closes).
          { kind: 'arc', to: [H_ID + safe_r, xR], center: [H_ID + safe_r, xR - axialDir * safe_r], ccw: true },
        ] satisfies ProfileSegment[],
      ),
    );
  };

  const rightHousing = buildHousingWasher(1);
  const leftHousing = buildHousingWasher(-1);

  // ── Two ball rows at (radial=pitchR, axial=±ball_pos_X). ──
  const masterBallRight = makeSphere(oc, [pitchR, 0, ball_pos_X], ballR);
  const masterBallLeft = makeSphere(oc, [pitchR, 0, -ball_pos_X], ballR);
  const ballCount = computeBallCount(pitchR, ballR);
  const balls: unknown[] = [];
  for (let i = 0; i < ballCount; i++) {
    const angle = (2 * Math.PI * i) / ballCount;
    balls.push(rotateShapeAroundZ(oc, masterBallRight, angle, /* share */ false));
    balls.push(rotateShapeAroundZ(oc, masterBallLeft, angle, /* share */ false));
  }

  const bearing = mergeShapesIntoMultibodySolid(oc, [
    centralWasher,
    rightHousing,
    leftHousing,
    ...balls,
  ]);

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
 * Precision angular-contact thrust ball bearing (TACBB / HSTACBB /
 * DDTACBB) — port of `ThrustBallType.PrecisionAngularContact` in
 * `BearingCreator::CreateThrustBallBearing` (C++ line 3189-3281).
 *
 * What's a TACBB
 * ──────────────
 * A SINGLE row of balls running at a steep contact angle (60° by
 * default; the C++ reads from `m_options.contactAngle`) between an
 * inner ring at radial = [d1/2, pitchR] and an outer ring at radial =
 * [pitchR, D2/2]. Each raceway groove is ASYMMETRIC: a tall "shoulder"
 * on the load-reaction side (`dx_s = grR × 0.85`) and a low "relief"
 * on the assembly side (`dx_r = grR × 0.2`). Used in machine-tool
 * spindles where preload + axial load + high precision are required.
 *
 * Inner ring's groove offsets diagonally toward (-axial, -radial)
 * from the pitch point; outer ring's groove offsets toward (+axial,
 * +radial). This creates the contact-angle line passing through both
 * groove centres + the ball center.
 */
export async function buildTacbbStepViaOcct(
  req: CadGenerateRequest,
  dims: BearingDims,
): Promise<CadGenerateResult> {
  const started = Date.now();
  const oc = await getOcct();

  const halfB = dims.B / 2;
  const r = dims.r;
  const clr = Math.min(0.5, (dims.D2 - dims.d1) * CLR_DIAM_RATIO);
  const pitchR = (dims.d1 + dims.D2) / 4;

  const max_ball_rad = ((dims.D2 - dims.d1) / 4) * C_PLUS_PLUS_BALL_RAD_RATIO;
  let ballR = Math.min(max_ball_rad, halfB * C_PLUS_PLUS_HALF_B_RATIO);
  if (ballR < MIN_BALL_RAD) ballR = MIN_BALL_RAD;
  const grR = ballR * C_PLUS_PLUS_GROOVE_RATIO;

  // Contact angle from the request (or 60° default, C++ line 3195).
  const alphaDeg = readPositiveNumber(req, 'a_2') ?? 60;
  const alpha = (alphaDeg * Math.PI) / 180;
  const shift_x = grR * Math.sin(alpha);
  const shift_y = grR * Math.cos(alpha);

  const dx_s = grR * 0.85;
  const dx_r = grR * 0.2;
  const dy_s = Math.sqrt(Math.max(0, grR * grR - dx_s * dx_s));
  const dy_r = Math.sqrt(Math.max(0, grR * grR - dx_r * dx_r));

  const P_ID = dims.d1 / 2;
  const P_OD = dims.D2 / 2;

  let safe_r = r;
  const max_r_height = (dims.D2 - dims.d1) / 2 * SAFE_R_HEIGHT_RATIO;
  if (safe_r > max_r_height) safe_r = max_r_height;
  if (safe_r < MIN_SAFE_R) safe_r = MIN_SAFE_R;

  // ── Inner ring (lower, radial range [P_ID, ~pitchR]). ──
  // Groove center diagonally offset to (axial=-shift_x, radial=pitchR-shift_y).
  // 10 boundary points; profile order matches C++ pI_1..pI_10.
  const innerRing = makeRevolZ(
    oc,
    makeProfileWireXZ(
      oc,
      [pitchR - dy_r, halfB - safe_r], // pI_1: top-right just before fillet, on relief side
      [
        // pI_1 → pI_2: line along top toward groove relief side.
        { kind: 'line', to: [pitchR - dy_r, -shift_x + dx_r] },
        // pI_2 → pI_3: ASYMMETRIC raceway groove arc (CW dipping inward).
        {
          kind: 'arc',
          to: [pitchR - dy_s, -shift_x - dx_s],
          center: [pitchR - shift_y, -shift_x],
          ccw: false,
        },
        // pI_3 → pI_4: line continuing toward shoulder side.
        { kind: 'line', to: [pitchR - dy_s, -halfB + safe_r] },
        // pI_4 → pI_5: top-LEFT corner fillet (CCW).
        {
          kind: 'arc',
          to: [pitchR - dy_s - safe_r, -halfB],
          center: [pitchR - dy_s - safe_r, -halfB + safe_r],
          ccw: true,
        },
        // pI_5 → pI_6: left wall going down (radial decreasing toward bore).
        { kind: 'line', to: [P_ID + safe_r, -halfB] },
        // pI_6 → pI_7: bottom-LEFT corner fillet.
        {
          kind: 'arc',
          to: [P_ID, -halfB + safe_r],
          center: [P_ID + safe_r, -halfB + safe_r],
          ccw: true,
        },
        // pI_7 → pI_8: bore (axial increasing) at radial = P_ID.
        { kind: 'line', to: [P_ID, halfB - safe_r] },
        // pI_8 → pI_9: bottom-RIGHT corner fillet.
        {
          kind: 'arc',
          to: [P_ID + safe_r, halfB],
          center: [P_ID + safe_r, halfB - safe_r],
          ccw: true,
        },
        // pI_9 → pI_10: right wall going up.
        { kind: 'line', to: [pitchR - dy_r - safe_r, halfB] },
        // pI_10 → pI_1: top-RIGHT corner fillet (closes).
        {
          kind: 'arc',
          to: [pitchR - dy_r, halfB - safe_r],
          center: [pitchR - dy_r - safe_r, halfB - safe_r],
          ccw: true,
        },
      ] satisfies ProfileSegment[],
    ),
  );

  // ── Outer ring (upper, radial range [~pitchR, P_OD]). ──
  // Groove center diagonally offset to (axial=+shift_x, radial=pitchR+shift_y).
  const outerRing = makeRevolZ(
    oc,
    makeProfileWireXZ(
      oc,
      [P_OD, halfB - safe_r], // pO_1: top-right OD just before fillet
      [
        // pO_1 → pO_2: OD top face axial-leftward.
        { kind: 'line', to: [P_OD, -halfB + safe_r] },
        // pO_2 → pO_3: top-LEFT corner fillet.
        {
          kind: 'arc',
          to: [P_OD - safe_r, -halfB],
          center: [P_OD - safe_r, -halfB + safe_r],
          ccw: true,
        },
        // pO_3 → pO_4: left wall going down to relief side of groove.
        { kind: 'line', to: [pitchR + dy_r + safe_r, -halfB] },
        // pO_4 → pO_5: bottom-LEFT corner fillet entering relief.
        {
          kind: 'arc',
          to: [pitchR + dy_r, -halfB + safe_r],
          center: [pitchR + dy_r + safe_r, -halfB + safe_r],
          ccw: true,
        },
        // pO_5 → pO_6: line along bottom toward groove relief.
        { kind: 'line', to: [pitchR + dy_r, shift_x - dx_r] },
        // pO_6 → pO_7: ASYMMETRIC raceway groove arc.
        {
          kind: 'arc',
          to: [pitchR + dy_s, shift_x + dx_s],
          center: [pitchR + shift_y, shift_x],
          ccw: false,
        },
        // pO_7 → pO_8: line continuing along bottom toward shoulder side.
        { kind: 'line', to: [pitchR + dy_s, halfB - safe_r] },
        // pO_8 → pO_9: bottom-RIGHT corner fillet.
        {
          kind: 'arc',
          to: [pitchR + dy_s + safe_r, halfB],
          center: [pitchR + dy_s + safe_r, halfB - safe_r],
          ccw: true,
        },
        // pO_9 → pO_10: right wall going up to OD.
        { kind: 'line', to: [P_OD - safe_r, halfB] },
        // pO_10 → pO_1: top-RIGHT corner fillet (closes).
        {
          kind: 'arc',
          to: [P_OD, halfB - safe_r],
          center: [P_OD - safe_r, halfB - safe_r],
          ccw: true,
        },
      ] satisfies ProfileSegment[],
    ),
  );

  // ── Single ball row at (radial=pitchR, axial=0). ──
  const masterBall = makeSphere(oc, [pitchR, 0, 0], ballR);
  const ballCount = computeBallCount(pitchR, ballR);
  const balls: unknown[] = [];
  for (let i = 0; i < ballCount; i++) {
    const angle = (2 * Math.PI * i) / ballCount;
    balls.push(rotateShapeAroundZ(oc, masterBall, angle, /* share */ false));
  }

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
 * Double angular-contact thrust ball bearing (DTABB) — port of
 * `ThrustBallType.DoubleAngularContact` (C++ line 3100-3188).
 * Structurally a DOUBLE-row TACBB: ONE central inner ring with TWO
 * asymmetric raceway grooves + TWO outer rings (left + right) each
 * with one asymmetric raceway, + TWO ball rows at axial = ±ball_pos_X.
 *
 * Geometry differences vs DTBB
 * ────────────────────────────
 *   · Each groove is ASYMMETRIC (shoulder vs relief), same as TACBB
 *   · Inner ring spans full B; outer rings each span ~half B
 *   · Contact angle defaults to 60°
 */
export async function buildDtabbStepViaOcct(
  req: CadGenerateRequest,
  dims: BearingDims,
): Promise<CadGenerateResult> {
  const started = Date.now();
  const oc = await getOcct();

  const halfB = dims.B / 2;
  const r = dims.r;
  const clr = Math.min(0.5, (dims.D2 - dims.d1) * CLR_DIAM_RATIO);
  const pitchR = (dims.d1 + dims.D2) / 4;

  const max_ball_rad = ((dims.D2 - dims.d1) / 4) * C_PLUS_PLUS_BALL_RAD_RATIO;
  const ball_pos_X = halfB * 0.35;
  let ballR = Math.min(max_ball_rad * 0.8, (halfB - ball_pos_X) * 0.7);
  if (ballR < MIN_BALL_RAD) ballR = MIN_BALL_RAD;
  const grR = ballR * C_PLUS_PLUS_GROOVE_RATIO;

  const cx1 = -ball_pos_X;
  const cx2 = ball_pos_X;
  let dx_s = grR * 0.85;
  let dx_r = grR * 0.3;
  // C++ guard against shoulder/relief crossing the centre.
  const max_dx_s = ball_pos_X - 0.05;
  if (dx_s > max_dx_s) dx_s = max_dx_s;
  const gap_O = dims.B * 0.05;
  const max_dx_r_outer = halfB - ball_pos_X - 0.05; // safe_r added below
  if (dx_r > max_dx_r_outer) dx_r = max_dx_r_outer;
  const dy_s = Math.sqrt(Math.max(0, grR * grR - dx_s * dx_s));
  const dy_r = Math.sqrt(Math.max(0, grR * grR - dx_r * dx_r));

  let safe_r = r;
  const max_r_height = (dims.D2 - dims.d1) / 2 * SAFE_R_HEIGHT_RATIO;
  if (safe_r > max_r_height) safe_r = max_r_height;
  if (safe_r < MIN_SAFE_R) safe_r = MIN_SAFE_R;

  const Y_B = dims.d1 / 2;
  const Y_T = dims.D2 / 2;

  // ── Central inner ring with TWO asymmetric grooves. ──
  // Profile from C++ line 3119-3148 (12 segments). Each groove dips
  // toward radial = pitchR. Groove centers at [pitchR, cx1] and [pitchR, cx2].
  const X_L = -halfB;
  const X_R = halfB;
  const innerRing = makeRevolZ(
    oc,
    makeProfileWireXZ(
      oc,
      [pitchR - dy_r, X_R - safe_r], // p1
      [
        // p1 → p2: line along top toward right groove relief side.
        { kind: 'line', to: [pitchR - dy_r, cx2 + dx_r] },
        // p2 → p3: right asymmetric groove arc.
        {
          kind: 'arc',
          to: [pitchR - dy_s, cx2 - dx_s],
          center: [pitchR, cx2],
          ccw: false,
        },
        // p3 → p4: line between grooves.
        { kind: 'line', to: [pitchR - dy_s, cx1 + dx_s] },
        // p4 → p5: left asymmetric groove arc.
        {
          kind: 'arc',
          to: [pitchR - dy_r, cx1 - dx_r],
          center: [pitchR, cx1],
          ccw: false,
        },
        // p5 → p6: line continuing left.
        { kind: 'line', to: [pitchR - dy_r, X_L + safe_r] },
        // p6 → p7: top-LEFT corner fillet.
        {
          kind: 'arc',
          to: [pitchR - dy_r - safe_r, X_L],
          center: [pitchR - dy_r - safe_r, X_L + safe_r],
          ccw: true,
        },
        // p7 → p8: left wall going down to bore.
        { kind: 'line', to: [Y_B + safe_r, X_L] },
        // p8 → p9: bottom-LEFT corner fillet.
        {
          kind: 'arc',
          to: [Y_B, X_L + safe_r],
          center: [Y_B + safe_r, X_L + safe_r],
          ccw: true,
        },
        // p9 → p10: bore.
        { kind: 'line', to: [Y_B, X_R - safe_r] },
        // p10 → p11: bottom-RIGHT corner fillet.
        {
          kind: 'arc',
          to: [Y_B + safe_r, X_R],
          center: [Y_B + safe_r, X_R - safe_r],
          ccw: true,
        },
        // p11 → p12: right wall going up.
        { kind: 'line', to: [pitchR - dy_r - safe_r, X_R] },
        // p12 → p1: top-RIGHT corner fillet (closes).
        {
          kind: 'arc',
          to: [pitchR - dy_r, X_R - safe_r],
          center: [pitchR - dy_r - safe_r, X_R - safe_r],
          ccw: true,
        },
      ] satisfies ProfileSegment[],
    ),
  );

  // ── Outer ring builder (one per side; left is mirrored). ──
  // C++ profile from line 3154-3178 (right outer ring); 10 segments.
  // For axialDir=+1: right outer at axial [gap_O, half_B], groove at +ball_pos_X.
  // For axialDir=-1: left outer (mirrored).
  const buildOuterRing = (axialDir: 1 | -1): unknown => {
    const O_L = axialDir * gap_O;
    const O_R = axialDir * halfB;
    const groove_axial = axialDir * ball_pos_X;
    const sFlip = axialDir === 1 ? 1 : -1; // sign flip for +/− axial directions
    return makeRevolZ(
      oc,
      makeProfileWireXZ(
        oc,
        [Y_T, O_R - sFlip * safe_r],
        [
          { kind: 'line', to: [Y_T, O_L + sFlip * safe_r] },
          {
            kind: 'arc',
            to: [Y_T - safe_r, O_L],
            center: [Y_T - safe_r, O_L + sFlip * safe_r],
            ccw: true,
          },
          { kind: 'line', to: [pitchR + dy_r + safe_r, O_L] },
          {
            kind: 'arc',
            to: [pitchR + dy_r, O_L + sFlip * safe_r],
            center: [pitchR + dy_r + safe_r, O_L + sFlip * safe_r],
            ccw: true,
          },
          { kind: 'line', to: [pitchR + dy_r, groove_axial - sFlip * dx_r] },
          {
            kind: 'arc',
            to: [pitchR + dy_s, groove_axial + sFlip * dx_s],
            center: [pitchR, groove_axial],
            ccw: false,
          },
          { kind: 'line', to: [pitchR + dy_s, O_R - sFlip * safe_r] },
          {
            kind: 'arc',
            to: [pitchR + dy_s + safe_r, O_R],
            center: [pitchR + dy_s + safe_r, O_R - sFlip * safe_r],
            ccw: true,
          },
          { kind: 'line', to: [Y_T - safe_r, O_R] },
          {
            kind: 'arc',
            to: [Y_T, O_R - sFlip * safe_r],
            center: [Y_T - safe_r, O_R - sFlip * safe_r],
            ccw: true,
          },
        ] satisfies ProfileSegment[],
      ),
    );
  };

  const rightOuter = buildOuterRing(1);
  const leftOuter = buildOuterRing(-1);

  // Two ball rows at axial = ±ball_pos_X.
  const masterBallRight = makeSphere(oc, [pitchR, 0, ball_pos_X], ballR);
  const masterBallLeft = makeSphere(oc, [pitchR, 0, -ball_pos_X], ballR);
  const ballCount = computeBallCount(pitchR, ballR);
  const balls: unknown[] = [];
  for (let i = 0; i < ballCount; i++) {
    const angle = (2 * Math.PI * i) / ballCount;
    balls.push(rotateShapeAroundZ(oc, masterBallRight, angle, /* share */ false));
    balls.push(rotateShapeAroundZ(oc, masterBallLeft, angle, /* share */ false));
  }

  const bearing = mergeShapesIntoMultibodySolid(oc, [
    innerRing,
    rightOuter,
    leftOuter,
    ...balls,
  ]);

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

function readPositiveNumber(req: CadGenerateRequest, key: string): number | undefined {
  const v = req.dimensions[key];
  if (v == null || v === '') return undefined;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * Ball count — C++ formula on line 3286:
 *   numBalls = floor(π · pitchDia / (ballDia × 1.15))
 * The 1.15 spacing factor is tighter than the radial-bearing 1.5 default
 * because thrust balls don't have to clear a cage rib axially.
 */
function computeBallCount(pitchR: number, ballR: number): number {
  const pitchDia = pitchR * 2;
  const ballDia = ballR * 2;
  return Math.max(6, Math.floor((Math.PI * pitchDia) / (ballDia * BALL_GAP_FACTOR)));
}
