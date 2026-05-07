/**
 * Washer DXF composer — two concentric circles (top view) plus a side
 * view showing the thickness. Dimensions: inner ø, outer ø, thickness.
 *
 * Layout (drawing — two views side by side):
 *   ┌────────────┐            ╔══╗
 *   │    ●       │  top view  ║░░║   side view (thin rectangle)
 *   │            │            ╚══╝
 *   └────────────┘
 *    di=, do=                  t=
 */
import type { CadGenerateRequest, CadGenerateResult } from '../../types.js';
import { assembleDxfFile } from '../../formats/dxf.js';
import {
  circle,
  DIAMETER_PREFIX,
  fmtLabel,
  horizontalDim,
  line,
  proportionalTextSize,
  text,
  verticalDim,
} from '../../core/dxf.js';
import type { WasherDims } from './dimensions.js';

export function buildWasherDxf(
  req: CadGenerateRequest,
  dims: WasherDims,
): CadGenerateResult {
  const ro = dims.do / 2;
  const ri = dims.di / 2;

  const scale = Math.max(dims.do, dims.t * 5);
  const textSize = proportionalTextSize(scale);
  const off = Math.max(textSize * 2.5, 4);

  // Side view is placed to the RIGHT of the top view with a gap.
  const sideGap = dims.do * 0.5;
  const sideX = ro + sideGap;

  return assembleDxfFile(req, (b) => {
    // ── Top view — two concentric circles ────────────
    circle(b, 0, 0, ro);  // outer
    circle(b, 0, 0, ri);  // inner
    // Center axes
    line(b, -ro - off * 0.5, 0, ro + off * 0.5, 0, 'DIM');
    line(b, 0, -ro - off * 0.5, 0, ro + off * 0.5, 'DIM');

    // ── Side view — thin rectangle ───────────────────
    line(b, sideX, -ro, sideX + dims.t, -ro);           // bottom
    line(b, sideX, ro, sideX + dims.t, ro);             // top
    line(b, sideX, -ro, sideX, ro);                     // left
    line(b, sideX + dims.t, -ro, sideX + dims.t, ro);   // right
    // Inner-hole hidden lines on side view
    line(b, sideX, -ri, sideX + dims.t, -ri, 'HIDDEN');
    line(b, sideX, ri, sideX + dims.t, ri, 'HIDDEN');

    // ── Dimensions ───────────────────────────────────
    // Outer diameter — below top view
    horizontalDim(
      b,
      -ro,
      ro,
      -ro,
      -ro - off,
      `${DIAMETER_PREFIX}${fmtLabel(dims.do)} (외경)`,
      textSize,
      false,
    );
    // Inner diameter — above top view
    horizontalDim(
      b,
      -ri,
      ri,
      ri,
      ro + off,
      `${DIAMETER_PREFIX}${fmtLabel(dims.di)} (내경)`,
      textSize,
      true,
    );
    // Thickness — below side view
    horizontalDim(
      b,
      sideX,
      sideX + dims.t,
      -ro,
      -ro - off,
      `t=${fmtLabel(dims.t)}`,
      textSize,
      false,
    );
    // Outer diameter on side view (total height)
    verticalDim(
      b,
      -ro,
      ro,
      sideX + dims.t,
      sideX + dims.t + off,
      `${DIAMETER_PREFIX}${fmtLabel(dims.do)}`,
      textSize,
      true,
    );

    // Title block
    const title = `${req.partCode}  ${req.keyComposite}`;
    text(b, -ro - off, ro + off + textSize * 3, textSize * 0.9, title);
    if (req.material) {
      text(
        b,
        -ro - off,
        ro + off + textSize * 1.5,
        textSize * 0.7,
        `Material: ${req.material}`,
      );
    }
  });
}
