/**
 * Washer family — plain (flat) washer for now.
 *
 * Every washer variant uses the same 3 core dims (di, do, t). Special
 * shapes (spring / split-lock / toothed / fender) will arrive as
 * additional generator branches using the same dimension record.
 *
 * PartCode mapping (derived from Standard_Core.parttype — best-guess
 * naming, update here as the DB evolves):
 *   PWAS  — Plain Washer           (KS B 1326)
 *   DWAS  — 평와셔 variant
 *   TWAS  — 평와셔 variant (thick)
 *   BWAS  — 평와셔 variant
 *   CAPNUT — excluded (nut family, separate)
 */
import type { CadGenerateRequest, CadGenerateResult } from '../../types.js';
import { LOCAL_FORMATS } from '../../types.js';
import { registerFamily } from '../registry.js';
import { resolveWasherDims } from './dimensions.js';
import { buildWasherStep } from './step.js';
import { buildWasherDxf } from './dxf.js';

const WASHER_CODES = [
  'PWAS',    // Plain washer (generic)
  'DWAS',
  'TWAS',
  'BWAS',
  'DWAS',
  'HFTS',    // Heavy flat / thin series — present in parttype orphan list
  'FFMS',
  'FMS',
  'WASHER',  // fallback alias
];

export function generateWasher(req: CadGenerateRequest): CadGenerateResult {
  if (!(LOCAL_FORMATS as readonly string[]).includes(req.format)) {
    throw new Error(
      `Washer: format ${req.format} is not produced locally; route through CAD Exchanger.`,
    );
  }

  const dims = resolveWasherDims(req, req.partCode);

  switch (req.format) {
    case 'STEP':
      return buildWasherStep(req, dims);
    case 'DXF':
      return buildWasherDxf(req, dims);
    default:
      throw new Error(
        `Washer: local format ${req.format} not implemented yet (STEP/DXF only).`,
      );
  }
}

registerFamily({
  name: 'washer',
  codes: [...new Set(WASHER_CODES)],
  generate: generateWasher,
});
