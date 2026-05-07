/**
 * STEP composition for bolts — combines the selected head variant with
 * a plain shaft and hands the face list to the format composer.
 *
 * NOTE: head and shaft share a face at z=0 (bearing surface). A rigorous
 * boolean-union would remove that shared face; for now we emit both
 * solids as a single shell (the CAD importer still shows correct mass
 * properties and measurements). Phase 1.5 will swap this for an OCCT
 * boolean fuse via opencascade.js.
 */
import type { CadGenerateRequest, CadGenerateResult } from '../../types.js';
import { assembleStepFile } from '../../formats/step.js';
import { cylinderSolid } from '../../core/step.js';
import type { BoltDims } from './dimensions.js';
import { headImpl, type BoltHeadKind } from './heads/index.js';

/**
 * Compose the STEP faces for the bolt.
 *
 * Shaft convention: ONE major-diameter cylinder covering z ∈ [0, L].
 * This matches how real bolts measure in CAD (outer diameter = d
 * everywhere on the shaft). The thread region is handled as cosmetic
 * thread in the DXF side view; for true helical grooves in 3D, use
 * the OCCT backend with `OCCT_REAL_THREAD=true`.
 *
 * NOTE: head faces + shaft faces are emitted into a single CLOSED_SHELL
 * without a true boolean union (hand-written STEP can't do that). The
 * resulting file is a single MANIFOLD_SOLID_BREP declaration, so CAD
 * tools show it as one connected part.
 */
export function buildBoltStep(
  req: CadGenerateRequest,
  dims: BoltDims,
  headKind: BoltHeadKind,
): CadGenerateResult {
  const head = headImpl(headKind);
  return assembleStepFile(
    req,
    (b) => {
      const headFaces = head.stepFaces(b, dims);
      const shaftFaces = cylinderSolid(b, dims.d / 2, dims.L, 0);
      return [...headFaces, ...shaftFaces];
    },
    {
      // Embed the thread designation in the STEP Product name so it
      // shows up in the CAD BOM / iProperties as "HBOLT M10×1.5".
      displayName: buildDisplayName(req, dims),
    },
  );
}

function buildDisplayName(req: CadGenerateRequest, dims: BoltDims): string {
  const parts: string[] = [];
  parts.push(req.keyComposite || req.partCode);
  if (dims.threadDesignation) parts.push(dims.threadDesignation);
  parts.push(`L=${dims.L}`);
  if (req.material) parts.push(req.material);
  return parts.join(' / ');
}
