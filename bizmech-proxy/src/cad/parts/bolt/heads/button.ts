/**
 * Button head — low-profile domed cylinder (KS B 1024).
 *
 * Shorter than pan-head, more pronounced dome. Approximated the same
 * way as pan-head (cylinder + cone cap) with different proportions
 * until opencascade.js lets us use SPHERICAL_SURFACE properly.
 */
import type { BoltDims } from '../dimensions.js';
import { coneSolid, cylinderSolid, StepBuilder } from '../../../core/step.js';
import { DxfBuilder, line } from '../../../core/dxf.js';

const DOME_HEIGHT_RATIO = 0.55;      // bigger dome share
const DOME_TOP_RADIUS_RATIO = 0.55;  // steeper taper

export const BUTTON_HEAD = {
  stepFaces(b: StepBuilder, dims: BoltDims): string[] {
    const r = dims.S / 2;
    const rTop = r * DOME_TOP_RADIUS_RATIO;
    const domeH = dims.H * DOME_HEIGHT_RATIO;
    const cylH = dims.H - domeH;
    const base = cylinderSolid(b, r, cylH, -dims.H);
    const dome = coneSolid(b, r, rTop, domeH, -dims.H + cylH);
    return [...base, ...dome];
  },
  dxfProfile(b: DxfBuilder, dims: BoltDims): void {
    const { H, S } = dims;
    const halfS = S / 2;
    const domeH = H * DOME_HEIGHT_RATIO;
    const cylH = H - domeH;
    const xDomeStart = -H + cylH;
    const topR = halfS * DOME_TOP_RADIUS_RATIO;

    line(b, -H, -halfS, -H, halfS);
    line(b, -H, halfS, xDomeStart, halfS);
    line(b, -H, -halfS, xDomeStart, -halfS);
    line(b, xDomeStart, halfS, 0, topR);
    line(b, xDomeStart, -halfS, 0, -topR);
    line(b, 0, -topR, 0, topR); // flat top end-cap
  },
} as const;
