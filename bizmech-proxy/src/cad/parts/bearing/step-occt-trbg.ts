/**
 * OCCT-backed STEP generator for thrust roller bearings (TCRB —
 * cylindrical roller variant). Faithful port of the
 * `ThrustRollerType.Cylindrical` branch of `BearingCreator::CreateThrust
 * RollerBearing` (`C++Source/NewCreateBearingClass.cpp` line 3524–3621).
 *
 * Geometry overview
 * ─────────────────
 * A thrust cylindrical roller bearing has TWO flat annular washers
 * (shaft + housing) and a row of N CYLINDRICAL ROLLERS oriented with
 * their axes along the radial direction (perpendicular to the bearing
 * axis). Each roller's axis intersects the bearing's central axis at
 * 90° — that's what makes it a "thrust" bearing (axial-load capable).
 *
 *   pitchR    = (d1 + D2) / 4
 *   Dw        = catalog Dw if present, else min(T × 0.35, (D-d) × 0.15)
 *   Lwe       = catalog Lwe if present, else (D - d) × 0.35
 *   gap       = Dw × 0.2
 *   safe_r    = min(r, T/4, (D-d) × 0.1)
 *   numRollers = ⌊2π · (pitchR - Lwe/2) / (Dw + 0.4 + min_web_1.5)⌋
 *               (C++ line 3530, packs rollers along the INNER pitch
 *                circumference with a cage-web allowance)
 *
 * Skipped from this first cut (cosmetic, can be added later)
 * ──────────────────────────────────────────────────────────
 *   · Cage body + pocket cuts (C++ line 3532-3567) — looks like a
 *     thin-walled annular shell with N rectangular slots cut for the
 *     rollers; visually present in catalog photos but doesn't change
 *     measurable washer / roller dimensions.
 *
 * Coordinate convention — same as the rest of the bearing family.
 */
import type { CadGenerateRequest, CadGenerateResult } from '../../types.js';
import { FORMAT_EXT, FORMAT_MIME } from '../../types.js';
import {
  exportStepBytes,
  flattenBrepWithVoidsToManifolds,
  getOcct,
  makeCylinder,
  makeProfileWireXZ,
  makeRevolAroundAxis,
  makeRevolZ,
  mergeShapesIntoMultibodySolid,
  rotateShapeAroundZ,
  translateShape,
  type ProfileSegment,
} from '../../core/occt.js';
import { bomFileName } from '../../core/bom-meta.js';
import type { BearingDims } from './dimensions.js';

const DW_FROM_T_RATIO = 0.35;
const DW_FROM_GAP_RATIO = 0.15;
const LWE_RATIO = 0.35;
const ROLLER_GAP_RATIO = 0.2;
const POCKET_AXIAL_OVERSIZE = 0.4;
const MIN_CAGE_WEB = 1.5;
const MAX_R_HEIGHT_RATIO = 0.1;
const MAX_R_WIDTH_DIVIDER = 4; // safe_r ≤ T / 4
const CLEARANCE_FROM_GAP_RATIO = 0.05;
const MIN_R = 0.05;
const MAX_CLR = 1.0;

export async function buildTcrbStepViaOcct(
  req: CadGenerateRequest,
  dims: BearingDims,
): Promise<CadGenerateResult> {
  const started = Date.now();
  const oc = await getOcct();

  // ── 1. Geometry constants (line 3398-3411) ──
  const halfT = dims.B / 2; // for TCRB the catalog "B" maps to total height T
  const innerR = dims.d1 / 2;
  const outerR = dims.D2 / 2;
  const pitchR = (dims.d1 + dims.D2) / 4;
  const clr = Math.min(MAX_CLR, (dims.D2 - dims.d1) * CLEARANCE_FROM_GAP_RATIO);

  // Roller diameter / length (formula or catalog).
  const Dw =
    readPositiveNumber(req, 'Dw') ??
    Math.min(dims.B * DW_FROM_T_RATIO, (dims.D2 - dims.d1) * DW_FROM_GAP_RATIO);
  const Lwe = readPositiveNumber(req, 'Lwe') ?? (dims.D2 - dims.d1) * LWE_RATIO;
  const gap = Dw * ROLLER_GAP_RATIO;

  // safe_r — clamp the corner fillet to keep washer profiles sane.
  let safe_r = dims.r;
  const maxR = Math.min(dims.B / MAX_R_WIDTH_DIVIDER, (dims.D2 - dims.d1) * MAX_R_HEIGHT_RATIO);
  if (safe_r > maxR) safe_r = maxR;
  if (safe_r < MIN_R) safe_r = MIN_R;

  if (Lwe / 2 >= pitchR - innerR) {
    throw new Error(
      `TCRB ${req.partCode}: roller half-length ${(Lwe / 2).toFixed(3)} ≥ ` +
        `(pitchR-innerR)=${(pitchR - innerR).toFixed(3)} — roller would extend past the bore. ` +
        `Check d1/D2/B/Lwe in partdimension.`,
    );
  }

  // Washer shoulders: shaft side (left half) and housing side (right half).
  const p_ID_S = innerR;
  const p_OD_S = outerR - clr;
  const p_ID_H = innerR + clr;
  const p_OD_H = outerR;

  // ── 2. Shaft Washer (axial range [-half_T, -gap], 8 edges with 4 corner fillets) ──
  // C++ line 3573-3592. CCW in [radial, axial] starting at top-right
  // (just inside fillet on the OD side).
  const shaftXR = -gap;
  const shaftXL = -halfT;
  const shaftWasherFace = makeProfileWireXZ(
    oc,
    [p_OD_S, shaftXR - safe_r], // pS1
    [
      // 1. Top OD face — axial decreasing.
      { kind: 'line', to: [p_OD_S, shaftXL + safe_r] },
      // 2. Top-LEFT corner fillet.
      {
        kind: 'arc',
        to: [p_OD_S - safe_r, shaftXL],
        center: [p_OD_S - safe_r, shaftXL + safe_r],
        ccw: true,
      },
      // 3. Left wall — radial decreasing toward bore.
      { kind: 'line', to: [p_ID_S + safe_r, shaftXL] },
      // 4. Bottom-LEFT corner fillet.
      {
        kind: 'arc',
        to: [p_ID_S, shaftXL + safe_r],
        center: [p_ID_S + safe_r, shaftXL + safe_r],
        ccw: true,
      },
      // 5. Bottom (bore) face — axial increasing.
      { kind: 'line', to: [p_ID_S, shaftXR - safe_r] },
      // 6. Bottom-RIGHT corner fillet.
      {
        kind: 'arc',
        to: [p_ID_S + safe_r, shaftXR],
        center: [p_ID_S + safe_r, shaftXR - safe_r],
        ccw: true,
      },
      // 7. Right wall — radial increasing back toward OD.
      { kind: 'line', to: [p_OD_S - safe_r, shaftXR] },
      // 8. Top-RIGHT corner fillet — closes loop.
      {
        kind: 'arc',
        to: [p_OD_S, shaftXR - safe_r],
        center: [p_OD_S - safe_r, shaftXR - safe_r],
        ccw: true,
      },
    ] satisfies ProfileSegment[],
  );
  const shaftWasher = makeRevolZ(oc, shaftWasherFace);

  // ── 3. Housing Washer (axial range [+gap, +half_T], same topology) ──
  const housingXL = gap;
  const housingXR = halfT;
  const housingWasherFace = makeProfileWireXZ(
    oc,
    [p_OD_H, housingXR - safe_r],
    [
      { kind: 'line', to: [p_OD_H, housingXL + safe_r] },
      {
        kind: 'arc',
        to: [p_OD_H - safe_r, housingXL],
        center: [p_OD_H - safe_r, housingXL + safe_r],
        ccw: true,
      },
      { kind: 'line', to: [p_ID_H + safe_r, housingXL] },
      {
        kind: 'arc',
        to: [p_ID_H, housingXL + safe_r],
        center: [p_ID_H + safe_r, housingXL + safe_r],
        ccw: true,
      },
      { kind: 'line', to: [p_ID_H, housingXR - safe_r] },
      {
        kind: 'arc',
        to: [p_ID_H + safe_r, housingXR],
        center: [p_ID_H + safe_r, housingXR - safe_r],
        ccw: true,
      },
      { kind: 'line', to: [p_OD_H - safe_r, housingXR] },
      {
        kind: 'arc',
        to: [p_OD_H, housingXR - safe_r],
        center: [p_OD_H - safe_r, housingXR - safe_r],
        ccw: true,
      },
    ] satisfies ProfileSegment[],
  );
  const housingWasher = makeRevolZ(oc, housingWasherFace);

  // ── 4. Rollers — radial cylinders between the washers ──
  // Each roller is a Z-axis cylinder of radius Dw/2 and length Lwe.
  // We rotate it 90° around Y so its axis lies along +X (= bearing
  // RADIAL direction at angle 0), then translate so it spans from
  //   radial = pitchR − Lwe/2  to  radial = pitchR + Lwe/2
  //   axial  = 0  (centred between the two washers)
  //   Y      = 0
  // Pattern around Z gives N rollers around the bearing.
  const rollerCount = computeRollerCount(pitchR, Dw, Lwe);

  const masterRollerZ = makeCylinder(oc, Dw / 2, Lwe);
  // Rotate Z-axis cylinder to X-axis (90° around Y).
  const masterRollerX = rotateShapeAroundY(oc, masterRollerZ, Math.PI / 2);
  // After 90° Y-rotation: cylinder originally from z=0 to z=Lwe along
  // +Z is now from x=0 to x=Lwe along +X (standing on +X face). To
  // place at pitchR centre, translate so it spans pitchR ± Lwe/2.
  const masterRoller = translateShape(oc, masterRollerX, pitchR - Lwe / 2, 0, 0);

  const rollers: unknown[] = [];
  for (let i = 0; i < rollerCount; i++) {
    const angle = (2 * Math.PI * i) / rollerCount;
    rollers.push(rotateShapeAroundZ(oc, masterRoller, angle, /* share */ false));
  }

  // ── 5. Merge into a single multi-body solid + STEP export ──
  const bearing = mergeShapesIntoMultibodySolid(oc, [shaftWasher, housingWasher, ...rollers]);

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
 * Spherical thrust roller bearing (TSARB) — port of the
 * `ThrustRollerType.Spherical` branch of `BearingCreator::Create
 * ThrustRollerBearing` (C++ line 3622-3722).
 *
 * What's a TSARB
 * ──────────────
 * Two flat-ish annular washers (shaft + housing) with a row of
 * BARREL-SHAPED rollers between them. The roller axes tilt outward at
 * a fixed contact angle (50° in the C++ reference) so the assembly
 * accommodates angular misalignment as well as carrying axial load.
 * The barrel-shape (convex-OD, concave-bore profile) lets each roller
 * rock slightly on its raceway, sharing the load across the row even
 * under shaft deflection.
 *
 * Geometry (C++ line 3624-3634)
 * ─────────────────────────────
 *   ang        = 50° (fixed in C++)
 *   X_sph      = -pitchR · tan(ang)            // axial position of sphere centre
 *   R_sph      = pitchR / cos(ang)             // sphere radius from X_sph through pitch circle
 *   Dw, R_r    = same C++ formula as TCRB
 *   R_out, R_in = R_sph ± R_r                  // raceway radii (housing outer, shaft inner)
 *   numRollers = ⌊2π · (pitchR - Lwe·sin(ang)/2) / (Dw + 0.5 + 2.0)⌋
 *
 * Simplifications vs. the C++ reference
 * ─────────────────────────────────────
 * The C++ source builds the SHAFT and HOUSING washers with spherical
 * raceway arcs swept into their facing edges. The arc geometry is
 * sensitive to numerical edge cases (in some catalog rows the sphere
 * intersection lands beyond ±half_T, producing a "pokes-out" washer
 * shape) and would substantially complicate this first cut. We use
 * the same washer dimensions as TCRB (rectangular cross-section with
 * corner fillets) and place the tilted barrel rollers between them.
 * The rollers — the geometric feature that distinguishes TSARB from
 * TCRB — are built with the full barrel profile + correct tilt; that
 * is the "must measure correctly" surface for this bearing kind.
 *
 * Cage / pocket cuts skipped (cosmetic, doesn't affect measurable
 * dimensions).
 */
const SPHERICAL_TILT_DEG = 50; // C++ line 3624
const SPHERICAL_DW_FROM_GAP_RATIO = DW_FROM_GAP_RATIO; // 0.15 — same as TCRB
const SPHERICAL_DW_FROM_T_RATIO = DW_FROM_T_RATIO; // 0.35

export async function buildTsarbStepViaOcct(
  req: CadGenerateRequest,
  dims: BearingDims,
): Promise<CadGenerateResult> {
  const started = Date.now();
  const oc = await getOcct();

  const halfT = dims.B / 2;
  const innerR = dims.d1 / 2;
  const outerR = dims.D2 / 2;
  const pitchR = (dims.d1 + dims.D2) / 4;
  const clr = Math.min(MAX_CLR, (dims.D2 - dims.d1) * CLEARANCE_FROM_GAP_RATIO);

  const Dw =
    readPositiveNumber(req, 'Dw') ??
    Math.min(dims.B * SPHERICAL_DW_FROM_T_RATIO, (dims.D2 - dims.d1) * SPHERICAL_DW_FROM_GAP_RATIO);
  const Lwe = readPositiveNumber(req, 'Lwe') ?? (dims.D2 - dims.d1) * LWE_RATIO;
  const gap = Dw * ROLLER_GAP_RATIO;
  const R_r = Dw / 2;

  let safe_r = dims.r;
  const maxR = Math.min(dims.B / MAX_R_WIDTH_DIVIDER, (dims.D2 - dims.d1) * MAX_R_HEIGHT_RATIO);
  if (safe_r > maxR) safe_r = maxR;
  if (safe_r < MIN_R) safe_r = MIN_R;

  const ang = (SPHERICAL_TILT_DEG * Math.PI) / 180;
  const sinA = Math.sin(ang);
  const cosA = Math.cos(ang);
  const R_sph = pitchR / cosA;

  // Sanity: barrel arc must close (Lwe/2 < R_sph for the barrel apex
  // to exist). C++ silently produces NaN on degenerate rows.
  if (Lwe / 2 >= R_sph) {
    throw new Error(
      `TSARB ${req.partCode}: roller half-length ${(Lwe / 2).toFixed(3)} ≥ R_sph=${R_sph.toFixed(3)} ` +
        `— catalog Lwe is too long relative to pitchR for the C++'s 50° tilt formula.`,
    );
  }

  // ── Shaft washer + housing washer (same rectangular topology as TCRB). ──
  const p_ID_S = innerR;
  const p_OD_S = outerR - clr;
  const p_ID_H = innerR + clr;
  const p_OD_H = outerR;
  const shaftXL = -halfT;
  const shaftXR = -gap;
  const housingXL = gap;
  const housingXR = halfT;

  const shaftWasher = makeRevolZ(
    oc,
    makeProfileWireXZ(
      oc,
      [p_OD_S, shaftXR - safe_r],
      [
        { kind: 'line', to: [p_OD_S, shaftXL + safe_r] },
        { kind: 'arc', to: [p_OD_S - safe_r, shaftXL], center: [p_OD_S - safe_r, shaftXL + safe_r], ccw: true },
        { kind: 'line', to: [p_ID_S + safe_r, shaftXL] },
        { kind: 'arc', to: [p_ID_S, shaftXL + safe_r], center: [p_ID_S + safe_r, shaftXL + safe_r], ccw: true },
        { kind: 'line', to: [p_ID_S, shaftXR - safe_r] },
        { kind: 'arc', to: [p_ID_S + safe_r, shaftXR], center: [p_ID_S + safe_r, shaftXR - safe_r], ccw: true },
        { kind: 'line', to: [p_OD_S - safe_r, shaftXR] },
        { kind: 'arc', to: [p_OD_S, shaftXR - safe_r], center: [p_OD_S - safe_r, shaftXR - safe_r], ccw: true },
      ] satisfies ProfileSegment[],
    ),
  );

  const housingWasher = makeRevolZ(
    oc,
    makeProfileWireXZ(
      oc,
      [p_OD_H, housingXR - safe_r],
      [
        { kind: 'line', to: [p_OD_H, housingXL + safe_r] },
        { kind: 'arc', to: [p_OD_H - safe_r, housingXL], center: [p_OD_H - safe_r, housingXL + safe_r], ccw: true },
        { kind: 'line', to: [p_ID_H + safe_r, housingXL] },
        { kind: 'arc', to: [p_ID_H, housingXL + safe_r], center: [p_ID_H + safe_r, housingXL + safe_r], ccw: true },
        { kind: 'line', to: [p_ID_H, housingXR - safe_r] },
        { kind: 'arc', to: [p_ID_H + safe_r, housingXR], center: [p_ID_H + safe_r, housingXR - safe_r], ccw: true },
        { kind: 'line', to: [p_OD_H - safe_r, housingXR] },
        { kind: 'arc', to: [p_OD_H, housingXR - safe_r], center: [p_OD_H - safe_r, housingXR - safe_r], ccw: true },
      ] satisfies ProfileSegment[],
    ),
  );

  // ── Asymmetric barrel rollers (the distinctive TSARB feature). ──
  // Local roller frame: u along the tilted axis, v perpendicular.
  // World mapping (C++ line 3636-3638):
  //   axial  = -u·cos(ang) + v·sin(ang)
  //   radial = pitchR + u·sin(ang) + v·cos(ang)
  // OCCT XZ profile coords [radial, axial]:
  //   X = pitchR + u·sin(ang) + v·cos(ang)
  //   Z = -u·cos(ang) + v·sin(ang)
  const cv = R_r - R_sph; // C++ line 3704 — barrel arc center offset
  const v_corner = cv + Math.sqrt(R_sph * R_sph - (Lwe / 2) * (Lwe / 2));
  const halfL = Lwe / 2;

  const L2G = (u: number, v: number): [number, number] => [
    pitchR + u * sinA + v * cosA,
    -u * cosA + v * sinA,
  ];

  const L_axis = L2G(-halfL, 0);
  const TL = L2G(-halfL, v_corner);
  const TR = L2G(halfL, v_corner);
  const R_axis = L2G(halfL, 0);
  const arcCenter = L2G(0, cv);

  // The arc spans 2·atan2(halfL, R_sph) which is the barrel's full
  // angular extent — for typical Lwe / R_sph ratios this is well under
  // π so the short-arc helper picks correctly.
  const rollerProfileWire = makeProfileWireXZ(
    oc,
    L_axis,
    [
      { kind: 'line', to: TL }, // L_axis → TL
      { kind: 'arc', to: TR, center: arcCenter, ccw: false }, // barrel arc TL → TR
      { kind: 'line', to: R_axis }, // TR → R_axis
      { kind: 'line', to: L_axis }, // close along axis
    ] satisfies ProfileSegment[],
  );

  // Revolution axis: passes through L_axis_3D, direction = (sinA, 0, -cosA)
  // = world u-axis. Profile is in the XZ plane (Y=0), and the axis is
  // also in the XZ plane, so the axis is coplanar with the wire — the
  // OCCT requirement.
  const masterRoller = makeRevolAroundAxis(
    oc,
    rollerProfileWire,
    [L_axis[0], 0, L_axis[1]],
    [sinA, 0, -cosA],
  );

  // C++ uses pitchR - (Lwe/2)·sin(ang) as the inner-circumference radius
  // for roller-count math (line 3631).
  const innerR_sph = pitchR - (Lwe / 2) * sinA;
  const sph_cut_Z = Dw + 0.5;
  const sph_min_web = 2.0;
  const numRollers = Math.max(
    6,
    Math.floor((2 * Math.PI * innerR_sph) / (sph_cut_Z + sph_min_web)),
  );

  const rollers: unknown[] = [];
  for (let i = 0; i < numRollers; i++) {
    const angle = (2 * Math.PI * i) / numRollers;
    rollers.push(rotateShapeAroundZ(oc, masterRoller, angle, /* share */ false));
  }

  const bearing = mergeShapesIntoMultibodySolid(oc, [shaftWasher, housingWasher, ...rollers]);

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
 * Roller count from C++ line 3530:
 *   numRollers = floor(2π · innerPitchCircumference / (Dw + 0.4 + 1.5))
 * The (Dw + 0.4 + 1.5) accounts for one roller-pocket axial extent
 * plus a cage-web allowance. We honour catalog Z when present so the
 * imported part matches the bearing data sheet count.
 */
function computeRollerCount(pitchR: number, Dw: number, Lwe: number): number {
  const innerR = pitchR - Lwe / 2;
  const pocketWidth = Dw + POCKET_AXIAL_OVERSIZE + MIN_CAGE_WEB;
  return Math.max(6, Math.floor((2 * Math.PI * innerR) / pocketWidth));
}

function readPositiveNumber(req: CadGenerateRequest, key: string): number | undefined {
  const v = req.dimensions[key];
  if (v == null || v === '') return undefined;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * Rotate `shape` around the Y-axis at the world origin. Used to swing
 * a Z-axis cylinder to lie along +X (radial direction) before
 * positioning it at the pitch-radius / radial pattern position. Always
 * deep-copies so subsequent boolean operations don't share BRep state.
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
