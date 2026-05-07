/**
 * Sems head — hex head with a captive (permanently attached) washer.
 *
 * Geometry is mechanically similar to hex-flange but the "flange"
 * here is an annular captive washer (has a hole so it still slides
 * freely around the shaft). Dimensionally:
 *   · Upper: hex prism, across-flats `S`, height (H − tWasher)
 *   · Lower: annular washer, outer diameter ≈ 1.5·S, inner hole = d
 *     (shaft diameter), thickness tWasher
 */
import type { BoltDims } from '../dimensions.js';
import { annularSolid, hexPrism, StepBuilder } from '../../../core/step.js';
import { DxfBuilder, line } from '../../../core/dxf.js';

const WASHER_THICKNESS_RATIO = 0.3;
const WASHER_OUTER_RATIO = 1.5;

export const SEMS_HEAD = {
  stepFaces(b: StepBuilder, dims: BoltDims): string[] {
    const tWasher = dims.H * WASHER_THICKNESS_RATIO;
    const hHex = dims.H - tWasher;
    const rWasher = (dims.S * WASHER_OUTER_RATIO) / 2;
    // Hex on top, captive annular washer at the base. Inner hole ~shaft.
    const hex = hexPrism(b, dims.S, hHex, -hHex);
    const washer = annularSolid(b, rWasher, dims.d / 2 + 0.05, tWasher, -dims.H);
    return [...hex, ...washer];
  },
  dxfProfile(b: DxfBuilder, dims: BoltDims): void {
    const { H, S, d } = dims;
    const halfS = S / 2;
    const halfD = d / 2;
    const tWasher = H * WASHER_THICKNESS_RATIO;
    const rWasher = (S * WASHER_OUTER_RATIO) / 2;
    const xWasherTop = -H + tWasher;

    // Hex portion
    line(b, xWasherTop, -halfS, xWasherTop, halfS);
    line(b, xWasherTop, halfS, 0, halfS);
    line(b, xWasherTop, -halfS, 0, -halfS);
    // Washer — ring: outer edges + inner-hole edges (inner hole = shaft ø)
    line(b, -H, -rWasher, -H, -halfD);
    line(b, -H, halfD, -H, rWasher);
    line(b, -H, rWasher, xWasherTop, rWasher);
    line(b, -H, -rWasher, xWasherTop, -rWasher);
    // Inner hole edges (visible on side view as a gap at the shaft)
    line(b, -H, halfD, xWasherTop, halfD);
    line(b, -H, -halfD, xWasherTop, -halfD);
    // Transitions from washer to hex
    line(b, xWasherTop, rWasher, xWasherTop, halfS);
    line(b, xWasherTop, -rWasher, xWasherTop, -halfS);
  },
} as const;
