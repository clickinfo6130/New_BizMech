/**
 * OCCT-backed STEP generator for the SGM-7 servo motor (Yaskawa
 * Sigma-7 series) — including options for brake, gearhead, and oil
 * seal. Faithful port of `MotorCreator::CreateSquareFrameBody`
 * (`C++Source/NewCreateMotorClass.cpp` line 1175-1338) with the brake
 * module / cover at line 1247-1285, plus `CreateGearheadBodyPart`
 * (line 3440-3544) and `CreateGearheadShaftPart` (line 3549-3641) for
 * the optional reduction gearhead.
 *
 * Coordinate convention
 * ─────────────────────
 *   · Z-axis = motor / output shaft axis
 *   · Z = 0  : front face of the motor (output side)
 *   · Z > 0  : output shaft (or gearhead body when fitted)
 *   · Z < 0  : motor body — stator, optional brake, encoder cap
 *
 * Body composition
 * ────────────────
 * The output STEP is a single multi-body solid containing:
 *   1. Front bracket  (axial [-L2 × 0.15, 0])
 *   2. Stator stack   (axial [-L2, -L2 × 0.15], 1 mm inset)
 *   3. Brake module   (only when options.hasBrake; 2 mm inset, axial
 *                      [-L2 - SL, -L2])
 *   4. Brake cover    (only when options.hasBrake; outer = frame outline,
 *                      inner = brake module outline)
 *   5. Encoder cap    (axial [-L1, -L2 - brakeLen])
 *   6. Output shaft   (cylinder S/2 × LR, axial [0, LR])
 *   7. Pilot boss     (only when LB / LE are set, axial [0, LE])
 *   8. Oil seal ring  (only when options.hasOilSeal — thin annular
 *                      ring around the shaft on the front face)
 *   9. Gearhead body  (only when options.hasGearhead — body + flange +
 *                      pilots, axial [0, gearheadLen])
 *  10. Gearhead shaft (only when options.hasGearhead — replaces the
 *                      motor's output shaft as the assembly's external
 *                      output, axial [gearheadLen, gearheadLen + G_L2])
 *
 * Mounting holes are 4 cylindrical bores at the bolt-circle corners
 * on the front face (and the gearhead's flange face when present).
 * Tap thread information is NOT modelled — STEP doesn't carry threads.
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
  mergeShapesIntoMultibodySolid,
  translateShape,
} from '../../core/occt.js';
import { bomFileName } from '../../core/bom-meta.js';
import {
  parseMountingBolt,
  type GearheadDims,
  type MotorDims,
} from './dimensions.js';

const STATOR_INDENT = 1; // mm — C++ line 1231: stator is 1 mm inset from frame OD per side
const BRAKE_INDENT = 2; // mm — C++ line 1252: brake module is 2 mm inset per side
const FRONT_ENDBELL_RATIO = 0.15; // C++ line 1211: front bracket is L2 × 0.15 axially
const SHAFT_HOLE_CLEARANCE = 2; // mm extra over S — C++ line 1226: (S + 2) clearance
const SHAFT_HOLE_DEPTH = 15; // mm — C++ line 1228 fixed cut depth
const OIL_SEAL_THK_RATIO = 0.08; // oil-seal ring axial thickness vs frame width

export async function buildSgm7StepViaOcct(
  req: CadGenerateRequest,
  dims: MotorDims,
): Promise<CadGenerateResult> {
  const started = Date.now();
  const oc = await getOcct();

  const {
    LC, LH, L1, L2, LR, S, EnH, EnW, EnL, PCD_LA, M_LZ, TL_LG, LB, LE,
    options, brake, gearhead,
  } = dims;
  const brakeLen = options.hasBrake && brake ? brake.SL : 0;

  // ── 1. Front bracket (front endbell) ──
  // Axial range [-frontEndbellLen, 0]. Square LC × LH cross-section.
  const frontEndbellLen = L2 * FRONT_ENDBELL_RATIO;
  const frontBracketRaw = makeBox(oc, LC, LH, frontEndbellLen);
  const frontBracket = translateShape(
    oc,
    frontBracketRaw,
    -LC / 2,
    -LH / 2,
    -frontEndbellLen,
  );

  // Central shaft hole through the front bracket.
  const shaftHoleR = (S + SHAFT_HOLE_CLEARANCE) / 2;
  const shaftHoleRaw = makeCylinder(oc, shaftHoleR, SHAFT_HOLE_DEPTH);
  const shaftHole = translateShape(oc, shaftHoleRaw, 0, 0, -SHAFT_HOLE_DEPTH);
  let frontBracketWithHole = boolCut(oc, frontBracket, shaftHole);

  // Optional pilot boss on the front bracket (LB / LE).
  if (LB && LE && LB > 0 && LE > 0) {
    const bossR = LB / 2;
    if (bossR > shaftHoleR) {
      const bossRaw = makeCylinder(oc, bossR, LE);
      const boss = translateShape(oc, bossRaw, 0, 0, 0);
      frontBracketWithHole = boolFuse(oc, frontBracketWithHole, boss);
      const bossBoreRaw = makeCylinder(oc, shaftHoleR, LE + 1);
      const bossBore = translateShape(oc, bossBoreRaw, 0, 0, -0.5);
      frontBracketWithHole = boolCut(oc, frontBracketWithHole, bossBore);
    }
  }

  // Mounting holes (apply to the front bracket / front face).
  frontBracketWithHole = drillMountingHoles(oc, frontBracketWithHole, {
    PCD_LA, M_LZ, TL_LG, LC,
  });

  // ── 2. Stator stack ──
  const statorW = LC - STATOR_INDENT * 2;
  const statorH = LH - STATOR_INDENT * 2;
  const statorLen = L2 - frontEndbellLen;
  const statorRaw = makeBox(oc, statorW, statorH, statorLen);
  const stator = translateShape(oc, statorRaw, -statorW / 2, -statorH / 2, -L2);

  // ── 3-4. Brake module + cover (when options.hasBrake) ──
  const bodies: unknown[] = [frontBracketWithHole, stator];

  if (options.hasBrake && brake) {
    // Brake module: smaller square (-2 mm per side) at axial
    // [-L2 - brakeLen, -L2].
    const brakeW = LC - BRAKE_INDENT * 2;
    const brakeH = LH - BRAKE_INDENT * 2;
    const brakeRaw = makeBox(oc, brakeW, brakeH, brakeLen);
    const brakeModule = translateShape(
      oc,
      brakeRaw,
      -brakeW / 2,
      -brakeH / 2,
      -L2 - brakeLen,
    );
    bodies.push(brakeModule);

    // Brake cover: outer = frame outline, inner = brake module — gives
    // a hollow shell around the brake module. Built as
    //   coverOuter = frame box at [-L2 - brakeLen, -L2]
    //   minus
    //   coverInner = brake module box (slightly larger to ensure a
    //                clean boolean cut)
    const coverOuterRaw = makeBox(oc, LC, LH, brakeLen);
    const coverOuter = translateShape(
      oc,
      coverOuterRaw,
      -LC / 2,
      -LH / 2,
      -L2 - brakeLen,
    );
    const coverInnerRaw = makeBox(oc, brakeW + 0.1, brakeH + 0.1, brakeLen + 0.5);
    const coverInner = translateShape(
      oc,
      coverInnerRaw,
      -(brakeW + 0.1) / 2,
      -(brakeH + 0.1) / 2,
      -L2 - brakeLen - 0.25,
    );
    const brakeCover = boolCut(oc, coverOuter, coverInner);
    bodies.push(brakeCover);
  }

  // ── 5. Encoder cap ──
  const encEndZ = -L1;
  const encStartZ = -L2 - brakeLen;
  const encLen = encStartZ - encEndZ;
  const encEffectiveLen = EnL > 0 ? Math.min(EnL, encLen) : encLen;
  if (encEffectiveLen > 0) {
    let encoder: unknown;
    if (EnW > 0) {
      const encH = EnH > 0 ? EnH : LC * 0.85;
      const encRaw = makeBox(oc, EnW, encH, encEffectiveLen);
      encoder = translateShape(oc, encRaw, -EnW / 2, -encH / 2, encEndZ + (encLen - encEffectiveLen));
    } else {
      const encR = (EnH > 0 ? EnH : LC * 0.85) / 2;
      const encRaw = makeCylinder(oc, encR, encEffectiveLen);
      encoder = translateShape(oc, encRaw, 0, 0, encEndZ + (encLen - encEffectiveLen));
    }
    bodies.push(encoder);
  }

  // ── 6. Output shaft (motor's own shaft) ──
  // When a gearhead is fitted the motor shaft becomes internal to the
  // gearhead and is invisible; we still emit it as a separate body so
  // the multi-body STEP captures the full mechanical assembly.
  const motorShaft = makeCylinder(oc, S / 2, LR);
  bodies.push(motorShaft);

  // ── 7. Oil seal ring (cosmetic, optional) ──
  if (options.hasOilSeal) {
    const sealOuterR = shaftHoleR + 0.5;
    const sealInnerR = S / 2 + 0.05; // small clearance on the shaft
    const sealThk = LC * OIL_SEAL_THK_RATIO;
    if (sealOuterR > sealInnerR && sealThk > 0) {
      // Built as outer cylinder − inner cylinder, axial [0, sealThk].
      const sealOuter = makeCylinder(oc, sealOuterR, sealThk);
      const sealInnerRaw = makeCylinder(oc, sealInnerR, sealThk + 0.4);
      const sealInner = translateShape(oc, sealInnerRaw, 0, 0, -0.2);
      const oilSeal = boolCut(oc, sealOuter, sealInner);
      bodies.push(oilSeal);
    }
  }

  // ── 8. Gearhead (when fitted) ──
  if (options.hasGearhead && gearhead) {
    const ghBody = buildGearheadBody(oc, gearhead, L1);
    bodies.push(ghBody);
    const ghShaft = buildGearheadShaft(oc, gearhead, L1);
    bodies.push(ghShaft);
  }

  // ── Merge and export ──
  const motor = mergeShapesIntoMultibodySolid(oc, bodies);

  const rawStep = exportStepBytes(oc, motor);
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
 * Drill mounting holes through the front face of the motor. Skipped
 * (returns the input unchanged) when PCD_LA / M_LZ are missing or the
 * computed positions would fall outside the frame.
 */
function drillMountingHoles(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  oc: any,
  bracket: unknown,
  args: {
    PCD_LA?: number;
    M_LZ?: string;
    TL_LG?: number;
    LC: number;
  },
): unknown {
  const { PCD_LA, M_LZ, TL_LG, LC } = args;
  if (!PCD_LA || PCD_LA <= 0) return bracket;
  const bolt = parseMountingBolt(M_LZ);
  if (!bolt) return bracket;

  const offset = (PCD_LA / 2) * Math.SQRT1_2;
  const holeR = bolt.kind === 'tap' ? bolt.M / 2 : bolt.dia / 2;
  const depth = TL_LG && TL_LG > 0 ? TL_LG : 10;
  if (offset + holeR >= LC / 2) return bracket; // outside frame — skip

  let result = bracket;
  const positions: Array<[number, number]> = [
    [+offset, +offset],
    [-offset, +offset],
    [-offset, -offset],
    [+offset, -offset],
  ];
  for (const [x, y] of positions) {
    const holeCylRaw = makeCylinder(oc, holeR, depth + 1);
    const holeCyl = translateShape(oc, holeCylRaw, x, y, -depth - 0.5);
    result = boolCut(oc, result, holeCyl);
  }
  return result;
}

/**
 * Build the gearhead body — square housing + flange (with mounting
 * bolt holes) + optional pilot bosses 1 and 2. Port of
 * `CreateGearheadBodyPart` (C++ line 3440-3544). Output occupies
 * axial [0, gearheadLen] in our motor coordinates, where gearheadLen =
 * G_LL − L1.
 */
function buildGearheadBody(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  oc: any,
  gh: GearheadDims,
  motorL1: number,
): unknown {
  const G_Length = gh.G_LL - motorL1;
  // C++ line 3459: "pure body length" (without flange) = G_Length − G_LG.
  const bodyLen = Math.max(0, G_Length - gh.G_LG);
  const G_LC = gh.G_LC;
  const halfLC = G_LC / 2;

  // Body: slightly smaller square than flange (95 % per C++ line 3470).
  const bodyW = G_LC * 0.95;
  let body: unknown;
  if (bodyLen > 0) {
    const rawBody = makeBox(oc, bodyW, bodyW, bodyLen);
    body = translateShape(oc, rawBody, -bodyW / 2, -bodyW / 2, 0);
  }

  // Flange: full G_LC × G_LC at axial [bodyLen, bodyLen + G_LG].
  const rawFlange = makeBox(oc, G_LC, G_LC, gh.G_LG);
  const flange = translateShape(oc, rawFlange, -halfLC, -halfLC, bodyLen);

  let assembly: unknown = body ? boolFuse(oc, body, flange) : flange;

  // Pilot 1 (axial [G_Length, G_Length + G_LE]) — C++ line 3491-3499.
  let pilotEndZ = G_Length;
  if (gh.G_LB && gh.G_LE && gh.G_LB > 0 && gh.G_LE > 0) {
    const p1Raw = makeCylinder(oc, gh.G_LB / 2, gh.G_LE);
    const p1 = translateShape(oc, p1Raw, 0, 0, G_Length);
    assembly = boolFuse(oc, assembly, p1);
    pilotEndZ = G_Length + gh.G_LE;
  }

  // Pilot 2 (axial [G_Length + G_LE, G_Length + G_L3]) — C++ line 3504-3513.
  if (gh.G_LD && gh.G_L3 && gh.G_LE && gh.G_LD > 0 && gh.G_L3 > gh.G_LE) {
    const p2Len = gh.G_L3 - gh.G_LE;
    const p2Raw = makeCylinder(oc, gh.G_LD / 2, p2Len);
    const p2 = translateShape(oc, p2Raw, 0, 0, pilotEndZ);
    assembly = boolFuse(oc, assembly, p2);
  }

  // Through-bore for the gearhead output shaft.
  const shaftBoreR = gh.G_S / 2 + 0.5;
  const totalLen = (gh.G_L3 ?? 0) + G_Length + 1;
  const shaftBoreRaw = makeCylinder(oc, shaftBoreR, totalLen);
  const shaftBore = translateShape(oc, shaftBoreRaw, 0, 0, -0.5);
  assembly = boolCut(oc, assembly, shaftBore);

  // Mounting holes through the flange — same 4-corner pattern as the
  // motor, sized from G_LZ on PCD = G_LA.
  if (gh.G_LA && gh.G_LZ && gh.G_LA > 0 && gh.G_LZ > 0) {
    const ghOffset = (gh.G_LA / 2) * Math.SQRT1_2;
    const ghHoleR = gh.G_LZ / 2;
    if (ghOffset + ghHoleR < halfLC) {
      const positions: Array<[number, number]> = [
        [+ghOffset, +ghOffset],
        [-ghOffset, +ghOffset],
        [-ghOffset, -ghOffset],
        [+ghOffset, -ghOffset],
      ];
      // Holes drilled through the flange (axial [bodyLen − 0.5, bodyLen + G_LG + 0.5]).
      for (const [x, y] of positions) {
        const holeRaw = makeCylinder(oc, ghHoleR, gh.G_LG + 1);
        const hole = translateShape(oc, holeRaw, x, y, bodyLen - 0.5);
        assembly = boolCut(oc, assembly, hole);
      }
    }
  }

  return assembly;
}

/**
 * Build the gearhead output shaft — a plain cylinder of G_S × G_L2
 * extending from the pilot end (or flange face when no pilots) into +Z.
 */
function buildGearheadShaft(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  oc: any,
  gh: GearheadDims,
  motorL1: number,
): unknown {
  const G_Length = gh.G_LL - motorL1;
  const pilotLen =
    gh.G_LB && gh.G_LE && gh.G_LD && gh.G_L3 ? gh.G_L3 :
    gh.G_LB && gh.G_LE ? gh.G_LE :
    0;
  const shaftStartZ = G_Length + pilotLen;
  const rawShaft = makeCylinder(oc, gh.G_S / 2, gh.G_L2);
  return translateShape(oc, rawShaft, 0, 0, shaftStartZ);
}
