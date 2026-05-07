/**
 * Countersunk (접시머리 / flat-head) — KS B 1017 / ISO 2009.
 *
 * The head is a frustum that TAPERS DOWN from `S` at the top to the
 * shaft diameter `d` at the bearing surface, so it sits flush with the
 * mating plate when countersunk. Standard half-angle = 45° (90° total
 * included), so H ≈ (S − d) / 2. Callers pass the DB-supplied H even
 * if it deviates from that — we honor it verbatim for accuracy.
 *
 * This file is intentionally short: it only adds the HEAD SHAPE. Shaft
 * and base-dim labels are already handled in parts/bolt/step.ts and
 * parts/bolt/dxf.ts — a new head type is a ~50-line addition.
 */
import type { BoltDims } from '../dimensions.js';
import { coneSolid, StepBuilder } from '../../../core/step.js';
import { DxfBuilder, line } from '../../../core/dxf.js';

export const COUNTERSUNK_HEAD = {
  stepFaces(b: StepBuilder, dims: BoltDims): string[] {
    // Frustum: bottom radius = d/2 (meets the shaft), top radius = S/2.
    // Positioned from z=-H (top of head) to z=0 (bearing surface).
    return coneSolid(b, dims.S / 2, dims.d / 2, dims.H, -dims.H);
  },

  dxfProfile(b: DxfBuilder, dims: BoltDims): void {
    const { H, S, d } = dims;
    const halfS = S / 2;
    const halfD = d / 2;
    // Trapezoidal silhouette — wide at the top (z=-H), narrow at bearing (z=0)
    // Top edge
    line(b, -H, -halfS, -H, halfS);
    // Slanted sides (from top corners to bearing-surface shoulder)
    line(b, -H, halfS, 0, halfD);
    line(b, -H, -halfS, 0, -halfD);
  },
} as const;
