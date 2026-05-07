/**
 * DXF generator for the Oilless family. Six shape types — each with
 * its own 2D representation:
 *
 *   Sleeve       — hollow cylinder         → side: rectangle, front: 2 circles
 *   Flange       — flanged sleeve          → side: stepped rectangle, front: 3 circles (bore/OD/flangeOD)
 *   ThrustWasher — flat annular disc       → side: thin rectangle, front: 2 circles
 *   Plate        — rectangular block       → side: rectangle (no front view)
 *   Spherical    — sleeve with arc-OD      → side: rectangle with bulge arc, front: 2 circles
 *   Pin          — solid pin (± head)      → side: solid rectangle (+ optional head step), front: 1 circle
 *
 * Dimension contracts vary per shape: Plate uses B/L/T (no d1/D2),
 * Pin uses D2/L/optional FD/T, others use d1/D2/L/T as documented in
 * `step-occt-oilless.ts`. This DXF generator reads `req.dimensions`
 * directly, mirroring the STEP generator.
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
import { classifyOillessShape } from './step-occt-oilless.js';

export function buildOillessDxf(req: CadGenerateRequest): CadGenerateResult {
  const shape = classifyOillessShape(req.partCode);
  if (!shape) {
    throw new Error(
      `Oilless DXF: partCode "${req.partCode}" did not match any known shape pattern.`,
    );
  }
  const isDry = req.partCode.toUpperCase().includes('DRY');

  switch (shape) {
    case 'Sleeve':       return buildSleeveDxf(req, isDry);
    case 'Flange':       return buildFlangeDxf(req);
    case 'ThrustWasher': return buildThrustWasherDxf(req);
    case 'Plate':        return buildPlateDxf(req);
    case 'Spherical':    return buildSphericalDxf(req);
    case 'Pin':          return buildPinDxf(req);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Shape-specific DXFs
// ─────────────────────────────────────────────────────────────────────

function buildSleeveDxf(req: CadGenerateRequest, isDry: boolean): CadGenerateResult {
  const d1 = readPositive(req, 'd1', 'd', 'bore', '내경') ?? 15;
  let D2 = readPositive(req, 'D2', 'D', 'OD', '외경');
  const L = readPositive(req, 'L', 'length', '길이') ?? 30;
  if (D2 == null) D2 = isDry ? d1 + 1.5 : 20;

  const innerR = d1 / 2;
  const outerR = D2 / 2;
  const scale = Math.max(D2, L);
  const textSize = proportionalTextSize(scale);
  const off = Math.max(textSize * 2.5, 4);
  const frontCx = L + outerR + D2 * 0.5;

  return assembleDxfFile(req, (b) => {
    // Side view: rectangle from (0, ±innerR) to (L, ±outerR).
    for (const sgn of [1, -1] as const) {
      line(b, 0, sgn * innerR, L, sgn * innerR);
      line(b, 0, sgn * outerR, L, sgn * outerR);
      line(b, 0, sgn * innerR, 0, sgn * outerR);
      line(b, L, sgn * innerR, L, sgn * outerR);
    }
    line(b, -off, 0, L + off, 0, 'CENTER');

    // Front view — 2 circles.
    circle(b, frontCx, 0, outerR);
    circle(b, frontCx, 0, innerR);
    line(b, frontCx - outerR - off, 0, frontCx + outerR + off, 0, 'CENTER');
    line(b, frontCx, -outerR - off, frontCx, outerR + off, 'CENTER');

    horizontalDim(b, 0, L, -outerR - off, -outerR - off * 2,
      `L=${fmtLabel(L)}`, textSize);
    verticalDim(b, -innerR, innerR,
      frontCx + outerR + off, frontCx + outerR + off * 2,
      `Ø${fmtLabel(d1)}`, textSize);
    verticalDim(b, -outerR, outerR,
      frontCx + outerR + off * 4, frontCx + outerR + off * 5,
      `Ø${fmtLabel(D2)}`, textSize);
    text(b, 0, -outerR - off * 4, textSize * 1.3,
      `${req.partCode}  Ø${d1}×Ø${D2}×${L}`);
  });
}

function buildFlangeDxf(req: CadGenerateRequest): CadGenerateResult {
  const d1 = readPositive(req, 'd1', 'd', 'bore') ?? 15;
  const D2 = readPositive(req, 'D2', 'D', 'OD') ?? 20;
  const FD = readPositive(req, 'FD', 'flangeOD') ?? 25;
  const T = readPositive(req, 'T', 'thickness', '두께') ?? 5;
  const L = readPositive(req, 'L', 'length') ?? 30;

  const innerR = d1 / 2;
  const outerR = D2 / 2;
  const flangeR = FD / 2;
  const scale = Math.max(FD, L);
  const textSize = proportionalTextSize(scale);
  const off = Math.max(textSize * 2.5, 4);
  const frontCx = L + flangeR + D2 * 0.5;

  return assembleDxfFile(req, (b) => {
    // Side view: stepped rectangle.
    //   Flange section: axial 0 to T, radial innerR to flangeR.
    //   Sleeve section: axial T to L, radial innerR to outerR.
    for (const sgn of [1, -1] as const) {
      // Flange step (taller).
      line(b, 0, sgn * flangeR, T, sgn * flangeR);
      line(b, 0, sgn * innerR, 0, sgn * flangeR);
      line(b, T, sgn * flangeR, T, sgn * outerR);
      // Sleeve continuation.
      line(b, T, sgn * outerR, L, sgn * outerR);
      line(b, L, sgn * innerR, L, sgn * outerR);
      // Bore line.
      line(b, 0, sgn * innerR, L, sgn * innerR);
    }
    line(b, -off, 0, L + off, 0, 'CENTER');

    circle(b, frontCx, 0, flangeR);
    circle(b, frontCx, 0, outerR, 'HIDDEN');
    circle(b, frontCx, 0, innerR);
    line(b, frontCx - flangeR - off, 0, frontCx + flangeR + off, 0, 'CENTER');
    line(b, frontCx, -flangeR - off, frontCx, flangeR + off, 'CENTER');

    horizontalDim(b, 0, L, -flangeR - off, -flangeR - off * 2,
      `L=${fmtLabel(L)}`, textSize);
    horizontalDim(b, 0, T, -flangeR - off * 4, -flangeR - off * 5,
      `T=${fmtLabel(T)}`, textSize);
    verticalDim(b, -innerR, innerR,
      frontCx + flangeR + off, frontCx + flangeR + off * 2,
      `Ø${fmtLabel(d1)}`, textSize);
    verticalDim(b, -flangeR, flangeR,
      frontCx + flangeR + off * 4, frontCx + flangeR + off * 5,
      `Ø${fmtLabel(FD)}`, textSize);
    text(b, 0, -flangeR - off * 7, textSize * 1.3,
      `${req.partCode}  Ø${d1}×Ø${D2}/Ø${FD}×${L}`);
  });
}

function buildThrustWasherDxf(req: CadGenerateRequest): CadGenerateResult {
  const d1 = readPositive(req, 'd1', 'd') ?? 15;
  const D2 = readPositive(req, 'D2', 'D') ?? 25;
  const T = readPositive(req, 'T', 'thickness') ?? 3;

  const innerR = d1 / 2;
  const outerR = D2 / 2;
  const scale = Math.max(D2, T * 5);
  const textSize = proportionalTextSize(scale);
  const off = Math.max(textSize * 2.5, 4);
  const frontCx = T + outerR + D2 * 0.5;

  return assembleDxfFile(req, (b) => {
    for (const sgn of [1, -1] as const) {
      line(b, 0, sgn * innerR, T, sgn * innerR);
      line(b, 0, sgn * outerR, T, sgn * outerR);
      line(b, 0, sgn * innerR, 0, sgn * outerR);
      line(b, T, sgn * innerR, T, sgn * outerR);
    }
    line(b, -off, 0, T + off, 0, 'CENTER');

    circle(b, frontCx, 0, outerR);
    circle(b, frontCx, 0, innerR);
    line(b, frontCx - outerR - off, 0, frontCx + outerR + off, 0, 'CENTER');
    line(b, frontCx, -outerR - off, frontCx, outerR + off, 'CENTER');

    horizontalDim(b, 0, T, -outerR - off, -outerR - off * 2,
      `T=${fmtLabel(T)}`, textSize);
    verticalDim(b, -innerR, innerR,
      frontCx + outerR + off, frontCx + outerR + off * 2,
      `Ø${fmtLabel(d1)}`, textSize);
    verticalDim(b, -outerR, outerR,
      frontCx + outerR + off * 4, frontCx + outerR + off * 5,
      `Ø${fmtLabel(D2)}`, textSize);
    text(b, 0, -outerR - off * 4, textSize * 1.3,
      `${req.partCode}  Ø${d1}×Ø${D2}×T${T}`);
  });
}

function buildPlateDxf(req: CadGenerateRequest): CadGenerateResult {
  // Plate dims: B (width), L (length), T (thickness).
  const B = readPositive(req, 'B', 'width', '폭') ?? 30;
  const L = readPositive(req, 'L', 'length', '길이') ?? 50;
  const code = req.partCode.toUpperCase();
  const defaultT =
    code.includes('SWURSL') ? 5 :
    code.includes('SWUCBP') || code.includes('SWURSCBP') ? 30 :
    15;
  const T = readPositive(req, 'T', 'thickness', '두께') ?? defaultT;

  const scale = Math.max(L, B);
  const textSize = proportionalTextSize(scale);
  const off = Math.max(textSize * 2.5, 4);

  return assembleDxfFile(req, (b) => {
    // Top view (B × L rectangle).
    line(b, 0, 0, B, 0);
    line(b, B, 0, B, L);
    line(b, B, L, 0, L);
    line(b, 0, L, 0, 0);

    // Side view (B × T rectangle) — placed below the top view.
    const sideY = -T - off * 3;
    line(b, 0, sideY, B, sideY);
    line(b, B, sideY, B, sideY + T);
    line(b, B, sideY + T, 0, sideY + T);
    line(b, 0, sideY + T, 0, sideY);

    horizontalDim(b, 0, B, -off, -off * 2,
      `B=${fmtLabel(B)}`, textSize);
    verticalDim(b, 0, L, -off, -off * 2,
      `L=${fmtLabel(L)}`, textSize);
    horizontalDim(b, 0, B, sideY - off, sideY - off * 2,
      `T=${fmtLabel(T)}`, textSize);
    text(b, 0, sideY - off * 5, textSize * 1.3,
      `${req.partCode}  ${B}×${L}×T${T}`);
  });
}

function buildSphericalDxf(req: CadGenerateRequest): CadGenerateResult {
  const d1 = readPositive(req, 'd1', 'd') ?? 15;
  const D2 = readPositive(req, 'D2', 'D') ?? 25;
  const L = readPositive(req, 'L', 'length') ?? 20;
  const innerR = d1 / 2;
  const outerR = D2 / 2;
  const R = outerR * 1.1;

  const scale = Math.max(D2, L);
  const textSize = proportionalTextSize(scale);
  const off = Math.max(textSize * 2.5, 4);
  const frontCx = L + outerR + D2 * 0.5;

  return assembleDxfFile(req, (b) => {
    // Side view: rectangle outline + spherical bulge arc on top/bottom.
    const drop = Math.sqrt(R * R - (L / 2) * (L / 2));
    for (const sgn of [1, -1] as const) {
      line(b, 0, sgn * innerR, L, sgn * innerR);              // bore
      line(b, 0, sgn * innerR, 0, sgn * drop);                // left side
      line(b, L, sgn * innerR, L, sgn * drop);                // right side
      // Spherical OD bulge (arc from drop on left to drop on right).
      const apexAngle = Math.atan2(drop, L / 2 - 0) * 180 / Math.PI;
      // Arc center at (L/2, 0). For the +y half: arc going from
      // angle (180 - apexAngle) to apexAngle (going through 90°, the apex).
      if (sgn === 1) arc(b, L / 2, 0, R, apexAngle, 180 - apexAngle);
      else arc(b, L / 2, 0, R, 180 + apexAngle, 360 - apexAngle);
    }
    line(b, -off, 0, L + off, 0, 'CENTER');

    circle(b, frontCx, 0, outerR);
    circle(b, frontCx, 0, innerR);
    line(b, frontCx - outerR - off, 0, frontCx + outerR + off, 0, 'CENTER');
    line(b, frontCx, -outerR - off, frontCx, outerR + off, 'CENTER');

    horizontalDim(b, 0, L, -R - off, -R - off * 2,
      `L=${fmtLabel(L)}`, textSize);
    verticalDim(b, -innerR, innerR,
      frontCx + outerR + off, frontCx + outerR + off * 2,
      `Ø${fmtLabel(d1)}`, textSize);
    verticalDim(b, -outerR, outerR,
      frontCx + outerR + off * 4, frontCx + outerR + off * 5,
      `Ø${fmtLabel(D2)}`, textSize);
    text(b, 0, -R - off * 4, textSize * 1.3,
      `${req.partCode}  Ø${d1}×Ø${D2}×${L}`);
  });
}

function buildPinDxf(req: CadGenerateRequest): CadGenerateResult {
  const D2 = readPositive(req, 'D2', 'D') ?? 10;
  const L = readPositive(req, 'L', 'length') ?? 50;
  const FD = readPositive(req, 'FD', 'headOD');
  const T = readPositive(req, 'T', 'headThk');

  const outerR = D2 / 2;
  const headed = FD != null && T != null && FD > D2 && T > 0 && T < L;
  const headR = headed ? FD! / 2 : outerR;

  const scale = Math.max(headR * 2, L);
  const textSize = proportionalTextSize(scale);
  const off = Math.max(textSize * 2.5, 4);
  const frontCx = L + headR + D2 * 0.5;

  return assembleDxfFile(req, (b) => {
    if (headed) {
      // Stepped pin: head + shank.
      for (const sgn of [1, -1] as const) {
        line(b, 0, 0, 0, sgn * headR);
        line(b, 0, sgn * headR, T!, sgn * headR);
        line(b, T!, sgn * headR, T!, sgn * outerR);
        line(b, T!, sgn * outerR, L, sgn * outerR);
        line(b, L, sgn * outerR, L, 0);
      }
    } else {
      for (const sgn of [1, -1] as const) {
        line(b, 0, 0, 0, sgn * outerR);
        line(b, 0, sgn * outerR, L, sgn * outerR);
        line(b, L, sgn * outerR, L, 0);
      }
    }
    line(b, -off, 0, L + off, 0, 'CENTER');

    if (headed) circle(b, frontCx, 0, headR);
    circle(b, frontCx, 0, outerR);
    line(b, frontCx - headR - off, 0, frontCx + headR + off, 0, 'CENTER');
    line(b, frontCx, -headR - off, frontCx, headR + off, 'CENTER');

    horizontalDim(b, 0, L, -headR - off, -headR - off * 2,
      `L=${fmtLabel(L)}`, textSize);
    verticalDim(b, -outerR, outerR,
      frontCx + headR + off, frontCx + headR + off * 2,
      `Ø${fmtLabel(D2)}`, textSize);
    text(b, 0, -headR - off * 4, textSize * 1.3,
      `${req.partCode}  Ø${D2}×${L}${headed ? ` (Ø${FD!}/T${T!} head)` : ''}`);
  });
}

function readPositive(req: CadGenerateRequest, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = req.dimensions[k];
    if (v == null || v === '') continue;
    const n = typeof v === 'number' ? v : parseFloat(String(v));
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}
