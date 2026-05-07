/**
 * Pan head — rounded top cylinder (KS B 1022 / Pan-head screw).
 *
 * Approximated as a cylinder + truncated-cone cap. The real pan-head
 * has a gentle spherical dome; Phase 2 (opencascade.js) will replace
 * this with a proper spherical cap. For the MVP the cone approximation
 * clearly distinguishes pan-head from flat-head in both 3D and 2D
 * while preserving the user-facing dimensions `S` and `H`.
 *
 * Proportions:
 *   · dome takes the top 30% of head height
 *   · dome top radius = 70% of head radius (gentle taper)
 */
import type { BoltDims } from '../dimensions.js';
import { coneSolid, cylinderSolid, StepBuilder } from '../../../core/step.js';
import { arc, DxfBuilder, line } from '../../../core/dxf.js';

const DOME_HEIGHT_RATIO = 0.3;
const DOME_TOP_RADIUS_RATIO = 0.7;

export const PAN_HEAD = {
  stepFaces(b: StepBuilder, dims: BoltDims): string[] {
    const r = dims.S / 2;
    const rTop = r * DOME_TOP_RADIUS_RATIO;
    const domeH = dims.H * DOME_HEIGHT_RATIO;
    const cylH = dims.H - domeH;
    // Base cylinder
    const base = cylinderSolid(b, r, cylH, -dims.H);
    // Dome (cone frustum) stacked on top
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

    // Base rectangle (up to dome start)
    line(b, -H, -halfS, -H, halfS);       // left edge (bottom)
    line(b, -H, halfS, xDomeStart, halfS); // along shaft-axis, upper
    line(b, -H, -halfS, xDomeStart, -halfS); // along shaft-axis, lower
    // Dome — straight chamfer approximation + small arc top (cosmetic)
    line(b, xDomeStart, halfS, 0, topR);   // slant upper
    line(b, xDomeStart, -halfS, 0, -topR); // slant lower
    // Top edge of dome
    arc(b, 0, 0, topR, 270, 90);
    void arc; // avoid unused import pruning when arc is conditionally drawn
  },
} as const;
