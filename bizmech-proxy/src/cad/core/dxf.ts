/**
 * DXF engine — part-agnostic primitives and dimension annotations.
 *
 * Targets DXF R12 (AC1009) so every CAD reads it (AutoCAD, ZW3D,
 * GStarCAD, CADian, FreeCAD, LibreCAD). R12 has no native DIMENSION
 * entity, so we emit extension/dim lines + tick marks + a TEXT label
 * as primitives. The label is always visible at import time because
 * it's static geometry, not a CAD-computed annotation.
 *
 * Nothing here is part-specific — bolt/nut/washer generators compose
 * from these helpers in their own `dxf.ts` module.
 */

/** Fluent DXF group-code emitter. */
export class DxfBuilder {
  private lines: string[] = [];
  code(n: number, v: string | number): void {
    this.lines.push(String(n));
    this.lines.push(typeof v === 'number' ? fmt(v) : v);
  }
  raw(s: string): void {
    this.lines.push(s);
  }
  render(): string {
    return `${this.lines.join('\r\n')}\r\n`;
  }
}

export function fmt(n: number): string {
  const s = Number(n.toFixed(6)).toString();
  return s.includes('.') ? s : `${s}.0`;
}

export function fmtLabel(n: number): string {
  return Number(n.toFixed(3)).toString();
}

// ─────────────────────────────────────────────────────────────────────
// Primitives
// ─────────────────────────────────────────────────────────────────────

export function line(
  b: DxfBuilder,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  layer = '0',
): void {
  b.raw('0\r\nLINE');
  b.raw(`8\r\n${layer}`);
  b.code(10, x1);
  b.code(20, y1);
  b.code(30, 0);
  b.code(11, x2);
  b.code(21, y2);
  b.code(31, 0);
}

export function circle(
  b: DxfBuilder,
  cx: number,
  cy: number,
  r: number,
  layer = '0',
): void {
  b.raw('0\r\nCIRCLE');
  b.raw(`8\r\n${layer}`);
  b.code(10, cx);
  b.code(20, cy);
  b.code(30, 0);
  b.code(40, r);
}

export function arc(
  b: DxfBuilder,
  cx: number,
  cy: number,
  r: number,
  startDeg: number,
  endDeg: number,
  layer = '0',
): void {
  b.raw('0\r\nARC');
  b.raw(`8\r\n${layer}`);
  b.code(10, cx);
  b.code(20, cy);
  b.code(30, 0);
  b.code(40, r);
  b.code(50, startDeg);
  b.code(51, endDeg);
}

export function text(
  b: DxfBuilder,
  x: number,
  y: number,
  size: number,
  content: string,
  layer = 'DIM',
  angle = 0,
): void {
  b.raw('0\r\nTEXT');
  b.raw(`8\r\n${layer}`);
  b.code(10, x);
  b.code(20, y);
  b.code(30, 0);
  b.code(40, size);
  b.code(1, content);
  if (angle !== 0) b.code(50, angle);
}

export function emitLayer(b: DxfBuilder, name: string, color: number): void {
  b.raw('0\r\nLAYER');
  b.code(2, name);
  b.code(70, 0);
  b.code(62, color);
  b.code(6, 'CONTINUOUS');
}

// ─────────────────────────────────────────────────────────────────────
// Dimension annotations — four orientations, never overlap.
// Each emits: 2 extension lines + 1 dim line + 2 tick marks + text label.
// ─────────────────────────────────────────────────────────────────────

/** Horizontal measurement — dim line ABOVE (when yDim > y) or BELOW. */
export function horizontalDim(
  b: DxfBuilder,
  x1: number,
  x2: number,
  y: number,
  yDim: number,
  label: string,
  textSize: number,
  textOnTop = true,
): void {
  const tick = textSize * 0.6;
  const extBeyond = Math.sign(yDim - y) * tick;
  line(b, x1, y, x1, yDim + extBeyond, 'DIM');
  line(b, x2, y, x2, yDim + extBeyond, 'DIM');
  line(b, x1, yDim, x2, yDim, 'DIM');
  line(b, x1 - tick, yDim - tick, x1 + tick, yDim + tick, 'DIM');
  line(b, x2 - tick, yDim - tick, x2 + tick, yDim + tick, 'DIM');
  const tx = (x1 + x2) / 2 - (label.length * textSize) / 4;
  const ty = textOnTop ? yDim + textSize * 0.4 : yDim - textSize * 1.4;
  text(b, tx, ty, textSize, label);
}

/** Vertical measurement — dim line to LEFT or RIGHT of the span. */
export function verticalDim(
  b: DxfBuilder,
  y1: number,
  y2: number,
  x: number,
  xDim: number,
  label: string,
  textSize: number,
  textOnRight = true,
): void {
  const tick = textSize * 0.6;
  const extBeyond = Math.sign(xDim - x) * tick;
  line(b, x, y1, xDim + extBeyond, y1, 'DIM');
  line(b, x, y2, xDim + extBeyond, y2, 'DIM');
  line(b, xDim, y1, xDim, y2, 'DIM');
  line(b, xDim - tick, y1 - tick, xDim + tick, y1 + tick, 'DIM');
  line(b, xDim - tick, y2 - tick, xDim + tick, y2 + tick, 'DIM');
  const ty = (y1 + y2) / 2 - textSize / 2;
  const tx = textOnRight
    ? xDim + textSize * 0.4
    : xDim - textSize * 0.4 - (label.length * textSize) / 1.6;
  text(b, tx, ty, textSize, label);
}

/** Diameter label prefix — CAD escape for the Ø symbol. */
export const DIAMETER_PREFIX = '%%C';
/** Plus/minus prefix (±). */
export const PLUSMINUS_PREFIX = '%%P';
/** Degree suffix (°). */
export const DEGREE_SUFFIX = '%%D';

/**
 * Proportional text size for a drawing whose bounding box has extent
 * `scale` in either axis. Clamped to keep tiny parts readable and huge
 * parts from swallowing the drawing with giant labels.
 */
export function proportionalTextSize(scale: number, min = 1.2, max = 8): number {
  return Math.max(min, Math.min(scale / 15, max));
}

// ─────────────────────────────────────────────────────────────────────
// Standard layers — used by all parts. Keep the names stable so user's
// layer filters / linetypes transfer between downloads.
// ─────────────────────────────────────────────────────────────────────

export const LAYERS = {
  /** Solid outlines (white by default — CAD usually maps white→black on light bg). */
  GEOMETRY: { name: '0', color: 7 },
  /** Dimension lines, tick marks, and labels (green). */
  DIM: { name: 'DIM', color: 3 },
  /** Center axes / hidden details (cyan). */
  CENTER: { name: 'CENTER', color: 4 },
  /** Hidden edges (yellow). */
  HIDDEN: { name: 'HIDDEN', color: 2 },
} as const;

/** Emit the standard layer table (GEOMETRY / DIM / CENTER / HIDDEN). */
export function emitStandardLayers(b: DxfBuilder): void {
  for (const v of Object.values(LAYERS)) emitLayer(b, v.name, v.color);
}

// ─────────────────────────────────────────────────────────────────────
// Thread representation — ISO 6410 / ASME Y14.6 cosmetic thread
// ─────────────────────────────────────────────────────────────────────

/**
 * Cosmetic thread lines for a 2D side view of a threaded shaft.
 *
 * In industry standard drawings a cylindrical male thread is drawn as:
 *   · Major-diameter lines (solid) — the shaft outer edges
 *   · Minor-diameter lines (thin solid or HIDDEN line-type) drawn
 *     inside the shaft outline
 *   · Start/end of thread marked by a solid line across the shaft
 *
 * This helper draws just the minor-diameter lines + optional start/end
 * markers. The caller already drew the major-diameter shaft outline.
 *
 * @param xStart  axial position where the thread starts (smaller x)
 * @param xEnd    axial position where the thread ends (larger x, tip)
 * @param minorR  thread minor radius (d_minor / 2)
 * @param markStart  draw a vertical line at xStart to mark thread begin
 */
export function cosmeticThread2D(
  b: DxfBuilder,
  xStart: number,
  xEnd: number,
  minorR: number,
  markStart = true,
): void {
  // Two parallel minor-diameter lines on HIDDEN layer (yellow).
  line(b, xStart, minorR, xEnd, minorR, LAYERS.HIDDEN.name);
  line(b, xStart, -minorR, xEnd, -minorR, LAYERS.HIDDEN.name);
  if (markStart) {
    // Solid cross-line at the thread-start boundary (drawn on GEOMETRY).
    line(b, xStart, -minorR, xStart, minorR, LAYERS.GEOMETRY.name);
  }
}
