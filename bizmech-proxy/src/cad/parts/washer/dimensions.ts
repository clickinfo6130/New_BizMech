/**
 * Washer dimensions — KS B 1326 (plain washer) / ISO 7089.
 *
 * A washer is a simple annular disc:
 *   · inner hole diameter `di` (just larger than the bolt's nominal d)
 *   · outer diameter `do`
 *   · thickness `t`
 *
 * Spring washers, split-lock washers, and toothed washers all share
 * this same 3-tuple plus a shape-specific flag; for Phase 1.5 we cover
 * the plain disc and the split-ring washer. Other washer variants
 * (external tooth, internal tooth, fender) will inherit the same
 * dimensions + their own `step.ts` geometry.
 */
import type { CadGenerateRequest } from '../../types.js';
import { resolveDims, type DimSpec } from '../../core/dim-resolver.js';

export interface WasherDims {
  /** Hole (inner) diameter — slightly larger than the nominal bolt d. */
  di: number;
  /** Outer diameter. */
  do: number;
  /** Thickness. */
  t: number;
}

export const WASHER_DIM_SPEC: DimSpec<WasherDims> = {
  di: {
    aliases: ['di', 'd1', 'd_inner', 'innerDiameter', '내경', '내부지름'],
    required: true,
  },
  do: {
    aliases: ['do', 'd2', 'd_outer', 'outerDiameter', '외경', '외부지름', 'D'],
    required: true,
  },
  t: {
    aliases: ['t', 'thickness', '두께', 'H', 'h'],
    required: true,
  },
};

export function resolveWasherDims(req: CadGenerateRequest, partLabel: string): WasherDims {
  return resolveDims(req, WASHER_DIM_SPEC, partLabel);
}
