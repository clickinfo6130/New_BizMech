/**
 * OCCT-backed STEP generator for cylindrical roller bearings (SCRB,
 * later DCRB / PSCRB / PDCRB / TCRB).
 *
 * Faithful port of `BearingCreator::CreateCylindricalRollerBearing`
 * (`C++Source/NewCreateBearingClass.cpp` line 1960–2164). Like the
 * DGBB generator this writes ONE multi-body single-part STEP — inner
 * ring + outer ring + N cylindrical rollers, all welded into a single
 * `TopoDS_Solid` via `mergeShapesIntoMultibodySolid` and post-processed
 * into N sibling `MANIFOLD_SOLID_BREP`s so Inventor opens it as a
 * locked multi-body `.ipt`.
 *
 * Geometry (matches C++ CreateCylindricalRollerBearing, no test-override)
 * ───────────────────────────────────────────────────────────────────
 *   shoulderH_Inner = (d1 + (D2 - d1) / 3) / 2     // inner-ring shoulder
 *   shoulderH_Outer = (D2 - (D2 - d1) / 3) / 2     // outer-ring shoulder
 *   pitchR          = (d1 + D2) / 4
 *   RD              = catalog Dw if present, else (D2 - d1) × 0.22
 *   RW              = B × 0.7                       // roller width
 *   grooveR         = RD × 0.5                      // raceway groove radius
 *   numRollers      = catalog Z if present, else
 *                     ⌊π · pcd / (RD × 1.45)⌋        // C++ gapFactor
 *
 * Coordinate convention
 * ─────────────────────
 *   · Z = bearing axis (axis of revolution)
 *   · Profiles in the XZ plane (Y=0): X = radial, Z = axial
 *   · CCW boundary (interior on the LEFT walking the loop) — same
 *     convention as the DGBB generator
 *
 * NOTE on the C++ test override
 * ─────────────────────────────
 * Line 1974 of the C++ source unconditionally overwrites val_d / val_D /
 * val_B / val_r / val_r1 with the literal 6202 dimensions (15 / 35 / 11
 * / 0.6 / 0.3) — that's leftover test code that makes the C++ tool
 * draw a 6202-shaped CRB regardless of the requested catalog row. We
 * skip it; the imported STEP must reflect the catalog row exactly.
 */
import type { CadGenerateRequest, CadGenerateResult } from '../../types.js';
import { FORMAT_EXT, FORMAT_MIME } from '../../types.js';
import {
  exportStepBytes,
  flattenBrepWithVoidsToManifolds,
  getOcct,
  makeProfileWireXZ,
  makeRevolZ,
  makeCylinder,
  mergeShapesIntoMultibodySolid,
  rotateShapeAroundZ,
  translateShape,
  type ProfileSegment,
} from '../../core/occt.js';
import { bomFileName } from '../../core/bom-meta.js';
import type { BearingDims } from './dimensions.js';

export async function buildScrbStepViaOcct(
  req: CadGenerateRequest,
  dims: BearingDims,
): Promise<CadGenerateResult> {
  const started = Date.now();
  const oc = await getOcct();

  // ── 1. Geometry constants ──
  const halfB = dims.B / 2;
  const r = dims.r;
  const r1 = dims.r1;

  // Catalog Dw (roller diameter) takes precedence over the empirical
  // estimate when the DB row carries it. dm (PCD) is similarly preferred
  // — most catalog rows for SCRB include both since they govern load
  // ratings the user expects to read off the imported part.
  const dwCatalog = readPositiveNumber(req, 'Dw');
  const dmCatalog = readPositiveNumber(req, 'dm');
  const RD = dwCatalog ?? (dims.D2 - dims.d1) * 0.22;
  const pitchR = (dmCatalog ?? (dims.d1 + dims.D2) / 2) / 2;
  const RW = dims.B * 0.7;

  const shoulderH_Inner = (dims.d1 + (dims.D2 - dims.d1) / 3) / 2;
  const shoulderH_Outer = (dims.D2 - (dims.D2 - dims.d1) / 3) / 2;
  const grooveR = RD * 0.5;

  // grooveHalfW: axial half-width where the raceway arc meets the
  // shoulder line (the chord-end on either side of the arc). Pythagoras
  // on the right triangle (grooveR, pitchR-shoulderH, grooveHalfW).
  const grooveHalfW = Math.sqrt(
    Math.max(0, grooveR * grooveR - (pitchR - shoulderH_Inner) * (pitchR - shoulderH_Inner)),
  );

  if (
    shoulderH_Inner <= dims.d1 / 2 + r ||
    shoulderH_Outer >= dims.D2 / 2 - r1 ||
    grooveHalfW > halfB - r1
  ) {
    throw new Error(
      `SCRB ${req.partCode}: degenerate raceway geometry — ` +
        `d1=${dims.d1} D2=${dims.D2} B=${dims.B} r=${r} r1=${r1} RD=${RD.toFixed(3)}. ` +
        `pitchR=${pitchR.toFixed(3)} grooveR=${grooveR.toFixed(3)} ` +
        `shoulderH_Inner=${shoulderH_Inner.toFixed(3)} ` +
        `grooveHalfW=${grooveHalfW.toFixed(3)} — check the partdimension row.`,
    );
  }

  // ── 2. Inner ring profile ──
  const innerRingFace = makeProfileWireXZ(
    oc,
    [shoulderH_Inner, halfB], // top-right shoulder corner
    buildInnerRingProfileSegments({
      innerR: dims.d1 / 2,
      shoulderH_Inner,
      halfB,
      r,
      r1,
      pitchR,
      grooveHalfW,
    }),
  );
  const innerRing = makeRevolZ(oc, innerRingFace);

  // ── 3. Outer ring profile ──
  // Start at the top-right OD corner just before the right fillet
  // (i.e. on the OD face, axially `r1` away from the +halfB end).
  const outerRingFace = makeProfileWireXZ(
    oc,
    [dims.D2 / 2, halfB - r1],
    buildOuterRingProfileSegments({
      outerR: dims.D2 / 2,
      shoulderH_Outer,
      halfB,
      r,
      r1,
      pitchR,
      grooveHalfW,
    }),
  );
  const outerRing = makeRevolZ(oc, outerRingFace);

  // ── 4. Rolling cylinders — master roller + circular pattern ──
  // Master roller is a Z-axis cylinder oriented to lie HORIZONTALLY
  // (radial axis). C++ makes a rectangular profile in the YZ plane and
  // revolves it around its own midline; we match the topology by
  // building a Z-axis cylinder and rotating it so its axis lies along
  // +X at radial=pitchR. The roller's axis is in the bearing's radial
  // direction (the rolling axis).
  //
  // Geometry: cylinder of radius=RD/2, height=RW, with its axis on the
  // X-axis at radial=pitchR. To build via makeCylinder (which makes a
  // Z-axis cylinder), we start with a cylinder centered at the origin
  // along Z, rotate it 90° around Y (so its axis is X), then translate
  // to the bearing axis.
  const masterRollerZ = makeCylinder(oc, RD / 2, RW);
  // makeCylinder centers the BASE at origin, axis along +Z. We need to:
  //   1. Translate so the cylinder is centered (move down by RW/2)
  //   2. Rotate so it lies along X (rotate around Y by 90°)
  //   3. Translate to bearing pitch radius (move +X by pitchR)
  // We can simplify: build the cylinder centered first, then transform.
  const rollerCentered = translateShape(oc, masterRollerZ, 0, 0, -RW / 2);
  // Rotate 90° around Y: makes Z-axis cylinder lie along X
  const rollerXAxis = rotateShapeAroundY(oc, rollerCentered, Math.PI / 2);
  // Position at pitchR radially (was at origin, now move +X by pitchR)
  const masterRoller = translateShape(oc, rollerXAxis, pitchR, 0, 0);

  const rollerCount = computeRollerCount(req, pitchR, RD);
  const rollers: unknown[] = [];
  for (let i = 0; i < rollerCount; i++) {
    const angle = (2 * Math.PI * i) / rollerCount;
    rollers.push(rotateShapeAroundZ(oc, masterRoller, angle, /* share */ false));
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
 * Roller count: prefer the catalog Z (most CRB rows have a documented
 * roller count), fall back to the C++ formula `floor(π·pcd / (RD×1.45))`
 * (line 2138, with `gapFactor = 1.45` = "with cage" — the default since
 * `isFullComplement = false`). Minimum 6 to keep degenerate rows from
 * producing a 1-roller "bearing".
 */
function computeRollerCount(
  req: CadGenerateRequest,
  pitchR: number,
  RD: number,
): number {
  const dbZ = req.dimensions['Z'];
  if (dbZ != null && dbZ !== '') {
    const n = typeof dbZ === 'number' ? dbZ : parseFloat(String(dbZ));
    if (Number.isFinite(n) && n >= 6) return Math.floor(n);
  }
  const GAP_FACTOR = 1.45;
  const pitchDia = pitchR * 2;
  return Math.max(6, Math.floor((Math.PI * pitchDia) / (RD * GAP_FACTOR)));
}

function readPositiveNumber(req: CadGenerateRequest, key: string): number | undefined {
  const v = req.dimensions[key];
  if (v == null || v === '') return undefined;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

// Helper: rotate around the Y-axis (used to swing a Z-axis cylinder
// onto the X-axis). Mirrors `rotateShapeAroundZ` but uses the Y axis
// of revolution and always deep-copies (no sharing — the master
// roller is a one-off transform, not a pattern).
function rotateShapeAroundY(oc: unknown, shape: unknown, angleRad: number): unknown {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ocAny = oc as any;
  const origin = new ocAny.gp_Pnt_3(0, 0, 0);
  const ydir = new ocAny.gp_Dir_4(0, 1, 0);
  const ax1 = new ocAny.gp_Ax1_2(origin, ydir);
  const trsf = new ocAny.gp_Trsf_1();
  trsf.SetRotation_1(ax1, angleRad);
  return new ocAny.BRepBuilderAPI_Transform_2(shape, trsf, true).Shape();
}

// ─────────────────────────────────────────────────────────
// Profile builders — pure data, no OCCT dependency.
// ─────────────────────────────────────────────────────────

interface InnerProfileInput {
  innerR: number;
  shoulderH_Inner: number;
  halfB: number;
  r: number;
  r1: number;
  pitchR: number;
  grooveHalfW: number;
}

interface OuterProfileInput {
  outerR: number;
  shoulderH_Outer: number;
  halfB: number;
  r: number;
  r1: number;
  pitchR: number;
  grooveHalfW: number;
}

/**
 * CCW boundary of the inner ring's cross-section (interior on the left).
 * Starts at the top-right shoulder corner and walks CCW down the right
 * wall, across the bore floor, up the left wall, along the left
 * shoulder, through the raceway groove arc, and back along the right
 * shoulder.
 *
 * Differences from DGBB: asymmetric corner fillets (r right, r1 left
 * from C++ line 1972) and the raceway is a SHALLOWER groove (grooveR =
 * RD/2, vs DGBB's grooveR = ballR × 1.02). Otherwise the topology is
 * the same.
 */
function buildInnerRingProfileSegments(p: InnerProfileInput): ProfileSegment[] {
  const { innerR, shoulderH_Inner, halfB, r, r1, pitchR, grooveHalfW } = p;
  return [
    // 1. Right wall — going down (radial decreasing toward bore).
    { kind: 'line', to: [innerR + r, halfB] },
    // 2. Right-bottom fillet (90° arc).
    {
      kind: 'arc',
      to: [innerR, halfB - r],
      center: [innerR + r, halfB - r],
      ccw: true,
    },
    // 3. Bore floor — going axial-leftward.
    { kind: 'line', to: [innerR, -halfB + r1] },
    // 4. Left-bottom fillet (90° arc, smaller r1).
    {
      kind: 'arc',
      to: [innerR + r1, -halfB],
      center: [innerR + r1, -halfB + r1],
      ccw: true,
    },
    // 5. Left wall — going up (radial increasing toward shoulder).
    { kind: 'line', to: [shoulderH_Inner, -halfB] },
    // 6. Left shoulder — going axial-right toward the raceway entry.
    { kind: 'line', to: [shoulderH_Inner, -grooveHalfW] },
    // 7. Raceway arc — short arc dipping inward (radial decreasing
    //    toward bore) since center is at higher radial. Our profile
    //    builder picks the short arc unconditionally.
    {
      kind: 'arc',
      to: [shoulderH_Inner, grooveHalfW],
      center: [pitchR, 0],
      ccw: false,
    },
    // 8. Right shoulder — closing the loop back to start point.
    { kind: 'line', to: [shoulderH_Inner, halfB] },
  ];
}

/**
 * CCW boundary of the outer ring's cross-section (interior on the left).
 * Starts at the top-right corner just before the right outer fillet,
 * walks CCW across the OD top face, around the left outer fillet, down
 * the left wall, along the left shoulder, through the raceway groove
 * arc dipping outward (toward the OD), back along the right shoulder,
 * up the right wall, and through the right outer fillet to close.
 */
/**
 * Double-row cylindrical roller bearing (DCRB) — port of the
 * dual-row branch in `BearingCreator::CreateCylindricalRollerBearing`
 * (C++ line 2147-2160). The C++'s mirror across the XZ plane is a
 * geometric no-op for rotational solids (mirror across an axis-
 * containing plane is identity), so we instead build TWO complete
 * single-row sub-bearings stacked axially: row 1 occupies axial
 * [-B/2, 0], row 2 occupies [0, +B/2]. The catalog `B` is the TOTAL
 * width — each row gets `B/2`, matching how NN30 / NNU49 series
 * dimensions are documented.
 *
 * Per-row geometry uses the same shoulderH / pitchR / RD / grooveR
 * formulas as SCRB, just with `halfB_row = B/4` instead of `B/2`. The
 * rollers per row use `RW = (B/2) × 0.7 = B × 0.35`.
 */
export async function buildDcrbStepViaOcct(
  req: CadGenerateRequest,
  dims: BearingDims,
): Promise<CadGenerateResult> {
  const started = Date.now();
  const oc = await getOcct();

  // Total catalog B is split between two rows, each spanning B/2.
  const halfB_row = dims.B / 4; // half-width of one row's profile
  const rowSpacing = dims.B / 4; // |axial offset| of each row's center
  const r = dims.r;
  const r1 = dims.r1;
  const innerR = dims.d1 / 2;
  const outerR = dims.D2 / 2;

  const dwCatalog = readPositiveNumber(req, 'Dw');
  const dmCatalog = readPositiveNumber(req, 'dm');
  const RD = dwCatalog ?? (dims.D2 - dims.d1) * 0.22;
  const pitchR = (dmCatalog ?? (dims.d1 + dims.D2) / 2) / 2;
  // Per-row roller width — half of the total B equivalent.
  const RW_row = (dims.B / 2) * 0.7;

  const shoulderH_Inner = (dims.d1 + (dims.D2 - dims.d1) / 3) / 2;
  const shoulderH_Outer = (dims.D2 - (dims.D2 - dims.d1) / 3) / 2;
  const grooveR = RD * 0.5;
  const grooveHalfW = Math.sqrt(
    Math.max(0, grooveR * grooveR - (pitchR - shoulderH_Inner) ** 2),
  );

  if (
    shoulderH_Inner <= innerR + r ||
    shoulderH_Outer >= outerR - r1 ||
    grooveHalfW > halfB_row - r1
  ) {
    throw new Error(
      `DCRB ${req.partCode}: degenerate raceway geometry — ` +
        `d1=${dims.d1} D2=${dims.D2} B=${dims.B} (per-row halfB=${halfB_row.toFixed(3)}). ` +
        `Either RD too large for the per-row width or B too small for two rows.`,
    );
  }

  const buildRow = (axialOffset: number): unknown[] => {
    // Inner ring — centered at axial=0 in the profile, then translated.
    const innerRingFace = makeProfileWireXZ(
      oc,
      [shoulderH_Inner, halfB_row],
      buildInnerRingProfileSegments({
        innerR,
        shoulderH_Inner,
        halfB: halfB_row,
        r,
        r1,
        pitchR,
        grooveHalfW,
      }),
    );
    const innerRingZero = makeRevolZ(oc, innerRingFace);
    const innerRing = translateShape(oc, innerRingZero, 0, 0, axialOffset);

    const outerRingFace = makeProfileWireXZ(
      oc,
      [outerR, halfB_row - r1],
      buildOuterRingProfileSegments({
        outerR,
        shoulderH_Outer,
        halfB: halfB_row,
        r,
        r1,
        pitchR,
        grooveHalfW,
      }),
    );
    const outerRingZero = makeRevolZ(oc, outerRingFace);
    const outerRing = translateShape(oc, outerRingZero, 0, 0, axialOffset);

    // Rollers — same construction as SCRB. Roller axis is +X at radial =
    // pitchR, centered axially at 0 (row's local centre). After building
    // the master roller, translate to the row's axial offset.
    const masterRollerZ = makeCylinder(oc, RD / 2, RW_row);
    const rollerCentered = translateShape(oc, masterRollerZ, 0, 0, -RW_row / 2);
    const rollerXAxis = rotateShapeAroundY(oc, rollerCentered, Math.PI / 2);
    const rollerAtZero = translateShape(oc, rollerXAxis, pitchR, 0, 0);
    const rollerAtOffset = translateShape(oc, rollerAtZero, 0, 0, axialOffset);

    const rollerCount = computeRollerCount(req, pitchR, RD);
    const rollers: unknown[] = [];
    for (let i = 0; i < rollerCount; i++) {
      const angle = (2 * Math.PI * i) / rollerCount;
      rollers.push(rotateShapeAroundZ(oc, rollerAtOffset, angle, /* share */ false));
    }

    return [innerRing, outerRing, ...rollers];
  };

  const row1 = buildRow(-rowSpacing);
  const row2 = buildRow(+rowSpacing);
  const bearing = mergeShapesIntoMultibodySolid(oc, [...row1, ...row2]);

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

function buildOuterRingProfileSegments(p: OuterProfileInput): ProfileSegment[] {
  const { outerR, shoulderH_Outer, halfB, r, r1, pitchR, grooveHalfW } = p;
  // Start point (set in caller): [outerR, halfB - r1] — on the OD face,
  // just inboard of the right-top fillet. Segments traverse CCW back
  // to start.
  return [
    // 1. OD top face — going axial-leftward at radial = outerR (top of
    //    the outer ring, between the two corner fillets).
    { kind: 'line', to: [outerR, -halfB + r] },
    // 2. Left-top fillet (uses `r`, the larger fillet — C++ convention).
    {
      kind: 'arc',
      to: [outerR - r, -halfB],
      center: [outerR - r, -halfB + r],
      ccw: true,
    },
    // 3. Left wall — radial decreasing toward shoulder, axial = -halfB.
    { kind: 'line', to: [shoulderH_Outer, -halfB] },
    // 4. Left shoulder — going axial-right toward the raceway entry.
    { kind: 'line', to: [shoulderH_Outer, -grooveHalfW] },
    // 5. Raceway arc — short arc dipping OUTWARD (toward OD) since
    //    center [pitchR, 0] is at lower radial than the shoulder.
    //    Asymmetric C++ point oP4 (line 2067-2068) is intentionally
    //    NOT replicated here — the contact-angle math is leftover from
    //    the taper-roller code path and produces a non-circular
    //    raceway for cylindrical bearings. We use the symmetric
    //    chord-on-circle endpoint instead.
    {
      kind: 'arc',
      to: [shoulderH_Outer, grooveHalfW],
      center: [pitchR, 0],
      ccw: false,
    },
    // 6. Right shoulder — going axial-rightward toward the right wall.
    { kind: 'line', to: [shoulderH_Outer, halfB] },
    // 7. Right wall — radial increasing toward OD, axial = +halfB.
    { kind: 'line', to: [outerR - r1, halfB] },
    // 8. Right-top fillet (uses `r1`, the smaller fillet) — closes loop
    //    back to start point [outerR, halfB - r1].
    {
      kind: 'arc',
      to: [outerR, halfB - r1],
      center: [outerR - r1, halfB - r1],
      ccw: true,
    },
  ];
}
