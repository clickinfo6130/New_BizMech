/**
 * DXF generator for plummer block (SD / SN). Three views matching
 * standard mechanical drawing convention:
 *
 *   · Side view (X-Z plane) — shows the foot footprint, the body
 *     above, and the dome on top. The bearing bore is drawn as a
 *     hidden circle in the centre.
 *   · Front view (Y-Z plane) — shaft-axis end view: shows the dome
 *     outline + foot + mounting slot positions + cap bolt holes.
 *   · Top view (X-Z plane from above) — the foot rectangle with
 *     mounting slot positions.
 *
 * Coordinate convention matches `step-occt-plummer.ts`:
 *   X = shaft axis · Y = vertical · Z = lengthwise.
 * For the DXF we drop into 2D (no Y-axis): each view is a planar
 * projection.
 */
import type { CadGenerateRequest, CadGenerateResult } from '../../types.js';
import { assembleDxfFile } from '../../formats/dxf.js';
import {
  arc,
  circle,
  fmtLabel,
  horizontalDim,
  line,
  proportionalTextSize,
  text,
  verticalDim,
} from '../../core/dxf.js';
import type { PlummerBlockDims } from './dimensions-plummer.js';

export function buildPlummerBlockDxf(
  req: CadGenerateRequest,
  dims: PlummerBlockDims,
): CadGenerateResult {
  const { d1, D2, A, A1, L, H, H1, H2, J, J1, N, g, capBoltM, capBoltCount } = dims;
  const halfA = A / 2;
  const halfL = L / 2;
  const halfA1 = A1 / 2;
  const halfJ = J / 2;
  const halfJ1 = J1 / 2;
  const domeR = D2 / 2 + 18;

  const scale = Math.max(L, H2);
  const textSize = proportionalTextSize(scale);
  const off = Math.max(textSize * 2.5, 4);

  // Layout: side view at origin, front view to right, top view below.
  const frontOriginX = halfL + L * 0.5; // gap between views
  const topOriginY = -H - L * 0.5;

  return assembleDxfFile(req, (b) => {
    // ── Side view (X horizontal, Y vertical) ──
    // Coord here uses Z (lengthwise) as the horizontal axis since
    // Y is vertical and X (shaft axis) is into the page.
    // Foot rectangle: -L/2 to +L/2 horizontally, -H to -H+H1 vertically.
    const ftBottom = -H;
    const ftTop = -H + H1;
    const splitY = 0;
    const domeTop = H2 - H;

    // Foot
    line(b, -halfL, ftBottom, halfL, ftBottom);
    line(b, halfL, ftBottom, halfL, ftTop);
    line(b, halfL, ftTop, -halfL, ftTop);
    line(b, -halfL, ftTop, -halfL, ftBottom);

    // Lower body (above foot, narrower)
    const bodyZHalf = Math.max(g + 20, D2 + 20) / 2;
    line(b, -bodyZHalf, ftTop, -bodyZHalf, splitY);
    line(b, bodyZHalf, ftTop, bodyZHalf, splitY);
    line(b, -bodyZHalf, splitY, bodyZHalf, splitY, 'CENTER'); // split line

    // Upper dome (rectangle with rounded top — drawn as rectangle here)
    line(b, -bodyZHalf, splitY, -bodyZHalf, domeTop);
    line(b, bodyZHalf, splitY, bodyZHalf, domeTop);
    line(b, -bodyZHalf, domeTop, bodyZHalf, domeTop);

    // Bearing bore (hidden circle on side view — concentric at origin)
    circle(b, 0, 0, D2 / 2, 'HIDDEN');
    circle(b, 0, 0, d1 / 2);
    line(b, -halfL - off, 0, halfL + off, 0, 'CENTER'); // shaft axis line

    // Mounting slot indicators on the side view
    for (const slotZ of [halfJ, -halfJ]) {
      circle(b, slotZ, ftBottom + H1 / 2, N / 2, 'HIDDEN');
    }

    // Cap bolt holes (vertical holes — appear as hidden lines on side view)
    for (const cz of [halfJ1, -halfJ1]) {
      line(b, cz, splitY, cz, domeTop, 'HIDDEN');
      line(b, cz - capBoltM / 2, splitY, cz - capBoltM / 2, domeTop, 'HIDDEN');
      line(b, cz + capBoltM / 2, splitY, cz + capBoltM / 2, domeTop, 'HIDDEN');
    }

    // ── Front view (X horizontal = shaft axis, Y vertical) ──
    // Foot
    line(b, frontOriginX - halfA, ftBottom, frontOriginX + halfA, ftBottom);
    line(b, frontOriginX + halfA, ftBottom, frontOriginX + halfA, ftTop);
    line(b, frontOriginX + halfA, ftTop, frontOriginX - halfA, ftTop);
    line(b, frontOriginX - halfA, ftTop, frontOriginX - halfA, ftBottom);
    // Body
    line(b, frontOriginX - halfA1, ftTop, frontOriginX - halfA1, splitY);
    line(b, frontOriginX + halfA1, ftTop, frontOriginX + halfA1, splitY);
    line(b, frontOriginX - halfA1, splitY, frontOriginX + halfA1, splitY, 'CENTER');
    // Upper dome — semi-circle
    arc(b, frontOriginX, splitY, domeR, 0, 180);
    // Bearing bore (visible circle)
    circle(b, frontOriginX, 0, D2 / 2);
    circle(b, frontOriginX, 0, d1 / 2);
    line(b, frontOriginX - domeR - off, 0, frontOriginX + domeR + off, 0, 'CENTER');
    line(b, frontOriginX, ftBottom - off, frontOriginX, domeTop + off, 'CENTER');

    // Cap bolt holes — appear as small circles on top of the dome in
    // front view (on either side of the shaft when 4-bolt).
    if (capBoltCount === 4) {
      // Visible from front: cap bolts pairs at +Z and -Z each have 2
      // bolts at ±cbX. We can't show all 4 in front view (X axis is
      // out of plane), so we just show the lateral spacing.
      const cbX = J1 * 0.4;
      for (const dx of [+cbX, -cbX]) {
        line(b, frontOriginX + dx, splitY, frontOriginX + dx, domeTop, 'HIDDEN');
      }
    } else {
      line(b, frontOriginX, splitY, frontOriginX, domeTop, 'HIDDEN');
    }

    // ── Top view (X horizontal = shaft axis, Z vertical = lengthwise) ──
    // Foot rectangle as seen from above.
    line(b, -halfA, topOriginY - halfL, halfA, topOriginY - halfL);
    line(b, halfA, topOriginY - halfL, halfA, topOriginY + halfL);
    line(b, halfA, topOriginY + halfL, -halfA, topOriginY + halfL);
    line(b, -halfA, topOriginY + halfL, -halfA, topOriginY - halfL);

    // Mounting slots
    for (const slotZ of [halfJ, -halfJ]) {
      circle(b, 0, topOriginY + slotZ, N / 2);
    }

    // Body footprint (smaller rectangle on top view, hidden)
    line(b, -halfA1, topOriginY - bodyZHalf, halfA1, topOriginY - bodyZHalf, 'HIDDEN');
    line(b, halfA1, topOriginY - bodyZHalf, halfA1, topOriginY + bodyZHalf, 'HIDDEN');
    line(b, halfA1, topOriginY + bodyZHalf, -halfA1, topOriginY + bodyZHalf, 'HIDDEN');
    line(b, -halfA1, topOriginY + bodyZHalf, -halfA1, topOriginY - bodyZHalf, 'HIDDEN');
    // Dome OD as seen from above (hidden)
    circle(b, 0, topOriginY, domeR, 'HIDDEN');
    // Bearing bore
    circle(b, 0, topOriginY, D2 / 2);

    // Cap bolt hole pattern from above
    if (capBoltCount === 4) {
      const cbX = J1 * 0.4;
      const positions: Array<[number, number]> = [
        [+cbX, +halfJ1],
        [-cbX, +halfJ1],
        [+cbX, -halfJ1],
        [-cbX, -halfJ1],
      ];
      for (const [x, z] of positions) {
        circle(b, x, topOriginY + z, capBoltM / 2);
      }
    } else {
      for (const z of [+halfJ1, -halfJ1]) {
        circle(b, 0, topOriginY + z, capBoltM / 2);
      }
    }

    // ── Dimensions ──
    horizontalDim(b, -halfL, halfL, -H - off * 2, -H - off * 3,
      `L=${fmtLabel(L)}`, textSize);
    horizontalDim(b, -halfJ, halfJ, -H - off * 4, -H - off * 5,
      `J=${fmtLabel(J)}`, textSize);
    verticalDim(b, ftBottom, domeTop,
      halfL + off, halfL + off * 2,
      `H2=${fmtLabel(H2)}`, textSize);
    horizontalDim(b, frontOriginX - halfA, frontOriginX + halfA,
      ftBottom - off * 2, ftBottom - off * 3,
      `A=${fmtLabel(A)}`, textSize);

    // Title
    text(b, 0, ftBottom - off * 6, textSize * 1.3,
      `${req.partCode}  Ø${fmtLabel(d1)}×Ø${fmtLabel(D2)}  L=${fmtLabel(L)}  ${capBoltCount}-M${fmtLabel(capBoltM)} cap`);
  });
}
