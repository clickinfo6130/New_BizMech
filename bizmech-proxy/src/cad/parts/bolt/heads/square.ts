/**
 * Square head — four-sided prism (KS B 1003 square-head bolt variant).
 *
 * Dimensionally analogous to Hex — `S` is across-flats, `H` is head
 * height. Uses the four-sided prism primitive for the STEP solid.
 */
import type { BoltDims } from '../dimensions.js';
import { squarePrism, StepBuilder } from '../../../core/step.js';
import { DxfBuilder, line } from '../../../core/dxf.js';

export const SQUARE_HEAD = {
  stepFaces(b: StepBuilder, dims: BoltDims): string[] {
    return squarePrism(b, dims.S, dims.H, -dims.H);
  },
  dxfProfile(b: DxfBuilder, dims: BoltDims): void {
    const { H, S } = dims;
    const halfS = S / 2;
    // Square viewed from the side looks identical to a hex rectangle.
    line(b, -H, -halfS, -H, halfS);
    line(b, -H, halfS, 0, halfS);
    line(b, -H, -halfS, 0, -halfS);
  },
} as const;
