/**
 * Hand-written STEP fallback for bearings — a degraded geometry used
 * only when the OCCT runtime is unavailable. Two simple annular cylinders
 * (inner ring + outer ring) joined as a single closed shell. The
 * raceway groove is OMITTED — writing a `TOROIDAL_SURFACE` by hand is
 * complex and the fallback's only job is to keep the download path
 * functional during OCCT outages.
 *
 * When this fallback is used, the cache layer marks the result with
 * `noCache: true` so the next request retries OCCT on a fresh WASM
 * runtime and the user gets the proper grooved geometry.
 *
 * Coordinates: bearing axis = Z, rings centered at z=0, extending
 * from -B/2 to +B/2.
 */
import type { CadGenerateRequest, CadGenerateResult } from '../../types.js';
import { assembleStepFile } from '../../formats/step.js';
import { annularSolid } from '../../core/step.js';
import type { BearingDims } from './dimensions.js';

export function buildBearingStep(
  req: CadGenerateRequest,
  dims: BearingDims,
): CadGenerateResult {
  return assembleStepFile(req, (b) => {
    const halfB = dims.B / 2;
    // Compute the groove parameters (same formulas as the OCCT path)
    // so the fallback's INNER and OUTER ring radii at least describe
    // the rough metal envelope. We don't carve the groove itself —
    // CAD measures will see an oversized inner ring and undersized
    // outer ring vs the real bearing, but no rolling-element gap.
    const pitchR = (dims.d1 + dims.D2) / 4;
    const grooveR = ((dims.D2 - dims.d1) * 0.3) / 2 * 1.02;
    const shoulderH_Inner = pitchR - grooveR * 0.8;
    const shoulderH_Outer = pitchR + grooveR * 0.8;

    // Inner ring: hollow cylinder from bore (d1/2) up to inner shoulder.
    const innerFaces = annularSolid(
      b,
      shoulderH_Inner,
      dims.d1 / 2,
      dims.B,
      -halfB,
    );
    // Outer ring: hollow cylinder from outer shoulder up to OD (D2/2).
    const outerFaces = annularSolid(
      b,
      dims.D2 / 2,
      shoulderH_Outer,
      dims.B,
      -halfB,
    );
    return [...innerFaces, ...outerFaces];
  });
}
