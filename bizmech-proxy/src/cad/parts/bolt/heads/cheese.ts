/**
 * Cheese head — cylindrical head (KS B 1012 / slotted cheese).
 *
 * The simplest round head: a plain cylinder with outer diameter `S`
 * (treated as diameter for round heads; the core dim still calls it
 * `S` for uniformity with hex across-flats). No taper, no dome.
 */
import type { BoltDims } from '../dimensions.js';
import { cylinderSolid, StepBuilder } from '../../../core/step.js';
import { DxfBuilder, line } from '../../../core/dxf.js';

export const CHEESE_HEAD = {
  stepFaces(b: StepBuilder, dims: BoltDims): string[] {
    return cylinderSolid(b, dims.S / 2, dims.H, -dims.H);
  },
  dxfProfile(b: DxfBuilder, dims: BoltDims): void {
    const { H, S } = dims;
    const halfS = S / 2;
    line(b, -H, -halfS, -H, halfS);   // left (top in side view)
    line(b, -H, halfS, 0, halfS);     // top
    line(b, -H, -halfS, 0, -halfS);   // bottom
  },
} as const;
