/**
 * OCCT-backed STEP generator for split-type plummer block housings
 * (SD / SN series). Port of `BearingCreator::CreatePlummerBlock_Lower`
 * + `_Upper` (`C++Source/NewCreateBearingClass.cpp` line 6922 / 7383).
 *
 * Design goals
 * ────────────
 * Recreate the C++ reference's recognizable silhouette — half-cylinder
 * body, dome cap, foot block, eye-bolt bosses (SD) — not just a stack
 * of axis-aligned boxes. The earlier draft was a box-only approximation
 * and looked nothing like a plummer block.
 *
 * Coordinate convention (matches the C++ source)
 * ──────────────────────────────────────────────
 *   · X = shaft / bearing axis
 *   · Y = vertical (foot below origin, dome above)
 *   · Z = lengthwise along the foot (mounting-slot axis)
 *   · Origin at the bearing seat centre (intersection of shaft axis
 *     and the split plane).
 *
 * Body composition (multi-body STEP)
 * ──────────────────────────────────
 *   · Lower half — Y ≤ 0 — fuse of: foot block + transition rib block
 *     + lower half-cylinder body + (4-bolt only) cap-bolt pillars,
 *     minus mounting slots, bearing seat, shaft hole, cap-bolt holes.
 *   · Upper half — Y ≥ 0 — fuse of: upper half-cylinder dome + cap-
 *     bolt pillars + (SD only) eye-bolt bosses, minus the same bearing
 *     bores and cap-bolt through-holes.
 *
 * Both bodies share the same bearing-bore axis, so the assembly imports
 * cleanly into Inventor / SolidWorks as 2 selectable solids that fit
 * together at the split plane.
 *
 * Half-cylinder construction
 * ──────────────────────────
 * The C++ uses a planar revolve of a profile in the XY plane (axis on
 * the X line, 180° symmetric sweep). We can't reuse the existing
 * `makeProfileWireXZ` helper for that (it's hard-wired to XZ), and
 * writing a new wire builder is more ceremony than it's worth for a
 * topologically simple solid. Instead we build the full cylinder along
 * X and slice off the unwanted half with a slab box — the resulting
 * half-cylinder has a `CYLINDRICAL_SURFACE` curved face and two `PLANE`
 * end caps in STEP, which is exactly what the revolve would produce.
 *
 * Cap-bolt geometry (C++ formulas, line 6994-7000 / 7432-7435)
 * ────────────────────────────────────────────────────────────
 *   pillarR  = (t · 1.2) − 1.5
 *   capBoltZ = (D · 0.164) − (g · 1.29) + (t · 9.7) + 2.8
 *   cbX      = (J1 · 0.5) + ((H2 − 2H) · 0.75) − 10
 *              clamped to [g/2 + pillarR·0.3, A1/2 − pillarR − 0.5]
 *   capBoltSeatY = (H2 · 1.001) − (H1 · 2.001) − (t · 8.476) + 70.2
 *
 * Eye-bolt geometry (SD only, C++ line 7437-7446)
 * ───────────────────────────────────────────────
 *   eyeBossTopY  = (H2 − H) − (t · 0.4) + 1.2
 *   eyeBossSpacing = (D · 0.16) + (t · 3.9) − 7.0
 *   eyeZ = eyeBossSpacing / 2
 *   bossR = min(t · 1.1, 18 mm)
 *
 * Skipped vs C++ (deliberate simplifications)
 * ───────────────────────────────────────────
 *   · 2° draft angle on the foot.
 *   · Outside fillet (`Base_r`) on the foot's top edge.
 *   · Bottom-shell recess pocket (cosmetic, line 7064-7090).
 *   · Oil-seal grooves inside the bearing bore (line 7314-7336).
 *   · Stepped d1 / d2 shaft clearance (we use a single bore).
 *   · Spot face on the cap-bolt heads (line 7595-7602).
 *   · Cap-bolt pillar tear-drop silhouette — we use plain cylinders,
 *     which fuse with the body to give the same visual mass.
 *   · Grease-feed hole + center mark (purely cosmetic).
 */
import type { CadGenerateRequest, CadGenerateResult } from '../../types.js';
import { FORMAT_EXT, FORMAT_MIME } from '../../types.js';
import {
  boolCut,
  boolFuse,
  exportStepBytes,
  flattenBrepWithVoidsToManifolds,
  getOcct,
  makeBox,
  makeCylinder,
  makeHexPrism,
  makeProfileWireXZ,
  makeRevolAroundAxis,
  makeTorus,
  mergeShapesIntoMultibodySolid,
  translateShape,
} from '../../core/occt.js';
import { bomFileName } from '../../core/bom-meta.js';
import type { PlummerBlockDims } from './dimensions-plummer.js';

export async function buildPlummerBlockStepViaOcct(
  req: CadGenerateRequest,
  dims: PlummerBlockDims,
): Promise<CadGenerateResult> {
  const started = Date.now();
  const oc = await getOcct();

  const {
    d1, D2, A, A1, L, H, H1, H2, J, J1, N, N1, g, capBoltCount, capBoltM,
    J2, N2, J3, J4, N3,
  } = dims;

  // ── Derived dimensions ───────────────────────────────────────
  const t = capBoltM;                      // cap bolt nominal (mm)
  const domeH = H2 - H;                    // dome height above split
  const domeR = D2 / 2 + 18;               // body radius (C++ line 7015)
  const footTop = -H + H1;
  const footBottom = -H;
  const halfA1 = A1 / 2;

  // Cap-bolt placement (mirrors C++ formulas)
  const pillarR = Math.max(t * 1.2 - 1.5, t * 0.7);
  // capBoltZ — distance of the cap-bolt position from the bearing
  // axis along the foot length. C++ formula (line 6995) — NO floor or
  // clamping on this value. The previous code had a defensive floor
  // `Math.max(capBoltZraw, J/2 - pillarR*0.5)` which for SD3134 raised
  // capBoltZ from 155 to 221, pushing the cap-bolt pillars OUT to
  // Z∈[128, 249] and covering the mounting slots / locating-pin holes
  // at Z=±235. C++ uses 155.1 as-is and the pillar Z range [62, 182]
  // stays clear of the foot's outer hole zone (Z>200).
  const capBoltZ = D2 * 0.164 - g * 1.29 + t * 9.7 + 2.8;
  const cbXraw = J1 * 0.5 + (H2 - 2 * H) * 0.75 - 10;
  const cbXmin = g / 2 + pillarR * 0.3;
  const cbXmax = A1 / 2 - pillarR - 0.5;
  const cbX = Math.max(cbXmin, Math.min(cbXmax, cbXraw));
  const capBoltR = t / 2;
  const capBoltSeatY = Math.max(domeH * 0.7, H2 * 1.001 - H1 * 2.001 - t * 8.476 + 70.2);

  // Pillar tail length (C++ line 7233 / 7565). The pillar's outer end
  // is a half-cylinder of radius pillarR centred at (cbX, capBoltZ);
  // the inner end is a flat rectangle extending innerExt toward Z=0.
  // This tail is what fuses the pillar with the body — without it the
  // pillar sits OUTSIDE the body's spherical surface and floats free.
  const innerExt = Math.max(capBoltZ * 0.6, pillarR + 4);

  // Eye-bolt geometry (SD only — heavy duty 4-bolt). Mirrors C++ line
  // 7437. Boss top sits 4 mm above the dome's central peak at Y=domeR
  // so the small "horn" between the two eye-bolts (visible in C++ as
  // the dome's natural sphere apex) is preserved.
  const isHeavyDuty = capBoltCount === 4;
  const eyeBossTopY = domeH - t * 0.4 + 1.2;
  const eyeZ = (D2 * 0.16 + t * 3.9 - 7.0) / 2;
  const bossR = Math.min(t * 1.1, 18);
  const eyeBossDepth = domeH * 0.6;

  // Z extent of the body / rib block — wide enough to cover cap-bolt
  // pillars and the bearing seat with margin.
  const bodyZ = Math.max(2 * (capBoltZ + pillarR + 4), D2 + 30, g + 30);

  // Shaft-cylinder collar (C++ Lower_Shaft_Cylinder line 7170-7215 /
  // Upper_Shaft_Cylinder line 7488-7525). The C++ adds a half-annular
  // tube that EXTENDS the body outward to X=±halfA (= A/2) in the
  // bearing-seat zone — beyond the truncated hemisphere's X=±halfA1
  // limit. Outer radius `clearR` is the C++ clearance formula for the
  // shaft pass-through; inner radius is d1/2 (the shaft hole, which
  // gets cut out later).
  // Without this annulus the body silhouette shows only the
  // hemisphere's truncated flat sides at X=±halfA1 (=±110 mm), missing
  // the wider drum-like section near the foot top that's clearly
  // visible in the C++ reference image.
  const halfA = A / 2;
  const shaftClearR = (-0.00074074 * d1 * d1 + 1.4 * d1 + 26.6667) / 2;
  const shaftDR = d1 / 2;

  // ── LOWER HALF ──────────────────────────────────────────────
  let lowerHalf = buildLowerHalf(oc, {
    A, H1, L, halfA1, A1, footTop, footBottom,
    domeR, bodyZ,
    capBoltCount, cbX, capBoltZ, pillarR, innerExt,
    halfA, shaftClearR, shaftDR,
  });

  // ── UPPER HALF ──────────────────────────────────────────────
  let upperHalf = buildUpperHalf(oc, {
    halfA1, A1, domeR, bodyZ, domeH,
    capBoltCount, cbX, capBoltZ, pillarR, innerExt, capBoltSeatY,
    isHeavyDuty, eyeBossTopY, eyeZ, bossR, eyeBossDepth,
    halfA, shaftClearR, shaftDR,
  });

  // ── Bearing seat + shaft bore (cut from BOTH halves) ────────
  const bearingSeat = makeXAxisCylinder(oc, D2 / 2, g + 1, -(g + 1) / 2);
  const shaftHole = makeXAxisCylinder(oc, d1 / 2, A + 4, -(A + 4) / 2);
  lowerHalf = boolCut(oc, lowerHalf, bearingSeat);
  lowerHalf = boolCut(oc, lowerHalf, shaftHole);
  upperHalf = boolCut(oc, upperHalf, bearingSeat);
  upperHalf = boolCut(oc, upperHalf, shaftHole);

  // ── Mounting slots (oblong, through the foot) ───────────────
  // Slot major axis = world Z (along foot length), minor = world X.
  // Length N1, width N. Position depends on capBoltCount:
  //   2-bolt (SN): centred at X=0, Z = ±J/2
  //   4-bolt (SD): at X = ±J1/2, Z = ±J/2
  const slotR = N / 2;
  const slotStraight = Math.max(0, N1 - N);
  const slotDepth = H1 + 4;              // through the foot with margin
  const slotYBase = footBottom - 2;
  const slotXs = capBoltCount === 4 ? [+J1 / 2, -J1 / 2] : [0];
  const slotZs = [+J / 2, -J / 2];
  for (const sx of slotXs) {
    for (const sz of slotZs) {
      const slot = buildOblongSlot(oc, sx, slotYBase, sz, slotR, slotStraight, slotDepth);
      lowerHalf = boolCut(oc, lowerHalf, slot);
    }
  }

  // ── Extra 4-bolt round holes (SN-only, conditional) ─────────
  // Mirrors C++ line 7126-7136: when isHeavyDuty=false AND catalog
  // provides N2, J1, J2, drill 4 round holes at (X=±J2/2, Z=±J1/2)
  // through the foot. These are secondary mounting bolts for
  // light-duty SN housings.
  if (!isHeavyDuty && N2 && N2 > 0 && J2 && J2 > 0 && J1 > 0) {
    const extraR = N2 / 2;
    const extraDepth = H1 + 4;
    for (const ex of [+J2 / 2, -J2 / 2]) {
      for (const ez of [+J1 / 2, -J1 / 2]) {
        const holeZ = makeCylinder(oc, extraR, extraDepth);
        const holeY = rotateZtoY(oc, holeZ);
        const hole = translateShape(oc, holeY, ex, slotYBase, ez);
        lowerHalf = boolCut(oc, lowerHalf, hole);
      }
    }
  }

  // ── Locating pin holes (conditional) ────────────────────────
  // Mirrors C++ line 7138-7148: when catalog provides N3, J3, J4,
  // drill 4 round pin holes at (X=±(A/2-J4), Z=±(L/2-J3)) — i.e.
  // J4 in from each X edge of the foot, J3 in from each Z edge.
  if (N3 && N3 > 0 && J3 && J3 > 0 && J4 && J4 > 0) {
    const pinR = N3 / 2;
    const pinDepth = H1 + 4;
    const pinX = A / 2 - J4;
    const pinZ = L / 2 - J3;
    for (const px of [+pinX, -pinX]) {
      for (const pz of [+pinZ, -pinZ]) {
        const holeZ = makeCylinder(oc, pinR, pinDepth);
        const holeY = rotateZtoY(oc, holeZ);
        const hole = translateShape(oc, holeY, px, slotYBase, pz);
        lowerHalf = boolCut(oc, lowerHalf, hole);
      }
    }
  }

  // ── Cap-bolt through-holes (cut from BOTH halves) ───────────
  const capBoltPositions: Array<[number, number]> =
    capBoltCount === 4
      ? [[+cbX, +capBoltZ], [-cbX, +capBoltZ], [+cbX, -capBoltZ], [-cbX, -capBoltZ]]
      : [[0, +capBoltZ], [0, -capBoltZ]];
  for (const [px, pz] of capBoltPositions) {
    // Lower: hole from split plane down through the foot.
    const lowerHoleZ = makeCylinder(oc, capBoltR, H + 2);
    const lowerHoleY = rotateZtoY(oc, lowerHoleZ);
    const lowerHole = translateShape(oc, lowerHoleY, px, footBottom - 1, pz);
    lowerHalf = boolCut(oc, lowerHalf, lowerHole);

    // Upper: hole from cap top down to split plane.
    const upperHoleHeight = capBoltSeatY + domeH + 2;
    const upperHoleZ = makeCylinder(oc, capBoltR, upperHoleHeight);
    const upperHoleY = rotateZtoY(oc, upperHoleZ);
    const upperHole = translateShape(oc, upperHoleY, px, -1, pz);
    upperHalf = boolCut(oc, upperHalf, upperHole);
  }

  // ── Bottom shell recess (lightening pocket on foot bottom) ──
  // C++ line 7064-7090. Cuts an inverted-T pocket UP from the foot
  // bottom by H1·0.35, sized to clear the mounting-slot bolts and
  // leave a 15 mm wall around the perimeter.
  const wt = 15;
  const recessDepth = H1 * 0.35;
  const pw = A / 2 - wt;
  const z_inner = J / 2 - N1 / 2 - wt;
  const z_outer = J / 2 + N1 / 2 + wt;
  const z_max = L / 2 - wt;
  if (pw > 0 && recessDepth > 0) {
    if (z_inner > 0) {
      const inner = makeBox(oc, 2 * pw, recessDepth, 2 * z_inner);
      const innerPos = translateShape(
        oc, inner, 0, footBottom + recessDepth / 2, -z_inner,
      );
      lowerHalf = boolCut(oc, lowerHalf, innerPos);
    }
    if (z_max - z_outer > 3) {
      const outerLen = z_max - z_outer;
      // +Z side
      const outerPos1 = makeBox(oc, 2 * pw, recessDepth, outerLen);
      const outerPos1T = translateShape(
        oc, outerPos1, 0, footBottom + recessDepth / 2, z_outer,
      );
      lowerHalf = boolCut(oc, lowerHalf, outerPos1T);
      // -Z side
      const outerPos2 = makeBox(oc, 2 * pw, recessDepth, outerLen);
      const outerPos2T = translateShape(
        oc, outerPos2, 0, footBottom + recessDepth / 2, -z_max,
      );
      lowerHalf = boolCut(oc, lowerHalf, outerPos2T);
    }
  }

  // ── Eye-bolt threaded holes (SD upper only) ─────────────────
  // C++ leaves these for the separate eye-bolt PART to insert; for our
  // standalone STEP we drill a visible blind hole at each lifting-eye
  // seat. Depth ≈ 1.5·t (typical M-thread engagement length), wide
  // enough to read as a real bolt seat in CAD viewers.
  if (isHeavyDuty && eyeZ > 0 && bossR > 0) {
    const eyeHoleR = Math.max(bossR * 0.55, t / 2 - 1);
    const eyeHoleDepth = Math.min(t * 1.8, eyeBossDepth - 4);
    if (eyeHoleDepth > 0) {
      for (const ez of [+eyeZ, -eyeZ]) {
        // Cylinder along +Y, length = depth + 2 (for clean cut at top).
        const ehZ = makeCylinder(oc, eyeHoleR, eyeHoleDepth + 2);
        const ehY = rotateZtoY(oc, ehZ);
        // Top of hole pokes 1 mm above boss top (=eyeBossTopY) to
        // ensure clean break. Boss top is now at eyeBossTopY (not +4).
        const ehTopY = eyeBossTopY + 1;
        const eh = translateShape(
          oc, ehY, 0, ehTopY - eyeHoleDepth - 2, ez,
        );
        upperHalf = boolCut(oc, upperHalf, eh);
      }
    }
  }

  // ── Cap bolts + eye bolts (separate solids in the assembly) ─
  // Mirrors C++ `CreatePlummerBlock_Bolt` (line 7711-7765) and
  // `CreatePlummerBlock_EyeBolt` (line 7767-7833). The C++ output
  // STEP comes in as 5 closed shells: 2 housing halves + cap-bolt
  // assembly + 2 eye bolts. Without these the visual result lacks the
  // visible bolt heads and lifting eyes that the user expects.
  const hardware: unknown[] = [];

  // Cap bolts — one per cap-bolt position. Hex head + shank are added
  // as SEPARATE solids in the multi-body STEP rather than internally
  // fused. Internal boolFuse on near-coincident faces sometimes silently
  // produces a non-manifold compound that gets dropped by
  // mergeShapesIntoMultibodySolid (it has no shells). Two overlapping
  // solids look identical in CAD viewers since they share the visible
  // exterior surface.
  const capBoltPosForHardware: ReadonlyArray<readonly [number, number]> =
    capBoltCount === 4
      ? [[+cbX, +capBoltZ], [-cbX, +capBoltZ], [+cbX, -capBoltZ], [-cbX, -capBoltZ]]
      : [[0, +capBoltZ], [0, -capBoltZ]];
  for (const [bx, bz] of capBoltPosForHardware) {
    const parts = buildCapBoltParts(oc, t, capBoltSeatY, bx, bz);
    hardware.push(...parts);
  }

  // Eye bolts — SD only (heavy duty 4-cap-bolt config).
  if (isHeavyDuty && eyeZ > 0) {
    for (const ez of [+eyeZ, -eyeZ]) {
      const parts = buildEyeBoltParts(oc, t, eyeBossTopY, ez);
      hardware.push(...parts);
    }
  }

  // ── Merge into a single multi-body STEP ─────────────────────
  const allShapes: unknown[] = [lowerHalf, upperHalf, ...hardware];
  const housing = mergeShapesIntoMultibodySolid(oc, allShapes as never[]);

  const rawStep = exportStepBytes(oc, housing);
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

// ─────────────────────────────────────────────────────────────
// Lower half builder
// ─────────────────────────────────────────────────────────────
interface LowerArgs {
  A: number; H1: number; L: number;
  halfA1: number; A1: number;
  footTop: number; footBottom: number;
  domeR: number; bodyZ: number;
  capBoltCount: 2 | 4; cbX: number; capBoltZ: number;
  pillarR: number; innerExt: number;
  halfA: number; shaftClearR: number; shaftDR: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildLowerHalf(oc: any, a: LowerArgs): any {
  const { A, H1, L, halfA1, footTop, footBottom, domeR, bodyZ,
    capBoltCount, cbX, capBoltZ, pillarR, innerExt } = a;

  // 1. Foot block: A × H1 × L, top face at Y=footTop.
  const footRaw = makeBox(oc, A, H1, L);
  const foot = translateShape(oc, footRaw, 0, footBottom + H1 / 2, -L / 2);

  // 2. Lower hemisphere body — TRUE revolve around X axis. Replaces the
  // earlier sphere+slab approach. Drops the rib block: in the previous
  // version the rib's Z extent (±186 mm) reached beyond the hemisphere's
  // Z range (±158 mm at the equator), creating "wing" geometry that
  // appeared floating in the multi-body STEP.
  const lowerHemi = makeTruncatedHemisphere(
    oc, domeR, halfA1, /* keepLowerY */ true,
  );

  // 2b. Shaft-cylinder collar: half-annulus extending body to X=±halfA
  // around the bearing-seat region (C++ Lower_Shaft_Cylinder).
  const shaftCyl = buildShaftCylinderHalf(
    oc, a.halfA, a.shaftDR, a.shaftClearR, /* keepLowerY */ true,
  );

  let body = boolFuse(oc, foot, lowerHemi);
  body = boolFuse(oc, body, shaftCyl);

  // 4. Cap-bolt pillars — D-shaped tear-drop solids on each cap-bolt
  // position. The cylindrical bulb sits at (X, Z=±capBoltZ) outside
  // the hemisphere; the rectangular tail extends `innerExt` toward
  // Z=0, fusing the pillar with the body. Pillar Y range:
  // [footTop, +0.5] — the pillar starts AT THE FOOT TOP (not the foot
  // BOTTOM) so it does not block the foot's mounting holes from view.
  // Mirrors C++ Lower_Pillars (line 7259):
  //   CreateExtrude(0.0 - baseTopY, Positive)
  //     where baseTopY = footTop, so extrude amount = -footTop = H-H1
  //     and direction is +Y (up from sketch plane at footTop) → pillar
  //     occupies Y ∈ [footTop, 0]. The 0.5 mm overshoot above split is
  //     trimmed by the final cleanup cut.
  //   2-bolt SN: 2 pillars at X=0, Z=±capBoltZ
  //   4-bolt SD: 4 pillars at X=±cbX, Z=±capBoltZ
  const pillarH = -footTop + 0.5;
  const pillarPositions: ReadonlyArray<readonly [number, number]> =
    capBoltCount === 4
      ? [[+cbX, +capBoltZ], [-cbX, +capBoltZ], [+cbX, -capBoltZ], [-cbX, -capBoltZ]]
      : [[0, +capBoltZ], [0, -capBoltZ]];
  for (const [px, pz] of pillarPositions) {
    const pillar = buildDShapePillar(
      oc, px, footTop, pz, pillarR, innerExt, pillarH,
    );
    body = boolFuse(oc, body, pillar);
  }

  // 5. Final cleanup: clip everything to Y ≤ 0. Without this the
  // pillar tops (which overshoot by 0.5 mm) would overlap the upper
  // body in the multi-body STEP.
  const cleanupSy = domeR + 4;
  const cleanupSx = Math.max(A, halfA1 * 2 + 4) + bodyZ;
  const cleanupSz = bodyZ * 2 + L;
  const cleanupSlabRaw = makeBox(oc, cleanupSx, cleanupSy, cleanupSz);
  const cleanupSlab = translateShape(
    oc, cleanupSlabRaw, 0, cleanupSy / 2, -cleanupSz / 2,
  );
  body = boolCut(oc, body, cleanupSlab);

  return body;
}

// ─────────────────────────────────────────────────────────────
// Upper half builder
// ─────────────────────────────────────────────────────────────
interface UpperArgs {
  halfA1: number; A1: number;
  domeR: number; bodyZ: number; domeH: number;
  capBoltCount: 2 | 4; cbX: number; capBoltZ: number;
  pillarR: number; innerExt: number;
  capBoltSeatY: number;
  isHeavyDuty: boolean;
  eyeBossTopY: number; eyeZ: number; bossR: number; eyeBossDepth: number;
  halfA: number; shaftClearR: number; shaftDR: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildUpperHalf(oc: any, a: UpperArgs): any {
  const { halfA1, capBoltCount, cbX, capBoltZ, pillarR, innerExt,
    domeR, capBoltSeatY, isHeavyDuty, eyeBossTopY, eyeZ, bossR,
    eyeBossDepth } = a;

  // 1. Upper hemisphere dome — sphere of radius domeR truncated at
  // X=±A1/2 and Y=0 (keeping the upper half).
  let body = makeTruncatedHemisphere(oc, domeR, halfA1, /* keepLowerY */ false);

  // 1b. Shaft-cylinder collar (upper, mirrors C++ Upper_Shaft_Cylinder).
  const shaftCyl = buildShaftCylinderHalf(
    oc, a.halfA, a.shaftDR, a.shaftClearR, /* keepLowerY */ false,
  );
  body = boolFuse(oc, body, shaftCyl);

  // 2. Cap-bolt pillars — D-shaped tear-drops, mirroring the lower
  // pillars. They run from Y=-0.5 (slight overlap with lower pillar)
  // up to Y=capBoltSeatY. The D-shape's tail fuses with the dome.
  const pillarH = capBoltSeatY + 0.5;
  const cbPositions: ReadonlyArray<readonly [number, number]> =
    capBoltCount === 4
      ? [[+cbX, +capBoltZ], [-cbX, +capBoltZ], [+cbX, -capBoltZ], [-cbX, -capBoltZ]]
      : [[0, +capBoltZ], [0, -capBoltZ]];
  for (const [px, pz] of cbPositions) {
    const pillar = buildDShapePillar(oc, px, -0.5, pz, pillarR, innerExt, pillarH);
    body = boolFuse(oc, body, pillar);
  }

  // 3. Eye-bolt bosses (SD only). Cylindrical bosses fused to the dome
  // at (X=0, Z=±eyeZ). Bottom inside the dome (at Y=eyeBossTopY -
  // eyeBossDepth), top exactly at Y=eyeBossTopY — matching the C++
  // workplane reference where the eye-bolt collar mates. (Earlier
  // version had top at +4 mm, which made the eye-bolt collar embed
  // into the boss.)
  if (isHeavyDuty && eyeZ > 0 && bossR > 0) {
    const bossH = eyeBossDepth;
    for (const ez of [+eyeZ, -eyeZ]) {
      const bcyl = makeCylinder(oc, bossR, bossH);
      const bcylY = rotateZtoY(oc, bcyl);
      const boss = translateShape(oc, bcylY, 0, eyeBossTopY - eyeBossDepth, ez);
      body = boolFuse(oc, body, boss);
    }
  }

  // 4. Bottom cleanup: clip Y < 0 so the upper body sits strictly above
  // the split plane (no overlap with the lower body in the multi-body
  // STEP). Dome top is left intact at Y=domeR — the central spherical
  // peak between the eye-bolts is the small "horn" visible in the C++
  // reference and disappears if truncated.
  const cleanupSy = domeR + 4;
  const cleanupSx = a.A1 + a.bodyZ + 4;
  const cleanupSz = a.bodyZ * 2 + 4 * domeR;
  const cleanupSlabRaw = makeBox(oc, cleanupSx, cleanupSy, cleanupSz);
  const cleanupSlab = translateShape(
    oc, cleanupSlabRaw, 0, -cleanupSy / 2, -cleanupSz / 2,
  );
  body = boolCut(oc, body, cleanupSlab);

  return body;
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

/**
 * Build a half-annular tube extending the body to X=±halfA around the
 * bearing-seat region. Mirrors the C++ Lower_Shaft_Cylinder (line 7170-
 * 7215) / Upper_Shaft_Cylinder (line 7488-7525) revolve features.
 *
 * Profile (XZ plane, Y=0): rectangle X∈[-halfA, +halfA],
 * Z∈[-clearR, -shaftDR] (for lower) — i.e. an inner-bore-to-clearance
 * annular cross-section. Revolving 180° around the X axis sweeps this
 * rectangle into a half-annulus tube whose outer surface is at radius
 * clearR and inner surface at radius shaftDR.
 *
 * The fused result with the hemisphere body extends the body in X to
 * ±halfA (= A/2, the foot's full half-width) instead of just ±halfA1
 * (= A1/2, the body's narrower top width). This produces the visible
 * widening at the bearing-seat zone seen in the C++ reference image.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildShaftCylinderHalf(
  oc: any, halfA: number, _shaftDR: number, clearR: number,
  keepLowerY: boolean,
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  // Build a SOLID half-cylinder of outer radius clearR along the X
  // axis, keeping the Y≤0 (lower) or Y≥0 (upper) half. The C++ source
  // defines an annular profile with inner radius `_shaftDR` (= d1/2),
  // but the inner volume is later removed by the shaft-hole cut along
  // X, so a solid half-cylinder is functionally equivalent and far
  // more robust under OCCT's boolean fuser than a hole-through-the-
  // middle annular tube (which has Genus-1 topology and tends to
  // produce non-manifold results when fused with the hemisphere).
  //
  // Method: full cylinder (axis +X, length 2·halfA) cut by a slab
  // covering the unwanted Y half. Outer surface stays as a clean
  // CYLINDRICAL_SURFACE in STEP, matching the C++ feature output.
  const cylZ = makeCylinder(oc, clearR, 2 * halfA);
  const cylX = rotateZtoX(oc, cylZ);
  const cyl = translateShape(oc, cylX, -halfA, 0, 0);

  const slabSx = 2 * halfA + 4;
  const slabSy = clearR + 4;
  const slabSz = 2 * clearR + 4;
  const slabRaw = makeBox(oc, slabSx, slabSy, slabSz);
  // For lower body, cut Y > 0; for upper, cut Y < 0.
  const slabYTrans = keepLowerY ? slabSy / 2 : -slabSy / 2;
  const slab = translateShape(oc, slabRaw, 0, slabYTrans, -slabSz / 2);

  return boolCut(oc, cyl, slab);
}

/**
 * Build the lower or upper plummer-block body via a TRUE revolve —
 * mirrors the C++ `CreateRevolve` call (`NewCreateBearingClass.cpp`
 * line 7167-7168 / 7477). The C++ profile is a rectangle plus a
 * circular arc on the bottom (or top), revolved 180° symmetric around
 * the X axis. The result is mathematically a hemisphere of radius
 * `domeR` truncated at X=±halfA1 with a flat split-plane face at Y=0.
 *
 * Profile construction (in the XZ plane, Y=0)
 * ───────────────────────────────────────────
 *   p1 = (-cutX, 0)           ┐
 *   p2 = (+cutX, 0)           ├ axis line at Z=0 (top edge)
 *   p3 = (+cutX, -cutY)       ┐ vertical end at +X
 *   p4 = (-cutX, -cutY)       ┘ vertical end at -X
 *   arc(p3 → p4, centre (0,0), through (0, -domeR))
 *
 * (cutY = sqrt(domeR² - cutX²), so the arc connects p3 and p4 along
 * a circle of radius domeR centred at the origin.)
 *
 * Revolve direction
 * ─────────────────
 * The wire lies in XZ plane (Y=0) at Z<0. Revolving CCW around the
 * +X axis sweeps the profile through Y>0; revolving CW sweeps it
 * through Y<0. We pick the direction so the swept volume ends up on
 * the correct half:
 *   keepLowerY=true  → sweep through Y<0 → revolve CW (axisDir=-X)
 *   keepLowerY=false → sweep through Y>0 → revolve CCW (axisDir=+X)
 *
 * Using a TRUE revolve (instead of sphere + 3 slab cuts) yields a
 * cleaner STEP boundary representation: 1 SPHERICAL_SURFACE for the
 * curved face, 1 PLANE for the split top, 2 PLANES for the X end
 * caps — no spurious face splits from boolean operations.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeTruncatedHemisphere(
  oc: any, domeR: number, halfA1: number, keepLowerY: boolean,
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  const cutY = Math.sqrt(domeR * domeR - halfA1 * halfA1);

  // Profile points in XZ plane: (X, Z) — Z stands in for the C++ Y
  // (vertical) coordinate during the revolve, then maps back to world Y
  // after revolving around the X axis.
  const wire = makeProfileWireXZ(oc, [-halfA1, 0], [
    { kind: 'line', to: [+halfA1, 0] },
    { kind: 'line', to: [+halfA1, -cutY] },
    { kind: 'arc', to: [-halfA1, -cutY], center: [0, 0], ccw: false },
    { kind: 'line', to: [-halfA1, 0] },
  ]);

  // Revolve direction picks which Y half the swept volume occupies.
  const axisDir: readonly [number, number, number] = keepLowerY
    ? [-1, 0, 0]
    : [+1, 0, 0];

  return makeRevolAroundAxis(oc, wire, [0, 0, 0], axisDir, Math.PI);
}

/**
 * Build a D-shape (tear-drop) pillar solid for the cap-bolt seat.
 * Mirrors the C++ profile (line 7235-7257 / 7567-7589): a 2D D-shape
 * (half-circle bulb at outer end + rectangular tail extending innerExt
 * toward Z=0), built as a SINGLE sketch+extrude solid via
 * `makeProfileWireXZ` + `BRepPrimAPI_MakePrism`.
 *
 * Why sketch+extrude (not cyl+box+fuse)
 * ─────────────────────────────────────
 * The earlier cyl+box+fuse approach created two intermediate solids
 * with COINCIDENT FACES (the box's left/right walls lay flush with
 * the cylinder's tangent planes at X=cx±pillarR). OCCT's boolean
 * fuse on coincident faces sometimes produces a non-manifold result —
 * which then propagates through `boolFuse(body, pillar)` and ends up
 * as separate disjoint shells in the multi-body STEP. The user's
 * image showed each pillar as a free-floating column.
 *
 * Building from a single closed wire avoids the internal fuse: the
 * D-shape is one face from the start, and prism-extrude creates a
 * single connected solid.
 *
 * Profile (XZ plane, Y=0)
 * ───────────────────────
 *   For cz > 0 (bulb on +Z side):
 *     start (cx-w, cz-ext)
 *     → (cx+w, cz-ext)            (bottom of tail)
 *     → (cx+w, cz)                (right side of tail)
 *     → arc to (cx, cz+w)         (bulb upper-right, 90°)
 *     → arc to (cx-w, cz)         (bulb upper-left, 90°)
 *     → close to start            (left side of tail)
 *
 *   For cz < 0: mirrored across Z (bulb on -Z side, tail extending +Z).
 *
 *   Each arc is 90° → unambiguously the SHORT arc, avoiding the
 *   degenerate 180° case where makeProfileWireXZ can't pick a side.
 *
 * Extrusion: along +Y by pillarH, then translate so the bottom face
 * is at Y=yBase.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildDShapePillar(
  oc: any, cx: number, yBase: number, cz: number,
  pillarR: number, innerExt: number, pillarH: number,
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  const w = pillarR;
  const ext = innerExt;

  // Degenerate case: cz=0 (SN-style centre-line) — no "outside" direction.
  // Fall back to a plain cylinder.
  if (Math.abs(cz) < 1e-6) {
    const cyl = makeCylinder(oc, pillarR, pillarH);
    const cylY = rotateZtoY(oc, cyl);
    return translateShape(oc, cylY, cx, yBase, 0);
  }

  let wire;
  if (cz > 0) {
    wire = makeProfileWireXZ(oc, [cx - w, cz - ext], [
      { kind: 'line', to: [cx + w, cz - ext] },
      { kind: 'line', to: [cx + w, cz] },
      { kind: 'arc', to: [cx, cz + w], center: [cx, cz], ccw: true },
      { kind: 'arc', to: [cx - w, cz], center: [cx, cz], ccw: true },
      { kind: 'line', to: [cx - w, cz - ext] },
    ]);
  } else {
    wire = makeProfileWireXZ(oc, [cx - w, cz + ext], [
      { kind: 'line', to: [cx + w, cz + ext] },
      { kind: 'line', to: [cx + w, cz] },
      { kind: 'arc', to: [cx, cz - w], center: [cx, cz], ccw: false },
      { kind: 'arc', to: [cx - w, cz], center: [cx, cz], ccw: false },
      { kind: 'line', to: [cx - w, cz + ext] },
    ]);
  }

  const ocAny = oc as unknown as Record<string, unknown>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const FaceCtor = ocAny.BRepBuilderAPI_MakeFace_15 as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const PrismCtor = ocAny.BRepPrimAPI_MakePrism_1 as any;
  if (!FaceCtor || !PrismCtor) {
    throw new Error('OCCT MakeFace_15 / MakePrism_1 binding missing');
  }
  const face = new FaceCtor(wire, true).Face();
  const vec = new oc.gp_Vec_4(0, pillarH, 0);
  const prism = new PrismCtor(face, vec, false, true).Shape();
  return translateShape(oc, prism, 0, yBase, 0);
}

/**
 * Build an oblong slot solid (vertical, axis along Y) for cutting
 * through the foot. Composed of two end-cap cylinders plus a
 * rectangular middle box, all fused. The slot's MAJOR axis is the
 * world Z direction (along the foot length); MINOR is X (across foot).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildOblongSlot(
  oc: any, cx: number, yBase: number, cz: number,
  slotR: number, straightLen: number, depth: number,
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  const halfStraight = straightLen / 2;
  // End cap +Z
  const cap1Z = makeCylinder(oc, slotR, depth);
  const cap1Y = rotateZtoY(oc, cap1Z);
  const cap1 = translateShape(oc, cap1Y, cx, yBase, cz + halfStraight);
  // End cap -Z
  const cap2Z = makeCylinder(oc, slotR, depth);
  const cap2Y = rotateZtoY(oc, cap2Z);
  const cap2 = translateShape(oc, cap2Y, cx, yBase, cz - halfStraight);

  if (straightLen <= 1e-6) {
    return boolFuse(oc, cap1, cap2);
  }

  // Rectangular middle: 2*slotR (X) × depth (Y) × straightLen (Z).
  // makeBox raw Y∈[-depth/2, +depth/2], so translate so it spans
  // [yBase, yBase+depth].
  const midRaw = makeBox(oc, 2 * slotR, depth, straightLen);
  const mid = translateShape(oc, midRaw, cx, yBase + depth / 2, cz - halfStraight);

  let slot = boolFuse(oc, cap1, mid);
  slot = boolFuse(oc, slot, cap2);
  return slot;
}

/**
 * Make a cylinder along the +X axis (after rotating from the default
 * +Z), positioned with its base at X = `xBase`. Used for the bearing
 * seat and shaft-hole bores that run along the bearing axis.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeXAxisCylinder(oc: any, radius: number, length: number, xBase: number): any {
  const z = makeCylinder(oc, radius, length);
  const x = rotateZtoX(oc, z);
  return translateShape(oc, x, xBase, 0, 0);
}

/**
 * Rotate a Z-axis cylinder (the default `makeCylinder` result) by 90°
 * around the Y axis so its axis lies along +X. Used for bores along
 * the shaft axis.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rotateZtoX(oc: any, shape: unknown): any {
  const ocAny = oc;
  const origin = new ocAny.gp_Pnt_3(0, 0, 0);
  const ydir = new ocAny.gp_Dir_4(0, 1, 0);
  const ax1 = new ocAny.gp_Ax1_2(origin, ydir);
  const trsf = new ocAny.gp_Trsf_1();
  trsf.SetRotation_1(ax1, Math.PI / 2);
  return new ocAny.BRepBuilderAPI_Transform_2(shape, trsf, true).Shape();
}

/**
 * Rotate a Z-axis cylinder by 90° around the X axis so its axis lies
 * along +Y. Used for vertical features — mounting slots, cap-bolt
 * holes, cap-bolt pillars, and eye-bolt bosses.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rotateZtoY(oc: any, shape: unknown): any {
  const ocAny = oc;
  const origin = new ocAny.gp_Pnt_3(0, 0, 0);
  const xdir = new ocAny.gp_Dir_4(1, 0, 0);
  const ax1 = new ocAny.gp_Ax1_2(origin, xdir);
  const trsf = new ocAny.gp_Trsf_1();
  trsf.SetRotation_1(ax1, -Math.PI / 2);
  return new ocAny.BRepBuilderAPI_Transform_2(shape, trsf, true).Shape();
}

// ─────────────────────────────────────────────────────────────
// Cap bolt + Eye bolt builders (separate hardware solids)
// ─────────────────────────────────────────────────────────────

/**
 * Build cap-bolt parts: hex head + cylindrical shank, axis along Y.
 * Returns the two parts as separate solids; caller adds them to the
 * multi-body STEP independently. Mirrors C++ `CreatePlummerBlock_Bolt`
 * (line 7711-7765).
 *
 * Why separate solids (not fused)
 * ───────────────────────────────
 * Boolean-fusing a hex prism with a cylinder where the cylinder axis
 * passes through the hex's centre creates many near-coincident faces
 * (the cylinder grazes the inscribed circle of the hex). OCCT's
 * BRepAlgoAPI_Fuse occasionally produces a non-manifold compound in
 * this configuration. The downstream `mergeShapesIntoMultibodySolid`
 * silently drops compounds with no valid shells, so the bolt would
 * vanish from the assembly. Adding head + shank as TWO solids whose
 * volumes overlap gives the same visual result without depending on
 * the boolean.
 *
 * Geometry (in housing coords):
 *   · Hex head: across-flats `1.5·t`, height `0.65·t`, base at
 *     Y=capBoltSeatY (sits on the cap pillar top), extends UP.
 *   · Shank: radius `t/2`, length `capBoltSeatY + 1.5·t`, top at
 *     Y=capBoltSeatY+0.5 (0.5 mm overlap into the head's volume),
 *     extends DOWN through both housing halves.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildCapBoltParts(
  oc: any, t: number, capBoltSeatY: number, cx: number, cz: number,
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): any[] {
  const headW = t * 1.5;
  const headH = t * 0.65;
  const shankR = t / 2;
  const shankL = capBoltSeatY + t * 1.5;

  const headZ = makeHexPrism(oc, headW, headH);
  const headY = rotateZtoY(oc, headZ);
  const head = translateShape(oc, headY, cx, capBoltSeatY, cz);

  const shankZ = makeCylinder(oc, shankR, shankL + 0.5);
  const shankYR = rotateZtoY(oc, shankZ);
  const shank = translateShape(oc, shankYR, cx, capBoltSeatY - shankL, cz);

  return [head, shank];
}

/**
 * Build eye-bolt parts: shank + collar + circular eye ring (torus).
 * Returns the three parts as separate solids; caller adds them to the
 * multi-body STEP independently. Mirrors C++ `CreatePlummerBlock_EyeBolt`
 * (line 7767-7833).
 *
 * Why separate solids (not fused)
 * ───────────────────────────────
 * The torus tube near the path's bottom point passes through the same
 * volume as the cylindrical collar. Fusing these has historically
 * produced a non-manifold compound in opencascade.js — which then
 * gets silently dropped by `mergeShapesIntoMultibodySolid`. Returning
 * three overlapping solids guarantees they ALL appear in the assembly
 * (they share the visible exterior so they look connected to a CAD
 * viewer).
 *
 * Variables match the C++ source:
 *   shankL  = 1.5·t        (insertion into the housing boss)
 *   collarH = 0.4·t
 *   collarR = 1.1·t
 *   wireD   = 0.85·t       (eye ring tube diameter)
 *   insideD = 1.8·t        (eye ring inner diameter)
 *   pathR   = (insideD + wireD)/2   = torus path radius
 *   tubeR   = wireD / 2             = torus tube radius
 *
 * `t` is the eye-bolt thread nominal, capped at M16 (C++ comment
 * "아이볼트는 최대 M16 수준으로 제한" — line 7780-7784).
 *
 * Positioning (in housing coords):
 *   · Shank: Y∈[eyeBossTopY - shankL, eyeBossTopY], at (X=0, Z=cz).
 *   · Collar: Y∈[eyeBossTopY, eyeBossTopY + collarH], same XZ.
 *   · Ring centre at Y = eyeBossTopY + collarH + pathR. Torus axis
 *     along +X (so the ring opens perpendicular to the bearing axis,
 *     matching the C++ sweep direction).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildEyeBoltParts(
  oc: any, t_raw: number, eyeBossTopY: number, cz: number,
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): any[] {
  const t = Math.min(t_raw, 16);
  const shankR = t / 2;
  const shankL = t * 1.5;
  const collarH = t * 0.4;
  const collarR = t * 1.1;
  const wireD = t * 0.85;
  const insideD = t * 1.8;
  const pathR = (insideD + wireD) / 2;
  const tubeR = wireD / 2;

  // Shank: Y∈[eyeBossTopY-shankL, eyeBossTopY+0.5] (0.5 mm into collar).
  const shankZ = makeCylinder(oc, shankR, shankL + 0.5);
  const shankYR = rotateZtoY(oc, shankZ);
  const shank = translateShape(oc, shankYR, 0, eyeBossTopY - shankL, cz);

  // Collar: Y∈[eyeBossTopY-0.5, eyeBossTopY+collarH] (0.5 mm into shank).
  const collarZ = makeCylinder(oc, collarR, collarH + 0.5);
  const collarYR = rotateZtoY(oc, collarZ);
  const collar = translateShape(oc, collarYR, 0, eyeBossTopY - 0.5, cz);

  // Eye ring: torus around +X axis (after rotateZtoX), centre on top of
  // collar. STEP exports this as TOROIDAL_SURFACE — matching the
  // single TOROIDAL_SURFACE seen in the reference C++ STEP file.
  const torusRaw = makeTorus(oc, pathR, tubeR);
  const torusX = rotateZtoX(oc, torusRaw);
  const ringCenterY = eyeBossTopY + collarH + pathR;
  const eye = translateShape(oc, torusX, 0, ringCenterY, cz);

  return [shank, collar, eye];
}
