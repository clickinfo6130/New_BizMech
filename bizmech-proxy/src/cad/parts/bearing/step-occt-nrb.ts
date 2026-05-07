/**
 * OCCT-backed STEP generator for needle roller bearings (SNRB — solid
 * type with inner ring, no rib variant). Faithful port of the Solid +
 * WithInner + WithoutRib branch of `BearingCreator::CreateNeedleRoller
 * Bearing` (`C++Source/NewCreateBearingClass.cpp` line 2414–2700).
 *
 * Variant coverage
 * ────────────────
 * The C++ reference handles three needleType × two ribType × two
 * innerUseType = 12 distinct profiles. This first cut covers ONLY:
 *   · NeedleType.Solid          (full machined rings, not sheet-metal)
 *   · InnerUseType.WithInner    (separate inner ring, not running on shaft)
 *   · NeedleRibType.WithoutRib  (no axial-guide rib on the outer ring)
 * That's the most common SNRB configuration and the one whose catalog
 * dimensions land cleanly. DrawnCup (SHNRB) and Gauge (CNRB) variants
 * use a different profile topology — they'll come in a separate
 * generator if/when their partCodes show up.
 *
 * Geometry (matches C++ Solid + WithInner + WithoutRib path)
 * ──────────────────────────────────────────────────────────
 *   ringThick     = (D2 - d1) × 0.2
 *   innerTrackR   = d1/2 + ringThick           // raceway radius (inner ring TOP)
 *   oR_inner      = D2/2 - ringThick           // raceway radius (outer ring BOTTOM)
 *   RD            = oR_inner - innerTrackR     // needle diameter
 *   pitchR        = innerTrackR + RD / 2
 *   space_X       = halfB - r - 0.1            // axial room for needle + cage
 *   half_RW       = max(1.0, space_X − 2·gap − max(RD·0.2, 0.4))  // ≈ needle half-length
 *   r_R           = min(RD × 0.15, half_RW × 0.15)  // needle end fillet
 *   rollerCount   = ⌊π · 2·pitchR / (RD × 1.15)⌋    // tight 1.15 spacing
 *
 * Coordinate convention — same as DGBB / SCRB / TRB / SABB / SARB:
 *   · Z = bearing axis (axis of revolution for the rings + circular pattern)
 *   · Profiles in XZ plane (Y=0): X = radial, Z = axial
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

const RING_THICK_RATIO = 0.2; // line 2435
const NEEDLE_GAP_FACTOR = 1.15; // line 2651
const NEEDLE_END_FILLET_RATIO = 0.15; // line 2629

export async function buildSnrbStepViaOcct(
  req: CadGenerateRequest,
  dims: BearingDims,
): Promise<CadGenerateResult> {
  const started = Date.now();
  const oc = await getOcct();

  // ── 1. Geometry constants (line 2434-2467, Solid+WithInner+WithoutRib) ──
  const halfB = dims.B / 2;
  const r = dims.r;
  const ringThick = (dims.D2 - dims.d1) * RING_THICK_RATIO;
  const innerR = dims.d1 / 2;
  const outerR = dims.D2 / 2;
  const innerTrackR = innerR + ringThick;
  const oR_inner = outerR - ringThick;
  const RD = oR_inner - innerTrackR;
  const pitchR = innerTrackR + RD / 2;

  if (RD <= 0) {
    throw new Error(
      `SNRB ${req.partCode}: degenerate needle diameter — ` +
        `oR_inner=${oR_inner.toFixed(3)} ≤ innerTrackR=${innerTrackR.toFixed(3)}. ` +
        `Check d1/D2 in partdimension; the (D-d)·0.2 ringThick formula left no room ` +
        `for needles.`,
    );
  }

  // Solid + WithoutRib axial budget (line 2448 fall-through).
  const space_X = halfB - r - 0.1;
  const gap = 0.05;
  const cage_X_out = space_X - gap;
  const cage_X_in = cage_X_out - Math.max(RD * 0.2, 0.4);
  let half_RW = cage_X_in - gap;
  if (half_RW < 1.0) half_RW = 1.0; // line 2467 clamp

  if (half_RW * 2 >= dims.B) {
    throw new Error(
      `SNRB ${req.partCode}: needle length ${(half_RW * 2).toFixed(3)} ≥ B=${dims.B} — ` +
        `the cage clearance budget collapsed; the row's r=${r}, halfB=${halfB} are too tight.`,
    );
  }

  const r_R = Math.min(RD * NEEDLE_END_FILLET_RATIO, half_RW * NEEDLE_END_FILLET_RATIO);

  // ── 2. Outer ring profile (6 edges, 2 top fillets) ──
  // CCW in [radial, axial], starting at top-right OD just past fillet.
  const outerRingFace = makeProfileWireXZ(
    oc,
    [outerR, halfB - r], // start: top-right OD just before fillet
    [
      // 1. OD top face — axial decreasing.
      { kind: 'line', to: [outerR, -halfB + r] },
      // 2. Top-left fillet (90° arc).
      {
        kind: 'arc',
        to: [outerR - r, -halfB],
        center: [outerR - r, -halfB + r],
        ccw: true,
      },
      // 3. Left wall — radial decreasing toward raceway face.
      { kind: 'line', to: [oR_inner, -halfB] },
      // 4. Raceway face (inside surface) — axial increasing at oR_inner.
      { kind: 'line', to: [oR_inner, halfB] },
      // 5. Right wall — radial increasing back to OD.
      { kind: 'line', to: [outerR - r, halfB] },
      // 6. Top-right fillet — closes loop.
      {
        kind: 'arc',
        to: [outerR, halfB - r],
        center: [outerR - r, halfB - r],
        ccw: true,
      },
    ] satisfies ProfileSegment[],
  );
  const outerRing = makeRevolZ(oc, outerRingFace);

  // ── 3. Inner ring profile (6 edges, 2 top fillets, with bore) ──
  // CCW in [radial, axial]. The "top" of the inner ring is the raceway
  // face at innerTrackR (where the needles ride); the "bottom" is the
  // bore at d1/2.
  const innerRingFace = makeProfileWireXZ(
    oc,
    [innerTrackR, halfB - r], // start: top-right raceway-side just before fillet
    [
      // 1. Raceway-side face — axial decreasing at innerTrackR.
      { kind: 'line', to: [innerTrackR, -halfB + r] },
      // 2. Top-left fillet.
      {
        kind: 'arc',
        to: [innerTrackR - r, -halfB],
        center: [innerTrackR - r, -halfB + r],
        ccw: true,
      },
      // 3. Left wall — radial decreasing toward bore.
      { kind: 'line', to: [innerR, -halfB] },
      // 4. Bore — axial increasing at innerR.
      { kind: 'line', to: [innerR, halfB] },
      // 5. Right wall — radial increasing back to raceway level.
      { kind: 'line', to: [innerTrackR - r, halfB] },
      // 6. Top-right fillet — closes loop.
      {
        kind: 'arc',
        to: [innerTrackR, halfB - r],
        center: [innerTrackR - r, halfB - r],
        ccw: true,
      },
    ] satisfies ProfileSegment[],
  );
  const innerRing = makeRevolZ(oc, innerRingFace);

  // ── 4. Needle (capsule-like cylinder with rounded ends) ──
  // Profile in [radial, axial], CCW with metal interior on the LEFT
  // when walking. The "axis side" of the profile sits at radial=pitchR
  // (the needle's revolution axis); the "outer side" sits at radial=
  // pitchR + RD/2 with two corner fillets r_R rounding the ends.
  //
  //   BL = [pitchR, -half_RW]                     ← axis, left
  //   BR = [pitchR, +half_RW]                     ← axis, right
  //   TR = [pitchR + RD/2 - r_R, +half_RW]        ← right wall, before fillet
  //   TR_arc = [pitchR + RD/2, +half_RW - r_R]    ← right fillet end, on top
  //   TL_arc = [pitchR + RD/2, -half_RW + r_R]    ← left fillet end, on top
  //   TL = [pitchR + RD/2 - r_R, -half_RW]        ← left wall, after fillet
  //
  // Revolution axis: line through (pitchR, 0, -half_RW) parallel to Z
  // (= bearing axial direction). The BL→BR edge lies on this axis.
  const needleProfileWire = makeProfileWireXZ(
    oc,
    [pitchR, -half_RW], // BL (start, on axis)
    [
      { kind: 'line', to: [pitchR, half_RW] }, // BL → BR (axis)
      { kind: 'line', to: [pitchR + RD / 2 - r_R, half_RW] }, // BR → TR
      {
        kind: 'arc',
        to: [pitchR + RD / 2, half_RW - r_R],
        center: [pitchR + RD / 2 - r_R, half_RW - r_R],
        ccw: true,
      }, // TR → TR_arc (right end fillet)
      {
        kind: 'line',
        to: [pitchR + RD / 2, -half_RW + r_R],
      }, // TR_arc → TL_arc (top edge)
      {
        kind: 'arc',
        to: [pitchR + RD / 2 - r_R, -half_RW],
        center: [pitchR + RD / 2 - r_R, -half_RW + r_R],
        ccw: true,
      }, // TL_arc → TL (left end fillet)
      { kind: 'line', to: [pitchR, -half_RW] }, // TL → BL (closes)
    ] satisfies ProfileSegment[],
  );
  // Revolution axis: at world point (pitchR, 0, anywhere on Z-axis),
  // direction (0, 0, 1) = bearing axial direction. The needle becomes
  // a cylinder of radius RD/2 and length 2·half_RW with rounded ends,
  // centred at (pitchR, 0, 0).
  const masterNeedle = makeRevolAroundAxis(
    oc,
    needleProfileWire,
    [pitchR, 0, -half_RW],
    [0, 0, 1],
  );

  const rollerCount = computeNeedleCount(pitchR, RD);
  const needles: unknown[] = [];
  for (let i = 0; i < rollerCount; i++) {
    const angle = (2 * Math.PI * i) / rollerCount;
    needles.push(rotateShapeAroundZ(oc, masterNeedle, angle, /* share */ false));
  }

  // ── 5. Merge into a single multi-body solid + STEP export ──
  const bearing = mergeShapesIntoMultibodySolid(oc, [innerRing, outerRing, ...needles]);

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
 * Needle count from the C++ formula (line 2651). The 1.15 spacing
 * factor is much tighter than the 1.5 ball-bearing factor — needles
 * are thin and tightly packed. Catalog Z is intentionally ignored;
 * needle catalogs are inconsistent about whether Z counts the cage
 * pockets, the actual needles in the cage, or the maximum capacity.
 */
function computeNeedleCount(pitchR: number, RD: number): number {
  return Math.max(6, Math.floor((Math.PI * 2 * pitchR) / (RD * NEEDLE_GAP_FACTOR)));
}

/**
 * Drawn-cup needle bearing (SHNRB) — port of the
 * `NeedleType::DrawnCup` + `WithoutRib` branch in
 * `BearingCreator::CreateNeedleRollerBearing` (line 2544 + 2588-2607).
 *
 * What's a Drawn-Cup needle bearing
 * ────────────────────────────────
 * A bent-sheet-metal outer ring (the "drawn cup") replaces the
 * machined solid outer ring of SNRB. The cup has thickness `t`
 * (≈ 1.5 mm or 15% of the radial section, whichever is smaller) and
 * is bent over at both axial faces to form short retaining lips that
 * keep the rollers from falling out the front when shipped. No inner
 * ring is supplied — the user's hardened shaft is the inner raceway.
 *
 * Geometry (line 2547-2606)
 * ─────────────────────────
 *   t       = min(1.5, (D2-d1) × 0.15)            // cup wall thickness
 *   outR    = D2 / 2
 *   inR     = outR − t                            // raceway radius (rollers ride here)
 *   r_edge  = min(r, t × 0.8)                     // bend / corner radius
 *   space_X = halfB − 0.1                         // axial budget for needles
 *
 * The 8-edge cup profile carries 2 corner bends at each axial face;
 * the C++ uses `ccw=false` for those arcs but the geometric short arc
 * is unique on a circle so our helper produces the same edge.
 *
 * Skipped vs C++:
 *   · Inner ring (the C++ optionally adds one when `innerType ==
 *     WithInner`; SHNRB defaults to WithoutInner per catalog).
 *   · Cage body (cosmetic).
 *   · Lip-bend variant (the WithRib branch at line 2550-2587 builds
 *     a much more complex 12-edge profile; deferred until a partCode
 *     row needs it).
 */
export async function buildShnrbStepViaOcct(
  req: CadGenerateRequest,
  dims: BearingDims,
): Promise<CadGenerateResult> {
  const started = Date.now();
  const oc = await getOcct();

  const halfB = dims.B / 2;
  const r = dims.r;
  const innerR = dims.d1 / 2;
  const outerR = dims.D2 / 2;

  // Cup wall thickness — line 2438-2440. Min 0.3 mm to keep the bend
  // radius positive even on tiny bearings.
  const max_t = (dims.D2 - dims.d1) * 0.15;
  let t = Math.min(1.5, max_t);
  if (t < 0.3) t = 0.3;

  const inR = outerR - t;
  if (inR <= innerR) {
    throw new Error(
      `SHNRB ${req.partCode}: cup wall thickness ${t.toFixed(3)} consumed entire ` +
        `radial section — D2=${dims.D2} d1=${dims.d1} leaves no room for needles.`,
    );
  }

  // ringThick (used for needle radial sizing; see C++ line 2459) —
  // for DrawnCup the formula uses `t` instead of the solid ringThick,
  // so we follow that.
  const innerTrackR = innerR; // WithoutInner — needles ride on shaft
  const RD = inR - innerTrackR; // needles fill from shaft to cup raceway
  const pitchR = innerTrackR + RD / 2;

  if (RD <= 0) {
    throw new Error(
      `SHNRB ${req.partCode}: degenerate needle diameter — D2-d1 too small for the ` +
        `${t.toFixed(3)} mm cup wall plus needles.`,
    );
  }

  // DrawnCup-WithoutRib axial budget — line 2451 (no rib lip on either face).
  const space_X = halfB - 0.1;
  const gap = 0.05;
  const cage_X_out = space_X - gap;
  const cage_X_in = cage_X_out - Math.max(RD * 0.2, 0.4);
  let half_RW = cage_X_in - gap;
  if (half_RW < 1.0) half_RW = 1.0;

  if (half_RW * 2 >= dims.B) {
    throw new Error(
      `SHNRB ${req.partCode}: needle length ${(half_RW * 2).toFixed(3)} ≥ B=${dims.B}.`,
    );
  }

  const r_R = Math.min(RD * NEEDLE_END_FILLET_RATIO, half_RW * NEEDLE_END_FILLET_RATIO);
  const r_edge = Math.min(r, t * 0.8);

  // ── Drawn-cup outer ring profile (8 edges, 2 corner-bend fillets per face). ──
  // CCW with metal interior on the left. Walking from the top-left
  // corner-bend top point, across the OD, around the right bend,
  // down the right side, across the inner raceway face, up the left
  // side, and around the left bend back to start.
  const cupFace = makeProfileWireXZ(
    oc,
    [outerR, -halfB + r_edge], // pTL_T_nr-ish (top of OD on left side, just inside corner)
    [
      // 1. OD top face — axial increasing (going RIGHT) at radial=outerR.
      { kind: 'line', to: [outerR, halfB - r_edge] },
      // 2. Right corner bend (90°): from top to right-side at corner radius.
      {
        kind: 'arc',
        to: [outerR - r_edge, halfB],
        center: [outerR - r_edge, halfB - r_edge],
        ccw: true,
      },
      // 3. Right axial face — radial decreasing toward raceway.
      { kind: 'line', to: [inR, halfB] },
      // 4. Inner raceway face (where needles ride) — axial decreasing
      //    at radial=inR.
      { kind: 'line', to: [inR, -halfB] },
      // 5. Left axial face — radial increasing back to corner.
      { kind: 'line', to: [outerR - r_edge, -halfB] },
      // 6. Left corner bend — closes loop back to start.
      {
        kind: 'arc',
        to: [outerR, -halfB + r_edge],
        center: [outerR - r_edge, -halfB + r_edge],
        ccw: true,
      },
    ] satisfies ProfileSegment[],
  );
  const cupRing = makeRevolZ(oc, cupFace);

  // ── Needles — same construction as SNRB. ──
  const needleProfileWire = makeProfileWireXZ(
    oc,
    [pitchR, -half_RW],
    [
      { kind: 'line', to: [pitchR, half_RW] },
      { kind: 'line', to: [pitchR + RD / 2 - r_R, half_RW] },
      {
        kind: 'arc',
        to: [pitchR + RD / 2, half_RW - r_R],
        center: [pitchR + RD / 2 - r_R, half_RW - r_R],
        ccw: true,
      },
      { kind: 'line', to: [pitchR + RD / 2, -half_RW + r_R] },
      {
        kind: 'arc',
        to: [pitchR + RD / 2 - r_R, -half_RW],
        center: [pitchR + RD / 2 - r_R, -half_RW + r_R],
        ccw: true,
      },
      { kind: 'line', to: [pitchR, -half_RW] },
    ] satisfies ProfileSegment[],
  );
  const masterNeedle = makeRevolAroundAxis(
    oc,
    needleProfileWire,
    [pitchR, 0, -half_RW],
    [0, 0, 1],
  );

  const rollerCount = computeNeedleCount(pitchR, RD);
  const needles: unknown[] = [];
  for (let i = 0; i < rollerCount; i++) {
    const angle = (2 * Math.PI * i) / rollerCount;
    needles.push(rotateShapeAroundZ(oc, masterNeedle, angle, /* share */ false));
  }

  const bearing = mergeShapesIntoMultibodySolid(oc, [cupRing, ...needles]);

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
 * Gauge-series needle bearing (CNRB) — port of the `NeedleType::Gauge`
 * branch in `BearingCreator::CreateNeedleRollerBearing` (line 2453-2455
 * + the ring construction blocks at line 2475-2622 which the C++
 * INTENTIONALLY skips for Gauge).
 *
 * What's a Gauge needle bearing
 * ─────────────────────────────
 * "Gauge series" = a complete cage-and-roller subassembly (no rings)
 * shipped as a unit and installed in a hardened bore + shaft. The
 * housing bore plays the role of the outer raceway; the shaft plays
 * the role of the inner raceway. This is the lightest-weight and
 * smallest-radial-section needle bearing category in NSK / KOYO / NTN
 * catalogs.
 *
 * Geometry differences vs SNRB
 * ────────────────────────────
 *   1. NO outer ring — the C++ skips it (the `if (Solid) … else if
 *      (DrawnCup) …` chain has no Gauge branch).
 *   2. NO inner ring — Gauge always runs on the shaft directly.
 *   3. Wider axial budget for the rollers — `space_X = halfB - 0.1`
 *      vs the Solid+WithoutRib's `halfB - r - 0.1`. The rollers can
 *      span almost the full B because no ring shoulders constrain
 *      them.
 *
 * The downloaded STEP is a circular pattern of needles only — the
 * housing/shaft pair is not modelled (designers add their own from
 * the assembly drawing). The needles are positioned so the assembly
 * still measures correctly: bore = d1, OD = D2 (with a thin
 * ringThick allowance at top/bottom matching the C++'s `RD = D/2 −
 * ringThick − innerTrackR` formula at line 2459).
 */
export async function buildCnrbStepViaOcct(
  req: CadGenerateRequest,
  dims: BearingDims,
): Promise<CadGenerateResult> {
  const started = Date.now();
  const oc = await getOcct();

  // ── Geometry constants — match the Gauge branch of C++ exactly. ──
  const halfB = dims.B / 2;
  const ringThick = (dims.D2 - dims.d1) * RING_THICK_RATIO;
  const innerR = dims.d1 / 2;
  const outerR = dims.D2 / 2;
  // C++ Gauge defaults to WithoutInner (matches catalog convention
  // where CNRB is shipped as cage-and-roller only) — line 2457: if
  // innerType == WithInner, innerTrackR = innerR + ringThick, else
  // innerTrackR = innerR.
  const innerTrackR = innerR;
  const RD = outerR - ringThick - innerTrackR;
  const pitchR = innerTrackR + RD / 2;

  if (RD <= 0) {
    throw new Error(
      `CNRB ${req.partCode}: degenerate needle diameter — D2-d1 too small ` +
        `for the (D-d)·0.2 ringThick allowance plus needle space.`,
    );
  }

  // Gauge axial budget — line 2454 (no outer-ring shoulder so just
  // 0.1 mm clearance from each face).
  const space_X = halfB - 0.1;
  const gap = 0.05;
  const cage_X_out = space_X - gap;
  const cage_X_in = cage_X_out - Math.max(RD * 0.2, 0.4);
  let half_RW = cage_X_in - gap;
  if (half_RW < 1.0) half_RW = 1.0;

  if (half_RW * 2 >= dims.B) {
    throw new Error(
      `CNRB ${req.partCode}: needle length ${(half_RW * 2).toFixed(3)} ≥ B=${dims.B}.`,
    );
  }

  const r_R = Math.min(RD * NEEDLE_END_FILLET_RATIO, half_RW * NEEDLE_END_FILLET_RATIO);

  // ── Master needle (capsule) — same construction as SNRB. ──
  const needleProfileWire = makeProfileWireXZ(
    oc,
    [pitchR, -half_RW],
    [
      { kind: 'line', to: [pitchR, half_RW] },
      { kind: 'line', to: [pitchR + RD / 2 - r_R, half_RW] },
      {
        kind: 'arc',
        to: [pitchR + RD / 2, half_RW - r_R],
        center: [pitchR + RD / 2 - r_R, half_RW - r_R],
        ccw: true,
      },
      { kind: 'line', to: [pitchR + RD / 2, -half_RW + r_R] },
      {
        kind: 'arc',
        to: [pitchR + RD / 2 - r_R, -half_RW],
        center: [pitchR + RD / 2 - r_R, -half_RW + r_R],
        ccw: true,
      },
      { kind: 'line', to: [pitchR, -half_RW] },
    ] satisfies ProfileSegment[],
  );
  const masterNeedle = makeRevolAroundAxis(
    oc,
    needleProfileWire,
    [pitchR, 0, -half_RW],
    [0, 0, 1],
  );

  const rollerCount = computeNeedleCount(pitchR, RD);
  const needles: unknown[] = [];
  for (let i = 0; i < rollerCount; i++) {
    const angle = (2 * Math.PI * i) / rollerCount;
    needles.push(rotateShapeAroundZ(oc, masterNeedle, angle, /* share */ false));
  }

  // ── Merge — needles only (no rings, matches C++ Gauge output). ──
  const bearing = mergeShapesIntoMultibodySolid(oc, needles);

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
