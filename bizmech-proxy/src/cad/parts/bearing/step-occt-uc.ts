/**
 * OCCT-backed STEP generator for UC mounted-unit insert bearings (UCB).
 * Loose port of `BearingCreator::CreateUCBearing` (`C++Source/NewCreate
 * BearingClass.cpp` line 4746–4877).
 *
 * UC bearings are functionally deep-groove ball bearings that have been
 * adapted for mounting in pillow-block / flange / take-up housings:
 *   · The outer ring's OD is SPHERICAL (radius = D2/2, centered on the
 *     bearing's geometric centre) — that lets the inner-ring + balls
 *     assembly self-align inside a matching spherical seat in the
 *     housing.
 *   · The inner ring is wider (B) than the outer ring (C), with the
 *     two extra-wide ends providing room for a radial set-screw tap
 *     that locks the bearing onto its shaft.
 *   · There's no separate cage; balls run loose against the raceway
 *     grooves (same as a DGBB).
 *
 * Why we deviate from the C++ formulas
 * ────────────────────────────────────
 * The C++ source's two ratios `innerRingOR = innerR + (D-d)·0.38` and
 * `outerRingIR = innerR + (D-d)·0.42` produce a 0.04·(D-d) raceway gap
 * — for UC205 that's 0.54 mm, which then makes `ballR = gap × 0.45 =
 * 0.24 mm` (a 0.5 mm ball in a 27 mm bearing!). That's clearly a bug
 * in the reference; real UC205 has Dw ≈ 8 mm. We instead reuse the
 * DGBB ball-size ratio `Dw = (D2-d1) × 0.3` which lands within ~5 % of
 * catalog values across the UC2/UC3 series, and derive the raceway
 * shoulders from there (DGBB convention).
 *
 * Geometry summary
 * ────────────────
 *   ballDia       = catalog Dw if present, else (D2 - d1) × 0.3
 *   pitchR        = catalog dm/2 if present, else (d1 + D2) / 4
 *   grooveR       = ballR × 1.02
 *   shoulderH_Inner = pitchR − grooveR × 0.8
 *   shoulderH_Outer = pitchR + grooveR × 0.8
 *   grooveHalfW   = √(grooveR² − (pitchR − shoulderH_Inner)²)
 *   sphereR_outer = D2/2                       // OD sphere radius
 *   intersect_R   = √(sphereR² − halfC²)       // OD edge at axial=±halfC
 *   ballCount     = catalog Z if present, else
 *                   ⌊π · pcd / (Dw × 1.2)⌋     // DGBB convention
 *
 * Coordinate convention — same as the rest of the bearing family.
 *
 * What's NOT modeled
 * ──────────────────
 *   · Set-screw tap (radial threaded hole on the inner ring's wide
 *     end). Cosmetic; requires OCCT BRepFeat_MakeCylindricalHole +
 *     thread feature — substantial code; defer.
 *   · Lubrication groove on outer ring's OD (some UC variants).
 *   · Seal lips. Implementing these would significantly expand the
 *     profile-segment count without changing measurable dimensions.
 */
import type { CadGenerateRequest, CadGenerateResult } from '../../types.js';
import { FORMAT_EXT, FORMAT_MIME } from '../../types.js';
import {
  boolCut,
  exportStepBytes,
  flattenBrepWithVoidsToManifolds,
  getOcct,
  makeCylinder,
  makeProfileWireXZ,
  makeRevolZ,
  makeSphere,
  mergeShapesIntoMultibodySolid,
  rotateShapeAroundZ,
  translateShape,
  type ProfileSegment,
} from '../../core/occt.js';
import { bomFileName } from '../../core/bom-meta.js';
import type { BearingDims } from './dimensions.js';

const DGBB_BALL_DIA_RATIO = 0.3;
const DGBB_GROOVE_RATIO = 1.02;
const DGBB_SHOULDER_RATIO = 0.8;
const DGBB_BALL_GAP = 1.2;
const SET_SCREW_AXIAL_RATIO = 0.7; // C++ line 4811: screwPosX = halfB × 0.7
const SET_SCREW_ANGULAR_SPACING = (2 * Math.PI) / 3; // 120° between the two screws
const SET_SCREW_DEFAULT_NOMINAL = 6; // M6 fallback when DB row's G field is empty
const SET_SCREW_COUNTERBORE_OVERSIZE = 1.0; // counterbore radius = M-nominal/2 + this
const SET_SCREW_COUNTERBORE_DEPTH = 0.6; // axial-radial depth of the counterbore lip
const SEAL_RADIAL_CLEARANCE = 0.3; // mm gap between seal edges and the rings
const SEAL_THICKNESS = 0.8; // typical rubber-seal axial thickness

/**
 * Body shapes that make up a UC bearing — used by the standalone
 * generator AND by the unit-bearing flange housings (UCF / UKF /
 * UCFC / UKFC / UCFL / UKFL / UCFS / UKFS) which sit the bearing
 * inside a flange-shaped housing. Returning the shapes individually
 * lets the housing wrappers add the housing solid + merge with the
 * bearing in a single multi-body STEP.
 *
 * The `metadata` block exports a few per-bearing geometry constants
 * (`outerR` for the housing's spherical-seat radius; `pitchR` for any
 * future raceway visualisation) so the housing builder doesn't have
 * to re-derive them.
 */
export interface UcbBodyShapes {
  innerRing: unknown;
  outerRing: unknown;
  /** Balls + optional annular seals (when shoulder geometry permits). */
  rollingBodies: unknown[];
  metadata: {
    outerR: number;
    pitchR: number;
    halfC: number;
  };
}

/**
 * Build the per-body shapes of a UC mounted-unit insert bearing
 * without merging or exporting. Geometry / validation logic is
 * identical to `buildUcbStepViaOcct` — the latter is now a thin
 * wrapper over this helper plus the merge-and-export step.
 */
export async function buildUcbBodyShapes(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  oc: any,
  req: CadGenerateRequest,
  dims: BearingDims,
): Promise<UcbBodyShapes> {
  // ── 1. Geometry constants ──
  const innerR = dims.d1 / 2;
  const outerR = dims.D2 / 2;
  const halfB = dims.B / 2;
  const r = dims.r;
  const cWidth = readPositiveNumber(req, 'C') ?? dims.D2 * 0.35; // line 4758 fallback
  const halfC = cWidth / 2;

  if (cWidth >= dims.B) {
    throw new Error(
      `UCB ${req.partCode}: outer-ring width C=${cWidth.toFixed(3)} ≥ inner-ring ` +
        `width B=${dims.B} — UC bearings need C < B for the spherical OD to fit ` +
        `within the bearing's axial extent.`,
    );
  }

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

  // OD spherical-arc endpoint: where the line axial = ±halfC meets the
  // sphere of radius outerR centred at [0, 0]. That's the radial co-
  // ordinate of the outer ring's two annular end-faces.
  if (halfC >= outerR) {
    throw new Error(
      `UCB ${req.partCode}: halfC=${halfC.toFixed(3)} ≥ outerR=${outerR.toFixed(3)} ` +
        `— spherical OD section impossible. Check D2 / C in partdimension.`,
    );
  }
  const intersect_R = Math.sqrt(outerR * outerR - halfC * halfC);

  if (
    shoulderH_Inner <= innerR + r ||
    shoulderH_Outer >= intersect_R - r ||
    grooveHalfW > halfC - r
  ) {
    throw new Error(
      `UCB ${req.partCode}: degenerate raceway / wall geometry — ` +
        `pitchR=${pitchR.toFixed(3)} shoulderH_Inner=${shoulderH_Inner.toFixed(3)} ` +
        `shoulderH_Outer=${shoulderH_Outer.toFixed(3)} grooveHalfW=${grooveHalfW.toFixed(3)} ` +
        `intersect_R=${intersect_R.toFixed(3)} halfC=${halfC.toFixed(3)}.`,
    );
  }

  // ── 2. Inner ring profile (CCW, 8 edges) ──
  // Identical to DGBB inner-ring topology — the wide axial extent (B)
  // is what makes UC's inner ring distinct, not the cross-section
  // shape. Set-screw tap area is left as plain solid metal.
  const innerRingFace = makeProfileWireXZ(
    oc,
    [innerR, halfB - r], // top of right bore wall
    [
      // 1. Right bore wall going down.
      { kind: 'line', to: [innerR, -halfB + r] },
      // 2. Right-bottom fillet.
      {
        kind: 'arc',
        to: [innerR + r, -halfB],
        center: [innerR + r, -halfB + r],
        ccw: true,
      },
      // 3. Bottom edge — going right toward shoulder.
      { kind: 'line', to: [shoulderH_Inner, -halfB] },
      // 4. Right wall going up to groove start.
      { kind: 'line', to: [shoulderH_Inner, -grooveHalfW] },
      // 5. Raceway groove arc dipping inward.
      {
        kind: 'arc',
        to: [shoulderH_Inner, grooveHalfW],
        center: [pitchR, 0],
        ccw: false,
      },
      // 6. Right wall continuing up past groove.
      { kind: 'line', to: [shoulderH_Inner, halfB] },
      // 7. Top edge going left to top-right fillet.
      { kind: 'line', to: [innerR + r, halfB] },
      // 8. Top-right fillet (closes loop).
      {
        kind: 'arc',
        to: [innerR, halfB - r],
        center: [innerR + r, halfB - r],
        ccw: true,
      },
    ] satisfies ProfileSegment[],
  );
  const innerRingRaw = makeRevolZ(oc, innerRingFace);

  // ── 2b. Set-screw tap holes ──
  // Real UC bearings have two M-thread set screws on ONE hub, spaced
  // 120° apart angularly, at axial = halfB × 0.7 (C++ line 4811). The
  // screws engage the shaft to lock the inner ring in place. We model
  // them as plain cylindrical through-holes from the hub's outer
  // surface (radial = shoulderH_Inner) all the way to the bore (radial
  // = innerR) — STEP doesn't carry thread information natively, so any
  // CAD measuring the imported part sees a CYLINDRICAL_SURFACE bore
  // and can apply its own thread feature in post.
  //
  // Hole diameter follows the M-spec from the DB's `G` field (e.g. "M6"
  // for UC205); fallback is M6 if the field is missing or unparseable.
  const tapNominal = parseTapSize(req.dimensions['G']) ?? SET_SCREW_DEFAULT_NOMINAL;
  const tapAxialPos = halfB * SET_SCREW_AXIAL_RATIO;
  const innerRing = drillSetScrews(
    oc,
    innerRingRaw,
    tapNominal,
    tapAxialPos,
    innerR,
    shoulderH_Inner,
  );

  // ── 3. Outer ring profile (CCW, 6 edges, with SPHERICAL OD) ──
  //
  // Profile starts at the top-right OD endpoint just before the
  // spherical arc, walks CCW through the OD sphere section, down the
  // left wall, along the raceway-side face with the raceway groove
  // dipping outward (toward larger radial = into outer ring metal),
  // and back up the right wall to close. No corner fillets here — the
  // OD is a bulged sphere and the inside-face corners meet at sharp
  // 90° angles in the C++ reference.
  const outerRingFace = makeProfileWireXZ(
    oc,
    [intersect_R, halfC], // top-right OD edge (where sphere meets axial face)
    [
      // 1. SPHERICAL OD arc — short arc bulging outward (apex at
      //    [outerR, 0]) revolved around Z gives the spherical outer
      //    surface UC mounts rely on.
      {
        kind: 'arc',
        to: [intersect_R, -halfC],
        center: [0, 0],
        ccw: false,
      },
      // 2. Left axial face — radial decreasing toward raceway level.
      { kind: 'line', to: [shoulderH_Outer, -halfC] },
      // 3. Left shoulder going axial-rightward toward raceway entry.
      { kind: 'line', to: [shoulderH_Outer, -grooveHalfW] },
      // 4. Raceway groove arc — short arc dipping outward (toward OD
      //    sphere) since centre [pitchR, 0] is at lower radial.
      {
        kind: 'arc',
        to: [shoulderH_Outer, grooveHalfW],
        center: [pitchR, 0],
        ccw: false,
      },
      // 5. Right shoulder going axial-rightward.
      { kind: 'line', to: [shoulderH_Outer, halfC] },
      // 6. Right axial face going up to OD edge (closes loop).
      { kind: 'line', to: [intersect_R, halfC] },
    ] satisfies ProfileSegment[],
  );
  const outerRing = makeRevolZ(oc, outerRingFace);

  // ── 4. Balls — one row of N spheres at PCD ──
  const masterBall = makeSphere(oc, [pitchR, 0, 0], ballR);
  const ballCount = computeBallCount(req, pitchR, ballDia);
  const balls: unknown[] = [];
  for (let i = 0; i < ballCount; i++) {
    const angle = (2 * Math.PI * i) / ballCount;
    balls.push(rotateShapeAroundZ(oc, masterBall, angle, /* share */ false));
  }

  // ── 5. Seals — two annular rings closing the gap between the inner-
  //       ring shoulder and the outer-ring shoulder at axial = ±halfC.
  //
  // Real UC bearings have rubber or sheet-metal seals (the black rings
  // visible in catalog photos) that hide the rolling elements and keep
  // contaminants out. Without them the imported STEP shows the balls
  // through the open gap — the user's specific feedback. We add them
  // as plain annular disks that occupy the axial-face gap on each side.
  // Material is the same metal as the rings (STEP carries no material
  // info), so visually the seal is just a closing wall — but the balls
  // are no longer visible from the front, matching catalog appearance.
  const sealInnerR = shoulderH_Inner + SEAL_RADIAL_CLEARANCE;
  const sealOuterR = shoulderH_Outer - SEAL_RADIAL_CLEARANCE;
  if (sealInnerR < sealOuterR) {
    const seal_R = buildAnnularSeal(oc, sealInnerR, sealOuterR, halfC, /* outerSide */ true);
    const seal_L = buildAnnularSeal(oc, sealInnerR, sealOuterR, halfC, /* outerSide */ false);
    balls.push(seal_R, seal_L);
  }

  return {
    innerRing,
    outerRing,
    rollingBodies: balls,
    metadata: { outerR, pitchR, halfC },
  };
}

export async function buildUcbStepViaOcct(
  req: CadGenerateRequest,
  dims: BearingDims,
): Promise<CadGenerateResult> {
  const started = Date.now();
  const oc = await getOcct();
  const shapes = await buildUcbBodyShapes(oc, req, dims);

  const bearing = mergeShapesIntoMultibodySolid(oc, [
    shapes.innerRing,
    shapes.outerRing,
    ...shapes.rollingBodies,
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

/**
 * Parse a thread spec like "M6", "M5", "M8x1.0" into the M-nominal
 * diameter (6, 5, 8). Returns undefined if the input doesn't look like
 * an M-thread label.
 */
function parseTapSize(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const m = value.trim().match(/^M\s*(\d+(?:\.\d+)?)/i);
  if (!m) return undefined;
  const n = parseFloat(m[1]);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * Drill two set-screw holes through the inner ring's hub at 120° apart,
 * each with a shallow counterbore at the entrance for a "tap seat" look.
 *
 * Each screw cuts TWO concentric cylinders combined into one drill
 * shape:
 *   1. Counterbore — radius `tapNominal/2 + COUNTERBORE_OVERSIZE`,
 *      axial-radial extent `COUNTERBORE_DEPTH` from the hub's outer
 *      surface inward. Mimics the small lip you'd machine to give a
 *      hex-key set screw a flat seat.
 *   2. Main bore — `tapNominal/2` radius, runs from the bottom of the
 *      counterbore all the way through to the bore wall.
 *
 * Both cylinders are unioned into one drill solid via boolean fuse,
 * then subtracted from the inner ring; this keeps the cut clean (one
 * boolean per screw rather than two) and avoids OCCT's known
 * "subsequent-boolean-fails-on-cached-shape" failure mode.
 *
 * The 120° spacing matches the standard set-screw convention on most
 * UC catalog bearings (NSK, NTN, KOYO); some manufacturers use 90° or
 * 180° but 120° is the JIS / ISO default for our DB's catalog rows.
 */
function drillSetScrews(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  oc: any,
  innerRing: unknown,
  tapNominal: number,
  axialPos: number,
  innerR: number,
  shoulderR: number,
): unknown {
  const drill = buildSetScrewDrill(oc, tapNominal, axialPos, innerR, shoulderR);

  // First screw at angle 0 (along +X).
  let result = boolCut(oc, innerRing, drill);

  // Second screw at 120° around Z.
  const drill2 = rotateShapeAroundZ(oc, drill, SET_SCREW_ANGULAR_SPACING, /* share */ false);
  result = boolCut(oc, result, drill2);

  return result;
}

/**
 * Build one set-screw drill (counterbore + main bore), oriented along
 * +X axis, positioned at axial = `axialPos`. The result is a single
 * fused TopoDS_Solid ready to be subtracted from the inner ring.
 */
function buildSetScrewDrill(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  oc: any,
  tapNominal: number,
  axialPos: number,
  innerR: number,
  shoulderR: number,
): unknown {
  // Main bore — full hub thickness plus 1 mm overshoot on each end so
  // the boolean cut leaves a clean through-hole exiting at the bore.
  const mainStart = innerR - 1;
  const mainEnd = shoulderR + 1;
  const mainBore = buildRadialCylinder(oc, tapNominal / 2, mainStart, mainEnd, axialPos);

  // Counterbore — wider radius, only at the OUTER end of the hole.
  // Sits from `shoulderR − COUNTERBORE_DEPTH` to `shoulderR + 1`.
  const cbR = tapNominal / 2 + SET_SCREW_COUNTERBORE_OVERSIZE;
  const cbStart = shoulderR - SET_SCREW_COUNTERBORE_DEPTH;
  const cbEnd = shoulderR + 1; // same overshoot as main bore
  const counterbore = buildRadialCylinder(oc, cbR, cbStart, cbEnd, axialPos);

  // OCCT BRepAlgoAPI_Fuse on disjoint+overlapping cylinders gives one
  // connected solid (counterbore overlaps main bore radially in
  // [shoulderR − DEPTH, shoulderR + 1]), so the fuse is valid.
  return boolFuseLocal(oc, mainBore, counterbore);
}

/**
 * Build a cylinder whose axis lies along +X at Y=0, Z=axialPos,
 * extending radially from `startR` to `endR`. Used by both set-screw
 * bores and (potentially) other radial features.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildRadialCylinder(oc: any, radius: number, startR: number, endR: number, axialPos: number): unknown {
  const length = endR - startR;
  const cylZ = makeCylinder(oc, radius, length);
  const cylX = rotateShapeAroundY(oc, cylZ, Math.PI / 2);
  return translateShape(oc, cylX, startR, 0, axialPos);
}

/**
 * Boolean fuse — local wrapper around OCCT's BRepAlgoAPI_Fuse. The
 * `core/occt.ts` `boolFuse` helper exists but lives in the shared
 * module; defining a thin local copy here keeps the UC generator's
 * dependencies obvious and avoids a circular-import risk if other
 * generators later need their own boolean ops.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function boolFuseLocal(oc: any, a: unknown, b: unknown): unknown {
  const FuseCtor = oc.BRepAlgoAPI_Fuse_3;
  if (!FuseCtor) throw new Error('OCCT BRepAlgoAPI_Fuse_3 not available');
  const op = new FuseCtor(a, b);
  op.Build?.();
  if (op.IsDone && !op.IsDone()) {
    throw new Error('UCB set-screw fuse: BRepAlgoAPI_Fuse.IsDone()=false');
  }
  return op.Shape();
}

/**
 * Build a thin annular seal at axial = ±halfC, covering radially from
 * `innerR` to `outerR`, thickness `SEAL_THICKNESS` mm. The seal sits
 * INSIDE the bearing's outer ring (axially toward the centre by the
 * thickness amount), so its outer face is flush with the outer ring's
 * end at ±halfC. `outerSide=true` builds the +halfC side seal; false
 * builds the -halfC side. Each seal is a separate solid revolved from
 * a 4-line rectangular profile in the XZ plane.
 */
function buildAnnularSeal(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  oc: any,
  innerR: number,
  outerR: number,
  halfC: number,
  outerSide: boolean,
): unknown {
  const axialFar = outerSide ? halfC : -halfC;
  const axialNear = outerSide ? halfC - SEAL_THICKNESS : -halfC + SEAL_THICKNESS;
  // CCW boundary in [radial, axial] — start at the far-axial OD corner
  // and walk so metal interior stays on the left throughout.
  const wire = makeProfileWireXZ(
    oc,
    [outerR, axialFar],
    [
      // 1. Far-axial face — radial- (outer to inner) at axial = axialFar.
      { kind: 'line', to: [innerR, axialFar] },
      // 2. ID wall — axial from far to near (toward bearing centre).
      { kind: 'line', to: [innerR, axialNear] },
      // 3. Near-axial face — radial+ (inner to outer) at axial = axialNear.
      { kind: 'line', to: [outerR, axialNear] },
      // 4. OD wall — axial back to far (closes the loop).
      { kind: 'line', to: [outerR, axialFar] },
    ] satisfies ProfileSegment[],
  );
  return makeRevolZ(oc, wire);
}

/**
 * Rotate `shape` by `angleRad` radians around the Y-axis at the world
 * origin. Used internally to swing a Z-axis cylinder onto the X-axis
 * for radial drilling. Always deep-copies (no BRep sharing) — the
 * rotated cylinder is then a fresh shape ready for boolean ops.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rotateShapeAroundY(oc: any, shape: unknown, angleRad: number): unknown {
  const origin = new oc.gp_Pnt_3(0, 0, 0);
  const ydir = new oc.gp_Dir_4(0, 1, 0);
  const ax1 = new oc.gp_Ax1_2(origin, ydir);
  const trsf = new oc.gp_Trsf_1();
  trsf.SetRotation_1(ax1, angleRad);
  return new oc.BRepBuilderAPI_Transform_2(shape, trsf, true).Shape();
}
