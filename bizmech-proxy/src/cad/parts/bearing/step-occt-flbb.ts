/**
 * OCCT-backed STEP generator for flanged ball bearings (FLBB).
 * Faithful port of `BearingCreator::CreateFlangedBearing`
 * (`C++Source/NewCreateBearingClass.cpp` line 4618-4648).
 *
 * What's a Flanged bearing
 * ────────────────────────
 * A flanged bearing is a deep-groove ball bearing (DGBB) with an
 * additional ANNULAR FLANGE on one axial face of the outer ring. The
 * flange's OD is typically 1.3× the bearing's D, and the thickness is
 * about 15% of the bearing's B. Designers use it to position the
 * bearing axially in a housing without needing a separate retaining
 * ring or shoulder cut.
 *
 * Geometry
 * ────────
 * Identical to DGBB (same ball-size, raceway-groove ratios, corner
 * fillets) PLUS one extra solid:
 *   flangeD       = D2 × 1.3
 *   flangeThk     = B × 0.15
 *   Flange position: axial range [-halfB, -halfB + flangeThk],
 *                     radial range [outerR, flangeD/2]
 *
 * The flange is a separate body in the multi-body output (the C++
 * reference uses CiJoinOpEnum::Join to fuse it with the outer ring;
 * we keep it separate so the user can hide / edit it independently in
 * Inventor without affecting the bearing rings).
 *
 * NO partCode in the catalog DB at the moment
 * ────────────────────────────────────────────
 * The C++ source matches `partCode.contains("FL")` — too broad, conflicts
 * with UCFL / UKFL / FLBOLT in our DB. We register the synthetic code
 * 'FLBB' so the dispatcher doesn't grab unrelated parts; once a real
 * Flanged Ball Bearing partCode shows up in `partspec`, point its
 * KIND_OF_CODE entry at this generator.
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

const DGBB_BALL_DIA_RATIO = 0.3;
const DGBB_GROOVE_RATIO = 1.02;
const DGBB_SHOULDER_RATIO = 0.8;
const DGBB_BALL_GAP = 1.2;
const FLANGE_OD_RATIO = 1.3; // C++ line 4627
const FLANGE_THK_RATIO = 0.15; // C++ line 4628

export async function buildFlbbStepViaOcct(
  req: CadGenerateRequest,
  dims: BearingDims,
): Promise<CadGenerateResult> {
  const started = Date.now();
  const oc = await getOcct();

  // ── 1. DGBB-shared geometry constants ──
  const innerR = dims.d1 / 2;
  const outerR = dims.D2 / 2;
  const halfB = dims.B / 2;
  const r = dims.r;

  const ballDia =
    readPositiveNumber(req, 'Dw') ?? (dims.D2 - dims.d1) * DGBB_BALL_DIA_RATIO;
  const ballR = ballDia / 2;
  const pitchR =
    (readPositiveNumber(req, 'dm') ?? (dims.d1 + dims.D2) / 2) / 2;
  const grooveR = ballR * DGBB_GROOVE_RATIO;
  const shoulderH_Inner = pitchR - grooveR * DGBB_SHOULDER_RATIO;
  const shoulderH_Outer = pitchR + grooveR * DGBB_SHOULDER_RATIO;
  const grooveHalfW = Math.sqrt(
    Math.max(0, grooveR * grooveR - (pitchR - shoulderH_Inner) ** 2),
  );

  // ── 2. Inner ring profile (8 edges, same as DGBB) ──
  const innerRingFace = makeProfileWireXZ(
    oc,
    [innerR, halfB - r],
    [
      { kind: 'line', to: [innerR, -halfB + r] },
      {
        kind: 'arc',
        to: [innerR + r, -halfB],
        center: [innerR + r, -halfB + r],
        ccw: true,
      },
      { kind: 'line', to: [shoulderH_Inner, -halfB] },
      { kind: 'line', to: [shoulderH_Inner, -grooveHalfW] },
      {
        kind: 'arc',
        to: [shoulderH_Inner, grooveHalfW],
        center: [pitchR, 0],
        ccw: false,
      },
      { kind: 'line', to: [shoulderH_Inner, halfB] },
      { kind: 'line', to: [innerR + r, halfB] },
      {
        kind: 'arc',
        to: [innerR, halfB - r],
        center: [innerR + r, halfB - r],
        ccw: true,
      },
    ] satisfies ProfileSegment[],
  );
  const innerRing = makeRevolZ(oc, innerRingFace);

  // ── 3. Outer ring profile (8 edges, same as DGBB) ──
  const outerRingFace = makeProfileWireXZ(
    oc,
    [outerR, halfB - r],
    [
      { kind: 'line', to: [outerR, -halfB + r] },
      {
        kind: 'arc',
        to: [outerR - r, -halfB],
        center: [outerR - r, -halfB + r],
        ccw: true,
      },
      { kind: 'line', to: [shoulderH_Outer, -halfB] },
      { kind: 'line', to: [shoulderH_Outer, -grooveHalfW] },
      {
        kind: 'arc',
        to: [shoulderH_Outer, grooveHalfW],
        center: [pitchR, 0],
        ccw: false,
      },
      { kind: 'line', to: [shoulderH_Outer, halfB] },
      { kind: 'line', to: [outerR - r, halfB] },
      {
        kind: 'arc',
        to: [outerR, halfB - r],
        center: [outerR - r, halfB - r],
        ccw: true,
      },
    ] satisfies ProfileSegment[],
  );
  const outerRing = makeRevolZ(oc, outerRingFace);

  // ── 4. Flange — annular disk on the -halfB side of the outer ring ──
  const flangeR = (dims.D2 * FLANGE_OD_RATIO) / 2;
  const flangeThk = dims.B * FLANGE_THK_RATIO;
  if (flangeR <= outerR) {
    throw new Error(
      `FLBB ${req.partCode}: flange radius ${flangeR.toFixed(3)} ≤ bearing OD ` +
        `${outerR.toFixed(3)} — flange OD ratio of ${FLANGE_OD_RATIO} produced ` +
        `degenerate geometry. Check D2 in partdimension.`,
    );
  }
  if (flangeThk >= dims.B) {
    throw new Error(
      `FLBB ${req.partCode}: flange thickness ${flangeThk.toFixed(3)} ≥ bearing B ` +
        `${dims.B} — would consume the entire bearing width.`,
    );
  }
  // Profile in [radial, axial] — CCW with metal interior on LEFT.
  // Walking from [outerR, -halfB] in radial+ direction puts the metal
  // (between -halfB and -halfB+flangeThk axially) on the left.
  const flangeFace = makeProfileWireXZ(
    oc,
    [outerR, -halfB],
    [
      // 1. Bottom of flange (axial = -halfB) — radial+ to flange OD.
      { kind: 'line', to: [flangeR, -halfB] },
      // 2. Flange OD wall — axial+ from -halfB to -halfB+flangeThk.
      { kind: 'line', to: [flangeR, -halfB + flangeThk] },
      // 3. Top of flange (axial = -halfB + flangeThk) — radial- back to outerR.
      { kind: 'line', to: [outerR, -halfB + flangeThk] },
      // 4. Inner bore of flange — axial- to close (touches outer ring's OD).
      { kind: 'line', to: [outerR, -halfB] },
    ] satisfies ProfileSegment[],
  );
  const flange = makeRevolZ(oc, flangeFace);

  // ── 5. Balls ──
  const masterBall = makeSphere(oc, [pitchR, 0, 0], ballR);
  const ballCount = computeBallCount(req, pitchR, ballDia);
  const balls: unknown[] = [];
  for (let i = 0; i < ballCount; i++) {
    const angle = (2 * Math.PI * i) / ballCount;
    balls.push(rotateShapeAroundZ(oc, masterBall, angle, /* share */ false));
  }

  // ── 6. Merge into a single multi-body solid + STEP export ──
  const bearing = mergeShapesIntoMultibodySolid(oc, [innerRing, outerRing, flange, ...balls]);

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
  return Math.max(6, Math.floor((Math.PI * pitchDia) / (ballDia * DGBB_BALL_GAP)));
}

function readPositiveNumber(req: CadGenerateRequest, key: string): number | undefined {
  const v = req.dimensions[key];
  if (v == null || v === '') return undefined;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}
