/**
 * Socket head (hex socket / Allen cap screw) — KS B 1003 / ISO 4762.
 *
 * 3D geometry: a plain cylinder for the outer head. The hex socket
 * CUT on the top is skipped in Phase 1.5 because boolean subtraction
 * is hard to hand-write in STEP; it arrives in Phase 2 via
 * opencascade.js's BRepAlgoAPI_Cut.
 *
 * 2D (DXF) DOES show the socket clearly as a gap in the top edge —
 * designers can identify the bolt type at a glance even when the 3D
 * model is the simplified version. The socket's across-flats is
 * derived from S unless the DB carries it explicitly.
 *
 * Socket AF (across-flats) typical: ~0.55·d (for d ≤ 24mm).
 */
import type { BoltDims } from '../dimensions.js';
import { cylinderSolid, StepBuilder } from '../../../core/step.js';
import { DxfBuilder, line } from '../../../core/dxf.js';

const SOCKET_AF_RATIO = 0.55;     // socket across-flats ≈ 0.55 × d
const SOCKET_DEPTH_RATIO = 0.5;   // socket depth ≈ 0.5 × H

export const SOCKET_HEAD = {
  stepFaces(b: StepBuilder, dims: BoltDims): string[] {
    // Outer head — plain cylinder of diameter S, height H.
    return cylinderSolid(b, dims.S / 2, dims.H, -dims.H);
  },
  dxfProfile(b: DxfBuilder, dims: BoltDims): void {
    const { H, S, d } = dims;
    const halfS = S / 2;
    const socketAF = d * SOCKET_AF_RATIO;
    const halfSocket = socketAF / 2;
    const socketDepth = H * SOCKET_DEPTH_RATIO;

    // Outer cylinder silhouette (rectangle)
    line(b, -H, -halfS, -H, halfS);     // top of head (far side in side view)
    // Top edge is interrupted by the socket opening — draw two segments:
    line(b, -H, halfS, 0, halfS);       // bearing surface side (bottom in bolt coord)
    line(b, -H, -halfS, 0, -halfS);     // bearing surface side mirror
    // Split the "top of head" edge (at x=-H) to show the socket opening in 2D
    // is inside. Actually socket opens on the TOP face (x=-H in our coords);
    // we show it as a rectangular pocket drilled into the end face.
    line(b, -H + socketDepth, -halfSocket, -H, -halfSocket); // bottom of socket
    line(b, -H + socketDepth, halfSocket, -H, halfSocket);   // top of socket
    line(b, -H + socketDepth, -halfSocket, -H + socketDepth, halfSocket); // socket floor
  },
} as const;
