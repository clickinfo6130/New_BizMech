/**
 * OCCT-backed STEP generator for taper roller bearings (STRB; DTRB
 * follows in Phase 2b). Faithful port of the TaperRoller-equivalent
 * geometry from `BearingCreator::CreateCylindricalRollerBearing` with
 * `boreType = Taper` (NewCreateBearingClass.cpp line 2115-2127 for the
 * roller profile, plus the taper-aware ring profiles); the standalone
 * `CreateTaperRollerBearing` (line 2166) is a 2-cone fallback used
 * by the dispatcher and intentionally omits the rolling elements —
 * we render the proper 3-component bearing (Cone + Cup + N rollers)
 * since users pull the imported STEP for measurement.
 *
 * Geometry overview
 * ─────────────────
 *   contactAngle = `a_2` from DB (degrees) → radians, fallback 15°
 *   pitchR        = catalog dm/2 if present, else (d1 + D2) / 4
 *   RD            = catalog Dw   if present, else (D2 - d1) × 0.18    // C++ taper
 *   RW            = B × 0.75                                          // C++ taper
 *   numRollers    = catalog Z   if present, else
 *                   ⌊π·pcd / (RD × 1.45)⌋
 *   taperOffset_inner = halfB × tan(α)         // raceway radial rise per half-width
 *   innerOR_front     = innerR + (outerR - innerR) × 0.35
 *   innerOR_back      = innerOR_front + taperOffset
 *   outerIR_front     = innerR + (outerR - innerR) × 0.65
 *   outerIR_back      = outerIR_front + taperOffset
 *
 * Coordinate convention — same as DGBB / SCRB:
 *   · Z = bearing axis (axis of revolution)
 *   · Profiles in XZ plane (Y=0): X = radial, Z = axial
 *   · CCW boundaries with metal interior on the LEFT
 *
 * Roller: a quadrilateral profile (4 points: small-end-axis, small-end-
 * outer, large-end-outer, large-end-axis) revolved around the line from
 * large-end-axis to small-end-axis. Both end-edge offsets are perpendi-
 * cular to the bearing axial direction (not to the roller's tilted
 * axis); this matches the C++ `(sin α, cos α)` offset convention and
 * produces a slightly-irregular truncated cone that's visually correct
 * and dimensionally stable for measurement.
 *
 * NOTE: the C++ source has a hardcoded test override on line 1974
 * (val_d=15, val_D=35, val_B=11, val_r=0.6, val_r1=0.3) that overwrites
 * any catalog row — we deliberately do NOT replicate it; the imported
 * STEP must reflect the actual partdimension entry.
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

const DEFAULT_CONTACT_ANGLE_DEG = 15;
const C_PLUS_PLUS_TAPER_RD_RATIO = 0.18;
const C_PLUS_PLUS_TAPER_RW_RATIO = 0.75;
const ROLLER_GAP_FACTOR = 1.45;

export async function buildStrbStepViaOcct(
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

  const contactAngleDeg = readPositiveNumber(req, 'a_2') ?? DEFAULT_CONTACT_ANGLE_DEG;
  const contactAngle = (contactAngleDeg * Math.PI) / 180;

  const dwCatalog = readPositiveNumber(req, 'Dw');
  const dmCatalog = readPositiveNumber(req, 'dm');
  const RD = dwCatalog ?? (dims.D2 - dims.d1) * C_PLUS_PLUS_TAPER_RD_RATIO;
  const pitchR = (dmCatalog ?? (dims.d1 + dims.D2) / 2) / 2;
  const RW = dims.B * C_PLUS_PLUS_TAPER_RW_RATIO;

  // Raceway geometry: linear taper from front (axial=-halfB) to back
  // (axial=+halfB), rising by `halfB × tan α` over each half-width.
  const taperOffset = halfB * Math.tan(contactAngle);
  const innerOR_front = innerR + (outerR - innerR) * 0.35;
  const innerOR_back = innerOR_front + 2 * taperOffset; // total rise over full B
  const outerIR_front = innerR + (outerR - innerR) * 0.65;
  const outerIR_back = outerIR_front + 2 * taperOffset;

  // Sanity check: the conical raceways must leave room for rollers in
  // the gap between rings. Catastrophic catalog-row errors (negative
  // gap, raceway crossing the bore / OD) surface here as a clear
  // message instead of a degenerate solid that confuses Inventor.
  const gapFront = outerIR_front - innerOR_front;
  const gapBack = outerIR_back - innerOR_back;
  if (gapFront <= RD * 0.5 || gapBack <= RD * 0.5) {
    throw new Error(
      `STRB ${req.partCode}: degenerate raceway gap — ` +
        `gapFront=${gapFront.toFixed(3)} gapBack=${gapBack.toFixed(3)} ` +
        `RD=${RD.toFixed(3)} α=${contactAngleDeg}°. Check d1/D2/B/a_2 in partdimension.`,
    );
  }

  // ── 2. Inner ring (cone) profile ──
  // Cross-section in [radial, axial]: bore wall on the small-radial
  // side, tapered raceway on the large-radial side, with corner fillets
  // (r right, r1 left) at the bottom corners only — top is the raceway.
  const innerCone = makeRevolZ(
    oc,
    makeProfileWireXZ(
      oc,
      [innerOR_back, halfB], // top-right shoulder corner
      [
        // 1. Right wall — radial decreasing toward bore at axial=halfB.
        { kind: 'line', to: [innerR + r, halfB] },
        // 2. Right-bottom fillet (90° arc).
        {
          kind: 'arc',
          to: [innerR, halfB - r],
          center: [innerR + r, halfB - r],
          ccw: true,
        },
        // 3. Bore floor — axial decreasing at radial=innerR.
        { kind: 'line', to: [innerR, -halfB + r1] },
        // 4. Left-bottom fillet (90° arc, smaller r1).
        {
          kind: 'arc',
          to: [innerR + r1, -halfB],
          center: [innerR + r1, -halfB + r1],
          ccw: true,
        },
        // 5. Left wall — radial increasing toward shoulder.
        { kind: 'line', to: [innerOR_front, -halfB] },
        // 6. Tapered raceway — line from front-shoulder to back-shoulder,
        //    radial increasing as axial increases (slope = tan α).
        { kind: 'line', to: [innerOR_back, halfB] },
      ] satisfies ProfileSegment[],
    ),
  );

  // ── 3. Outer ring (cup) profile ──
  // Front side (axial=-halfB) has the smaller inner-raceway radius;
  // back side has the larger. The cup may use width C (different from
  // B). We center axially at z=0 like the cone for now — true axial
  // offset between cone and cup happens via partdimension's T-vs-B-vs-C
  // relationship in a later pass; a first cut keeps both centered.
  const cupWidthRaw = readPositiveNumber(req, 'C');
  const cupHalf = (cupWidthRaw ?? dims.B) / 2;
  const outerCup = makeRevolZ(
    oc,
    makeProfileWireXZ(
      oc,
      [outerR, cupHalf - r1], // top-right OD corner just before fillet
      [
        // 1. OD top face — radial=outerR, axial decreasing.
        { kind: 'line', to: [outerR, -cupHalf + r] },
        // 2. Left-top fillet.
        {
          kind: 'arc',
          to: [outerR - r, -cupHalf],
          center: [outerR - r, -cupHalf + r],
          ccw: true,
        },
        // 3. Left wall — radial decreasing toward raceway.
        { kind: 'line', to: [outerIR_front, -cupHalf] },
        // 4. Tapered raceway — line from front to back, radial increasing.
        { kind: 'line', to: [outerIR_back, cupHalf] },
        // 5. Right wall — radial increasing back to OD.
        { kind: 'line', to: [outerR - r1, cupHalf] },
        // 6. Right-top fillet — closes the loop.
        {
          kind: 'arc',
          to: [outerR, cupHalf - r1],
          center: [outerR - r1, cupHalf - r1],
          ccw: true,
        },
      ] satisfies ProfileSegment[],
    ),
  );

  // ── 4. Rollers (truncated cones) — master + circular pattern ──
  // The roller profile is a quadrilateral pR0 → p1 → p2 → pR3 in the
  // XZ plane:
  //   pR0 = small-end CENTER (on the roller's tilted axis)
  //   p1  = small-end OUTER perimeter point (offset by RD/2 in (sin α,
  //          cos α) direction)
  //   p2  = large-end OUTER perimeter point (same offset from pR3)
  //   pR3 = large-end CENTER (on axis)
  // The wire must close, so we add an implicit edge pR3 → pR0 (which
  // is the revolution axis itself; the closed profile is a degenerate
  // sliver with the axis as one side, which is the OCCT-standard way
  // to revolve a planar profile around a coplanar axis).
  const rollerCount = computeRollerCount(req, pitchR, RD);

  // C++ axial midpoints for small/large ends (line 2117-2120):
  //   small end at axial = -B × 0.2  (closer to z=0, i.e. front side)
  //   large end at axial = -B × 0.8  (closer to -halfB)
  const pR0_axial = -dims.B * 0.2;
  const pR0_radial = pitchR - RD * 0.4;
  const pR3_axial = -dims.B * 0.8;
  const pR3_radial = pitchR + RD * 0.4;
  const offsetA = (RD / 2) * Math.sin(contactAngle);
  const offsetR = (RD / 2) * Math.cos(contactAngle);
  const p1_axial = pR0_axial + offsetA;
  const p1_radial = pR0_radial + offsetR;
  const p2_axial = pR3_axial + offsetA;
  const p2_radial = pR3_radial + offsetR;

  const rollerProfileWire = makeProfileWireXZ(
    oc,
    [pR0_radial, pR0_axial], // start at small-end-axis
    [
      // pR0 → p1: small-end face (perpendicular-ish to roller axis)
      { kind: 'line', to: [p1_radial, p1_axial] },
      // p1 → p2: roller's outer cone surface
      { kind: 'line', to: [p2_radial, p2_axial] },
      // p2 → pR3: large-end face
      { kind: 'line', to: [pR3_radial, pR3_axial] },
      // pR3 → pR0: closing edge (the revolution axis itself)
      { kind: 'line', to: [pR0_radial, pR0_axial] },
    ] satisfies ProfileSegment[],
  );
  // Revolution axis: line from pR0_3D to pR3_3D in world space.
  // Profile is in the XZ plane (Y=0); axis lies in the same plane.
  const axisDirX = pR3_radial - pR0_radial;
  const axisDirZ = pR3_axial - pR0_axial;
  const axisLen = Math.hypot(axisDirX, axisDirZ);
  const masterRoller = makeRevolAroundAxis(
    oc,
    rollerProfileWire,
    [pR0_radial, 0, pR0_axial],
    [axisDirX / axisLen, 0, axisDirZ / axisLen],
  );

  const rollers: unknown[] = [];
  for (let i = 0; i < rollerCount; i++) {
    const angle = (2 * Math.PI * i) / rollerCount;
    rollers.push(rotateShapeAroundZ(oc, masterRoller, angle, /* share */ false));
  }

  // ── 5. Merge into a single multi-body solid + STEP export ──
  const bearing = mergeShapesIntoMultibodySolid(oc, [innerCone, outerCup, ...rollers]);

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
  const pitchDia = pitchR * 2;
  return Math.max(6, Math.floor((Math.PI * pitchDia) / (RD * ROLLER_GAP_FACTOR)));
}

/**
 * Double-row taper roller bearing (DTRB) — port of the dual-row branch
 * in `BearingCreator::CreateCylindricalRollerBearing` at line 2155-2160
 * (the `boreType == Taper` arm). C++ uses a `CreateRectangularPattern`
 * by axial distance B to clone the original bearing, but its profile
 * already spans B, so the C++ output ends up 2 × B wide. Catalog DTRB
 * documents the TOTAL width as B, so we deviate: each row spans B/2,
 * offset by ±B/4 axially. Total axial extent = catalog B.
 *
 * Tandem (DT) orientation
 * ────────────────────────
 * The C++ rectangular-pattern doesn't mirror — both cones taper in the
 * same axial direction. We match that, producing a tandem (DT-style)
 * arrangement rather than back-to-back (DB) or face-to-face (DF). The
 * dual-row mode is read from the partspec's `DualRow` column in C++
 * (`SetDualRowType`); we don't differentiate yet — DTRB partCode
 * defaults to tandem until a future `DualRow` axis is exposed.
 */
export async function buildDtrbStepViaOcct(
  req: CadGenerateRequest,
  dims: BearingDims,
): Promise<CadGenerateResult> {
  const started = Date.now();
  const oc = await getOcct();

  const innerR = dims.d1 / 2;
  const outerR = dims.D2 / 2;
  // Per-row dimensions: each row spans B/2 of the catalog total.
  const halfB_row = dims.B / 4;
  const r = dims.r;
  const r1 = dims.r1;

  const contactAngleDeg = readPositiveNumber(req, 'a_2') ?? DEFAULT_CONTACT_ANGLE_DEG;
  const contactAngle = (contactAngleDeg * Math.PI) / 180;

  const dwCatalog = readPositiveNumber(req, 'Dw');
  const dmCatalog = readPositiveNumber(req, 'dm');
  const RD = dwCatalog ?? (dims.D2 - dims.d1) * C_PLUS_PLUS_TAPER_RD_RATIO;
  const pitchR = (dmCatalog ?? (dims.d1 + dims.D2) / 2) / 2;
  // Per-row roller width — RW scales with per-row width, not total B.
  const rowB = dims.B / 2;
  const RW_row = rowB * C_PLUS_PLUS_TAPER_RW_RATIO;

  const taperOffset = halfB_row * Math.tan(contactAngle);
  const innerOR_front = innerR + (outerR - innerR) * 0.35;
  const innerOR_back = innerOR_front + 2 * taperOffset;
  const outerIR_front = innerR + (outerR - innerR) * 0.65;
  const outerIR_back = outerIR_front + 2 * taperOffset;

  const gapFront = outerIR_front - innerOR_front;
  const gapBack = outerIR_back - innerOR_back;
  if (gapFront <= RD * 0.5 || gapBack <= RD * 0.5) {
    throw new Error(
      `DTRB ${req.partCode}: degenerate raceway gap — ` +
        `gapFront=${gapFront.toFixed(3)} gapBack=${gapBack.toFixed(3)} ` +
        `RD=${RD.toFixed(3)} α=${contactAngleDeg}°. Check d1/D2/B/a_2 in partdimension.`,
    );
  }

  const buildRow = (axialOffset: number): unknown[] => {
    const innerCone = makeRevolZ(
      oc,
      makeProfileWireXZ(
        oc,
        [innerOR_back, halfB_row + axialOffset],
        [
          { kind: 'line', to: [innerR + r, halfB_row + axialOffset] },
          {
            kind: 'arc',
            to: [innerR, halfB_row + axialOffset - r],
            center: [innerR + r, halfB_row + axialOffset - r],
            ccw: true,
          },
          { kind: 'line', to: [innerR, -halfB_row + axialOffset + r1] },
          {
            kind: 'arc',
            to: [innerR + r1, -halfB_row + axialOffset],
            center: [innerR + r1, -halfB_row + axialOffset + r1],
            ccw: true,
          },
          { kind: 'line', to: [innerOR_front, -halfB_row + axialOffset] },
          { kind: 'line', to: [innerOR_back, halfB_row + axialOffset] },
        ] satisfies ProfileSegment[],
      ),
    );

    const cupHalf = halfB_row;
    const outerCup = makeRevolZ(
      oc,
      makeProfileWireXZ(
        oc,
        [outerR, cupHalf + axialOffset - r1],
        [
          { kind: 'line', to: [outerR, -cupHalf + axialOffset + r] },
          {
            kind: 'arc',
            to: [outerR - r, -cupHalf + axialOffset],
            center: [outerR - r, -cupHalf + axialOffset + r],
            ccw: true,
          },
          { kind: 'line', to: [outerIR_front, -cupHalf + axialOffset] },
          { kind: 'line', to: [outerIR_back, cupHalf + axialOffset] },
          { kind: 'line', to: [outerR - r1, cupHalf + axialOffset] },
          {
            kind: 'arc',
            to: [outerR, cupHalf + axialOffset - r1],
            center: [outerR - r1, cupHalf + axialOffset - r1],
            ccw: true,
          },
        ] satisfies ProfileSegment[],
      ),
    );

    // Per-row roller — same construction as STRB but using rowB instead
    // of full B, then translated by axialOffset.
    const pR0_axial = -rowB * 0.2 + axialOffset;
    const pR0_radial = pitchR - RD * 0.4;
    const pR3_axial = -rowB * 0.8 + axialOffset;
    const pR3_radial = pitchR + RD * 0.4;
    const offsetA = (RD / 2) * Math.sin(contactAngle);
    const offsetR = (RD / 2) * Math.cos(contactAngle);
    const p1_axial = pR0_axial + offsetA;
    const p1_radial = pR0_radial + offsetR;
    const p2_axial = pR3_axial + offsetA;
    const p2_radial = pR3_radial + offsetR;

    const rollerProfileWire = makeProfileWireXZ(
      oc,
      [pR0_radial, pR0_axial],
      [
        { kind: 'line', to: [p1_radial, p1_axial] },
        { kind: 'line', to: [p2_radial, p2_axial] },
        { kind: 'line', to: [pR3_radial, pR3_axial] },
        { kind: 'line', to: [pR0_radial, pR0_axial] },
      ] satisfies ProfileSegment[],
    );
    const axisDirX = pR3_radial - pR0_radial;
    const axisDirZ = pR3_axial - pR0_axial;
    const axisLen = Math.hypot(axisDirX, axisDirZ);
    const masterRoller = makeRevolAroundAxis(
      oc,
      rollerProfileWire,
      [pR0_radial, 0, pR0_axial],
      [axisDirX / axisLen, 0, axisDirZ / axisLen],
    );

    // Use RW_row as a sanity reference; rollerCount uses the same formula
    // (independent of RW). Suppress unused-var warning by referencing it
    // for diagnostics.
    void RW_row;

    const rollerCount = computeRollerCount(req, pitchR, RD);
    const rollers: unknown[] = [];
    for (let i = 0; i < rollerCount; i++) {
      const angle = (2 * Math.PI * i) / rollerCount;
      rollers.push(rotateShapeAroundZ(oc, masterRoller, angle, /* share */ false));
    }

    return [innerCone, outerCup, ...rollers];
  };

  // Two rows offset by ±B/4 — total axial extent = catalog B.
  const row1 = buildRow(-dims.B / 4);
  const row2 = buildRow(+dims.B / 4);
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

function readPositiveNumber(req: CadGenerateRequest, key: string): number | undefined {
  const v = req.dimensions[key];
  if (v == null || v === '') return undefined;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}
