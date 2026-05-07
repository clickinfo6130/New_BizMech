/**
 * Hex flange head — hex head with an integrated circular flange at
 * the base (KS B 1002-style / ISO 4162 / DIN 6921).
 *
 * Geometry:
 *   · Upper: regular hex prism, across-flats `S`, height (H − tFlange)
 *   · Lower: solid round flange, diameter ≈ 1.4·S, thickness tFlange
 *
 * When the DB doesn't carry an explicit flange diameter / thickness
 * we derive them from S and H: tFlange = 0.25·H, flangeD = 1.4·S.
 * These are plausible bolt-catalog proportions; the variant's exact
 * C++ class in the Source folder can override via dims later.
 */
import type { BoltDims } from '../dimensions.js';
import { cylinderSolid, hexPrism, StepBuilder } from '../../../core/step.js';
import { DxfBuilder, line } from '../../../core/dxf.js';

const FLANGE_THICKNESS_RATIO = 0.25;
const FLANGE_DIAMETER_RATIO = 1.4;

export const HEX_FLANGE_HEAD = {
  stepFaces(b: StepBuilder, dims: BoltDims): string[] {
    const tFlange = dims.H * FLANGE_THICKNESS_RATIO;
    const hHex = dims.H - tFlange;
    const rFlange = (dims.S * FLANGE_DIAMETER_RATIO) / 2;
    // Hex on top (z: -(H-tFlange) .. 0), flange on bottom (z: -H .. -(H-tFlange))
    const hex = hexPrism(b, dims.S, hHex, -hHex);
    const flange = cylinderSolid(b, rFlange, tFlange, -dims.H);
    return [...hex, ...flange];
  },
  dxfProfile(b: DxfBuilder, dims: BoltDims): void {
    const { H, S } = dims;
    const halfS = S / 2;
    const tFlange = H * FLANGE_THICKNESS_RATIO;
    const rFlange = (S * FLANGE_DIAMETER_RATIO) / 2;
    const xFlangeTop = -H + tFlange; // where hex meets flange
    // Hex portion (rectangle)
    line(b, xFlangeTop, -halfS, xFlangeTop, halfS);     // boundary hex/flange
    line(b, xFlangeTop, halfS, 0, halfS);
    line(b, xFlangeTop, -halfS, 0, -halfS);
    // Flange portion (wider rectangle)
    line(b, -H, -rFlange, -H, rFlange);
    line(b, -H, rFlange, xFlangeTop, rFlange);
    line(b, -H, -rFlange, xFlangeTop, -rFlange);
    // Step (transition from flange radius down to hex across-flats)
    line(b, xFlangeTop, rFlange, xFlangeTop, halfS);
    line(b, xFlangeTop, -rFlange, xFlangeTop, -halfS);
  },
} as const;
