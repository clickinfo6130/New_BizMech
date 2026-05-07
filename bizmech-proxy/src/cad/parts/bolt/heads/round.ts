/**
 * Round (hemispherical) head — tall, heavily-domed head.
 *
 * More pronounced than button-head; approaches a half-sphere shape.
 * Approximated as a single truncated cone for MVP — this is the
 * largest geometric compromise versus reality; opencascade.js will
 * replace this with a true hemisphere SPHERICAL_SURFACE in Phase 2.
 */
import type { BoltDims } from '../dimensions.js';
import { coneSolid, StepBuilder } from '../../../core/step.js';
import { DxfBuilder, line } from '../../../core/dxf.js';

/** How sharp the point is — 0.3 gives a half-dome look. */
const DOME_TOP_RADIUS_RATIO = 0.3;

export const ROUND_HEAD = {
  stepFaces(b: StepBuilder, dims: BoltDims): string[] {
    const r = dims.S / 2;
    const rTop = r * DOME_TOP_RADIUS_RATIO;
    // Single cone spanning the whole head height — looks like a dome.
    return coneSolid(b, r, rTop, dims.H, -dims.H);
  },
  dxfProfile(b: DxfBuilder, dims: BoltDims): void {
    const { H, S } = dims;
    const halfS = S / 2;
    const topR = halfS * DOME_TOP_RADIUS_RATIO;
    // Triangular silhouette — broad base to narrow top
    line(b, -H, -halfS, -H, halfS);
    line(b, -H, halfS, 0, topR);
    line(b, -H, -halfS, 0, -topR);
    line(b, 0, -topR, 0, topR);
  },
} as const;
