/**
 * Bolt family — single entry point for every bolt variant registered
 * in this proxy.
 *
 * Flow:
 *   1. The registry delegates here when partCode matches one of
 *      `BOLT_CODES`.
 *   2. We map the partCode to a `BoltHeadKind` via `HEAD_OF_CODE`.
 *   3. The shared dim resolver extracts { d, L, S, H } from the
 *      request's dimension map (with user-overrides applied upstream).
 *   4. The requested format is composed via the bolt's step.ts or
 *      dxf.ts module, which in turn delegates head-specific geometry
 *      to the module under heads/.
 *
 * Adding a new bolt variant:
 *   - Implement the head under heads/<name>.ts
 *   - Register it in heads/index.ts (HEAD_IMPL map)
 *   - Add partCode → head-kind entries to HEAD_OF_CODE below
 *   - Add the partCodes to BOLT_CODES
 * No other files need changes.
 */
import { writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { CadGenerateRequest, CadGenerateResult } from '../../types.js';
import { LOCAL_FORMATS } from '../../types.js';
import { registerFamily } from '../registry.js';
import { resolveBoltDims } from './dimensions.js';
import { buildBoltStep } from './step.js';
import { buildBoltDxf } from './dxf.js';
import { buildHexBoltStepViaOcct } from './step-occt.js';
import { resetOcct } from '../../core/occt.js';
import { resolveBomMetadata } from '../../core/bom-meta.js';
import { embedBomInStep } from '../../core/step-bom.js';
import type { BoltHeadKind } from './heads/index.js';

/**
 * Run the BOM post-processor on a freshly generated STEP result.
 * Idempotent — calling on already-embedded bytes simply replaces the
 * existing BIZMECH_BOM block. Bypassed for non-STEP outputs since the
 * embedder targets STEP entity syntax.
 */
function applyBom(req: CadGenerateRequest, result: CadGenerateResult): CadGenerateResult {
  if (result.format !== 'STEP') return result;
  const bom = resolveBomMetadata(req);
  const text = result.bytes.toString('utf8');
  const next = embedBomInStep(text, bom);
  if (next === text) return result;
  return { ...result, bytes: Buffer.from(next, 'utf8') };
}

/**
 * Runtime switch for the STEP backend.
 *
 *   CAD_BACKEND=hand  → hand-written AP214 (default; sync; no WASM load)
 *   CAD_BACKEND=occt  → opencascade.js WASM (precise fuse + chamfer,
 *                       ~700ms first-call warmup, hot cache after)
 *
 * The switch only affects STEP — DXF always uses the hand-written path
 * because it's a 2D drawing format with no OCCT equivalent in this
 * build of opencascade.js.
 */
const USE_OCCT = (process.env.CAD_BACKEND ?? 'hand').toLowerCase() === 'occt';

/**
 * partCode → head kind. The partCode vocabulary comes from the
 * Standard_Core.parttype table (inherited from PartManager). Codes not
 * yet implemented map to a head we haven't ported; `generateBolt` will
 * throw a clear "not implemented" message for those.
 */
/**
 * partCode → head kind. The partCode vocabulary comes from the
 * Standard_Core.parttype table (inherited from PartManager). Feel
 * free to add more codes as the DB evolves — the head module has
 * already been implemented for each kind listed on the right.
 *
 * The current mapping is a best-effort match against typical naming
 * in the parttype table. When a DB code doesn't match one of these,
 * /download returns 404 "partCode not mapped" so the mismatch is
 * obvious and the catalog team can update this file.
 */
const HEAD_OF_CODE: Record<string, BoltHeadKind> = {
  // Hex
  HBOLT: 'Hex',
  HSBOLT: 'Hex',
  HGBOLT: 'Hex',

  // Hex flange
  HFBOLT: 'HexFlange',
  FBOLT: 'HexFlange',

  // Socket (hex-socket cap / Allen)
  SBOLT: 'Socket',
  SHBOLT: 'Socket',
  SOCKET: 'Socket',

  // Countersunk (접시머리)
  CBOLT: 'Countersunk',
  CSBOLT: 'Countersunk',

  // Button
  BBOLT: 'Button',
  BHBOLT: 'Button',

  // Pan
  PBOLT: 'Pan',
  PHBOLT: 'Pan',

  // Round
  RBOLT: 'Round',
  RHBOLT: 'Round',

  // Cheese (slotted cylinder)
  CHBOLT: 'Cheese',

  // Square-head
  SQBOLT: 'Square',
  SQUARE: 'Square',

  // Sems (hex + captive washer)
  SMBOLT: 'Sems',
  SEMSBOLT: 'Sems',
};

const BOLT_CODES = Object.keys(HEAD_OF_CODE);

export async function generateBolt(req: CadGenerateRequest): Promise<CadGenerateResult> {
  if (!(LOCAL_FORMATS as readonly string[]).includes(req.format)) {
    throw new Error(
      `Bolt: format ${req.format} is not produced locally; route through CAD Exchanger.`,
    );
  }

  const code = req.partCode.toUpperCase();
  const headKind = HEAD_OF_CODE[code];
  if (!headKind) {
    throw new Error(
      `Bolt: partCode "${req.partCode}" not mapped to a head kind. ` +
        `Edit parts/bolt/index.ts HEAD_OF_CODE to register it.`,
    );
  }

  const dims = resolveBoltDims(req, req.partCode);

  switch (req.format) {
    case 'STEP':
      // OCCT backend currently only covers Hex-family heads; other
      // variants fall back to the hand-written path automatically.
      if (USE_OCCT && headKind === 'Hex') {
        // OCCT's WASM runtime can hit "memory access out of bounds"
        // after many cumulative operations (heap fragmentation / leaks
        // in the embedded OCCT allocator). When that happens:
        //   1. The current request falls back to hand-written STEP so
        //      the user still gets a downloadable file (shaft at major
        //      d, no helical grooves).
        //   2. We RESET the OCCT singleton so the NEXT request gets a
        //      fresh WASM module. Otherwise the corrupted heap would
        //      make every subsequent request fall back too, and the
        //      user would never see real-thread bolts again until a
        //      manual proxy restart.
        const useFallback = (reason: string) => {
          // eslint-disable-next-line no-console
          console.warn(
            `[bolt/occt] ${req.partCode}: ${reason}. ` +
              `Falling back to hand-written and resetting OCCT runtime.`,
          );
          resetOcct();
          const fallback = buildBoltStep(req, dims, headKind);
          // Don't cache the fallback: next request for the same spec
          // should retry OCCT on a fresh WASM instance. BOM still
          // embedded so the user gets a usable file in the meantime.
          return { ...applyBom(req, fallback), noCache: true };
        };
        // Debug dump: when validation fails, save the OCCT output to
        // %TEMP%\bolt-occt-debug-<partCode>-<ts>.stp so we can inspect
        // what OCCT actually produced (the fallback .stp that ends up
        // in the cache is hand-written, not the OCCT bytes). Enabled
        // only under OCCT_DEBUG_DUMP=true to keep temp dir clean.
        const debugDump = (occtBytes: Buffer, tag: string): string | null => {
          if ((process.env.OCCT_DEBUG_DUMP ?? '').toLowerCase() !== 'true') {
            return null;
          }
          try {
            const name = `bolt-occt-debug-${req.partCode}-${tag}-${Date.now()}.stp`;
            const path = join(tmpdir(), name);
            writeFileSync(path, occtBytes);
            return path;
          } catch {
            return null;
          }
        };
        try {
          const occtResult = await buildHexBoltStepViaOcct(req, dims);
          // Validate the output. The new cosmetic-thread pipeline
          // produces deterministic geometry (no fragile boolean cut),
          // so the checks stay narrow:
          //   · MANIFOLD_SOLID_BREP == 1 — the fused head+shaft body.
          //   · CYLINDRICAL_SURFACE >= 1 — the shaft's outer surface.
          //     (The earlier boolean-cut path could silently erase this
          //     when the cutter volume was mis-oriented; keeping the
          //     check as a regression guard is cheap.)
          //
          // We no longer gate on face count or B-SPLINE presence: the
          // shaft is a simple cylinder by design, so those shape
          // signatures have nothing to prove.
          const s = occtResult.bytes.toString();
          const manifoldCount = (s.match(/MANIFOLD_SOLID_BREP/g) || []).length;
          const cylinderCount = (s.match(/CYLINDRICAL_SURFACE/g) || []).length;
          if (manifoldCount !== 1) {
            const dumped = debugDump(occtResult.bytes, 'manifold');
            return useFallback(
              `OCCT output has ${manifoldCount} manifolds (expected 1)` +
                (dumped ? ` — dumped to ${dumped}` : ''),
            );
          }
          if (cylinderCount < 1) {
            const dumped = debugDump(occtResult.bytes, 'no-shaft');
            return useFallback(
              `OCCT output has no CYLINDRICAL_SURFACE — shaft geometry lost` +
                (dumped ? ` — dumped to ${dumped}` : ''),
            );
          }
          return applyBom(req, occtResult);
        } catch (e) {
          return useFallback(
            `OCCT threw: ${(e as Error).message?.slice(0, 120)}`,
          );
        }
      }
      return applyBom(req, buildBoltStep(req, dims, headKind));
    case 'DXF':
      return buildBoltDxf(req, dims, headKind);
    default:
      throw new Error(
        `Bolt: local format ${req.format} not implemented yet (STEP/DXF only).`,
      );
  }
}

// Register with the top-level plugin registry at import time.
registerFamily({
  name: 'bolt',
  codes: BOLT_CODES,
  generate: generateBolt,
});
