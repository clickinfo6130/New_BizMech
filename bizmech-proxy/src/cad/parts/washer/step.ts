/**
 * Washer STEP composer — emits a single `annularSolid` plus the
 * standard AP214 scaffolding via `assembleStepFile`.
 *
 * Coordinate system: washer lies flat in the XY plane, centered at
 * origin, thickness along +Z.
 */
import type { CadGenerateRequest, CadGenerateResult } from '../../types.js';
import { assembleStepFile } from '../../formats/step.js';
import { annularSolid } from '../../core/step.js';
import type { WasherDims } from './dimensions.js';

export function buildWasherStep(
  req: CadGenerateRequest,
  dims: WasherDims,
): CadGenerateResult {
  return assembleStepFile(req, (b) => {
    return annularSolid(b, dims.do / 2, dims.di / 2, dims.t, 0);
  });
}
