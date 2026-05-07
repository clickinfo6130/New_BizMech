/**
 * Hex head — KS B 1002 / ISO 4014.
 *
 * A bolt head module exports:
 *   - `stepFaces(b, dims)`  → STEP face refs for the head
 *   - `dxfProfile(b, dims, layout)` → DXF lines for the head silhouette
 *   - `dxfExtraDims(b, dims, layout, textSize)` → head-specific dim labels
 *       (base L/Ø/H are drawn by the bolt dxf module — extras only)
 *
 * Coordinate system (STEP, shared by every head type):
 *   +Z = bolt axis, tip at +L, head at -H..0
 *   origin (0,0,0) = center of the bearing surface (head bottom plane)
 *
 * DXF (front elevation):
 *   +x = along axis (head left, tip right)
 *   +y = radial up
 *   head rectangle = x∈[-H, 0], y∈[-S/2, S/2]
 */
import type { BoltDims } from '../dimensions.js';
import { hexPrism, StepBuilder } from '../../../core/step.js';
import { DxfBuilder, line } from '../../../core/dxf.js';

export const HEX_HEAD = {
  /** STEP face list for the head, placed at the standard bolt origin. */
  stepFaces(b: StepBuilder, dims: BoltDims): string[] {
    return hexPrism(b, dims.S, dims.H, -dims.H);
  },

  /** DXF silhouette (front elevation) for the head. Uses the shared bolt coord system. */
  dxfProfile(b: DxfBuilder, dims: BoltDims): void {
    const { H, S } = dims;
    const halfS = S / 2;
    // head rectangle — three sides; the right side is drawn by the bolt
    // module so head/shaft shoulders line up whichever shaft type is used.
    line(b, -H, -halfS, -H, halfS);
    line(b, -H, halfS, 0, halfS);
    line(b, -H, -halfS, 0, -halfS);
  },
} as const;
