/**
 * Part-generator registry — maps a `partCode` to the module that knows
 * how to build it. Adding a new family is a two-line change here plus
 * the module itself.
 *
 * Usage (in a new family's index.ts):
 *
 *   registerFamily({
 *     name: 'bolt',
 *     codes: ['HBOLT', 'CBOLT', 'SBOLT', ...],
 *     generate: generateBolt,
 *   });
 *
 * Multiple families can share a prefix convention but must never claim
 * overlapping partCodes — a duplicate registration throws at boot time.
 */

import type { CadGenerateRequest, CadGenerateResult } from '../types.js';

/**
 * A family's single entry point — called by the worker with a local-format request.
 * May return sync or async. The orchestrator awaits unconditionally.
 */
export type Generate = (
  req: CadGenerateRequest,
) => CadGenerateResult | Promise<CadGenerateResult>;

export interface PartFamily {
  /** Internal name for logs and /diag — e.g. "bolt", "nut". */
  name: string;
  /** The exact partspec.part_code values this family answers to. */
  codes: readonly string[];
  /** Single entry point. Returns a CadGenerateResult for STEP/DXF/IGES. */
  generate: Generate;
}

const byCode = new Map<string, PartFamily>();
const families: PartFamily[] = [];

export function registerFamily(family: PartFamily): void {
  for (const code of family.codes) {
    const key = code.toUpperCase();
    const existing = byCode.get(key);
    if (existing && existing !== family) {
      throw new Error(
        `[cad/registry] duplicate partCode "${code}" — claimed by "${existing.name}" and "${family.name}"`,
      );
    }
    byCode.set(key, family);
  }
  if (!families.includes(family)) families.push(family);
}

export function findFamily(partCode: string): PartFamily | null {
  return byCode.get(partCode.toUpperCase()) ?? null;
}

export function listFamilies(): readonly PartFamily[] {
  return families;
}

export function listSupportedCodes(): string[] {
  return Array.from(byCode.keys()).sort();
}

// NOTE: family modules are loaded separately via `parts/index.ts` — this
// file intentionally does NOT import any family to avoid the circular
// init where `registerFamily` (defined here) would be called from a
// family module before this file's module-level state is constructed.
