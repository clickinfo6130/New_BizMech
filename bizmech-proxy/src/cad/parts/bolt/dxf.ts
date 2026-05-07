/**
 * DXF composition for bolts — draws the 2D front elevation with base
 * dimension labels (H, S, L, Ø). The head-specific silhouette is drawn
 * by the selected head module's `dxfProfile()`.
 *
 * Dimension layout (every bolt variant uses this same placement so
 * users get consistent drawings across the catalog):
 *
 *              H=..                 (above head)
 *          ┌─────┐
 *          │     │
 *     S=.. │     │─────────  Ø=..  (right of shaft)
 *          │     │
 *          └─────┘
 *                  L=..            (below shaft)
 */
import type { CadGenerateRequest, CadGenerateResult } from '../../types.js';
import { assembleDxfFile } from '../../formats/dxf.js';
import {
  cosmeticThread2D,
  fmtLabel,
  horizontalDim,
  line,
  proportionalTextSize,
  text,
  verticalDim,
  DIAMETER_PREFIX,
} from '../../core/dxf.js';
import type { BoltDims } from './dimensions.js';
import { headImpl, type BoltHeadKind } from './heads/index.js';

export function buildBoltDxf(
  req: CadGenerateRequest,
  dims: BoltDims,
  headKind: BoltHeadKind,
): CadGenerateResult {
  const { d, L, S, H } = dims;
  const halfS = S / 2;
  const halfD = d / 2;
  const scale = Math.max(L, 2 * halfS, 2 * halfD);
  const textSize = proportionalTextSize(scale);
  const offTop = Math.max(textSize * 2.5, 4);
  const offBottom = Math.max(textSize * 2.5, 4);
  const offLeft = Math.max(textSize * 3, 6);
  const offRight = Math.max(textSize * 3, 6);

  const head = headImpl(headKind);

  return assembleDxfFile(req, (b) => {
    // Head silhouette — variant-specific
    head.dxfProfile(b, dims);

    // Head-to-shaft shoulder — always the same (bearing surface step)
    line(b, 0, halfS, 0, halfD);
    line(b, 0, -halfS, 0, -halfD);

    // Shaft outline — always the outer (major) diameter
    line(b, 0, halfD, L, halfD);
    line(b, 0, -halfD, L, -halfD);
    line(b, L, -halfD, L, halfD);

    // Cosmetic thread — drawn INSIDE the shaft outline in the thread
    // region (from the tip backward by `threadLength`). Matches ISO
    // 6410 / ASME Y14.6 male-thread convention.
    if (dims.threadLength > 0 && dims.minorD > 0 && dims.minorD < d) {
      const xThreadStart = L - dims.threadLength;
      cosmeticThread2D(b, xThreadStart, L, dims.minorD / 2, true);
    }

    // Center axis
    line(b, -H - offLeft * 0.5, 0, L + offRight * 0.5, 0, 'DIM');

    // Dimensions — four orientations, never overlapping
    horizontalDim(b, -H, 0, halfS, halfS + offTop, `H=${fmtLabel(H)}`, textSize, true);
    horizontalDim(
      b,
      0,
      L,
      -halfD,
      -Math.max(halfS, halfD) - offBottom,
      `L=${fmtLabel(L)}`,
      textSize,
      false,
    );
    verticalDim(b, -halfS, halfS, -H, -H - offLeft, `S=${fmtLabel(S)}`, textSize, false);
    verticalDim(
      b,
      -halfD,
      halfD,
      L,
      L + offRight,
      `${DIAMETER_PREFIX}${fmtLabel(d)}`,
      textSize,
      true,
    );

    // Thread designation label ("M10×1.5") near the thread region.
    if (dims.threadDesignation && dims.threadLength > 0) {
      const xLabel = L - dims.threadLength / 2 - (dims.threadDesignation.length * textSize) / 4;
      const yLabel = halfD + textSize * 0.6;
      text(b, xLabel, yLabel, textSize * 0.9, dims.threadDesignation);
    }

    // Title block (top-left, small)
    const title = `${req.partCode}  ${req.keyComposite}`;
    text(b, -H - offLeft, halfS + offTop + textSize * 2.5, textSize * 0.9, title);
    if (req.material) {
      text(
        b,
        -H - offLeft,
        halfS + offTop + textSize * 1.2,
        textSize * 0.7,
        `Material: ${req.material}`,
      );
    }
  });
}
