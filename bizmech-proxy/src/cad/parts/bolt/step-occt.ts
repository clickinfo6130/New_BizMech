/**
 * OCCT-backed STEP generator for hex bolts — stacked-rings thread
 * edition.
 *
 * DESIGN (third revision):
 *   Earlier attempts failed on the opencascade.js 1.1.1 WASM build:
 *     · Helical sweep + boolean cut (`MakePipeShell` of a V-profile
 *       along a helix rail, then `BRepAlgoAPI_Cut`): multi-manifold
 *       outputs, shaft-eating booleans, or the deep
 *       `___cxa_can_catch is not defined` WASM crash — outcome
 *       depended on bolt size in ways that resist systematic fixes.
 *     · Cosmetic helical wire compound overlay: no crashes, but the
 *       result rendered as "lines drawn on a smooth cylinder" —
 *       users correctly noted that a CAD part should be geometry,
 *       not a wireframe annotation.
 *
 *   The current approach avoids both classes of problem by
 *   representing threads as a STACK OF RING-SHAPED V-GROOVES. Each
 *   "ring" is a full 360° V-notch at the matching axial position;
 *   N = floor(threadLength / pitch) rings are stacked. Visually
 *   indistinguishable from a true helix at any normal viewing angle
 *   (most CAD tools render real threads this way internally for
 *   display-mode performance).
 *
 *   The cutter is built from TWO primitive operations:
 *     1. `BRepPrimAPI_MakeRevol` of a zigzag profile in the XZ
 *        plane — rock-solid OCCT primitive, no frame transport to
 *        misconfigure.
 *     2. ONE `BRepAlgoAPI_Cut` to carve the rings into the shaft —
 *        both operands are simple analytic solids, well within the
 *        boolean engine's comfort zone.
 *
 * GEOMETRY:
 *   1. Hex head (chamfered prism), z ∈ [−H, 0].
 *   2. Shaft — cylinder at major diameter `d`, z ∈ [−OVERLAP, L].
 *   3. Thread cutter — stacked-rings revolution solid covering the
 *      thread zone; subtracted from the shaft.
 *   4. Head + threaded shaft fused into a single MANIFOLD_SOLID_BREP.
 *
 * RELATIONSHIP TO `NewCreateBoltClass.cpp:1541–1579`:
 *   The C++ reference uses Inventor's cosmetic ThreadFeature and
 *   leaves the 3D shaft smooth — threads are visual annotations
 *   only. STEP export from Inventor does not preserve that
 *   annotation as geometry, so CAD consumers of the exported file
 *   would see a smooth bolt. We diverge deliberately: BizMech's
 *   downstream consumers open the STEP directly, so threads must
 *   live in the geometry itself. The `Ls − z` thread-length formula
 *   (line 1573 of the reference) is preserved via
 *   `resolveTipRelief`.
 */
import type { CadGenerateRequest, CadGenerateResult } from '../../types.js';
import { FORMAT_EXT, FORMAT_MIME } from '../../types.js';
import type { BoltDims } from './dimensions.js';
import {
  boolCut,
  boolFuse,
  chamferAllEdges,
  exportStepBytes,
  getOcct,
  makeCylinder,
  makeHexPrism,
  makeThreadRingsCutter,
  translateShape,
} from '../../core/occt.js';
import { bomFileName } from '../../core/bom-meta.js';

/** When true, carve stacked-rings V-groove thread into the shaft. */
const USE_REAL_THREAD = (process.env.OCCT_REAL_THREAD ?? '').toLowerCase() === 'true';

/**
 * Volumetric overlap so adjacent sub-solids (head ↔ shaft) fuse into
 * a single manifold. Must exceed the head-chamfer width (~0.44 mm on
 * M8) so the shaft's protrusion into the head lands in solid material
 * rather than the already-carved chamfer zone.
 */
const OVERLAP = 1.0;

/**
 * Minimum unthreaded band directly under the head. Keeps the first
 * thread ring clear of the head-shaft fuse zone + chamfer — the same
 * manufacturing relief real bolts have.
 */
const HEAD_CLEAR_MM = 2.0;

// Filename uses the BOM specification string ("M6X1-40L") so the
// imported IPT's tree label matches the as-drawn assembly. See
// `bomFileName` doc for rationale.

export async function buildHexBoltStepViaOcct(
  req: CadGenerateRequest,
  dims: BoltDims,
): Promise<CadGenerateResult> {
  const started = Date.now();
  const oc = await getOcct();

  // ── 1. Hex head, z ∈ [−H, 0] ──
  const rawHead = makeHexPrism(oc, dims.S, dims.H);
  const head = translateShape(oc, rawHead, 0, 0, -dims.H);
  const chamferDist = Math.min(dims.H * 0.08, dims.S * 0.04);
  const headChamfered = chamferAllEdges(oc, head, chamferDist);

  // ── 2. Shaft — one major-d cylinder covering the full length,
  //      extending DOWN by OVERLAP into the head for a clean fuse. ──
  const shaftRaw = makeCylinder(oc, dims.d / 2, dims.L + OVERLAP);
  const shaft = translateShape(oc, shaftRaw, 0, 0, -OVERLAP);

  // ── 3. Optional thread ──
  //
  // Zone:   z ∈ [threadStartZ, L]
  //   threadStartZ = max(HEAD_CLEAR_MM, L − Ls)
  //
  //   Threads extend ALL THE WAY TO THE BOLT TIP — matching the
  //   C++ reference's "rough/flat end" case (pFgz=0 in
  //   NewCreateBoltClass.cpp:1545). `makeThreadRingsCutter` handles
  //   the tip-boundary safely via its internal zigzag Z-offset and
  //   cap overshoot, so `boolCut` truncates the last partial ring
  //   into a clean tapered tip transition rather than hitting a
  //   tangent-at-boundary failure.
  //
  //   For partially-threaded bolts, `dims.L − dims.threadLength` is
  //   already > HEAD_CLEAR_MM, so the max() acts as a no-op. It
  //   only engages for fully-threaded bolts (M3×10, M8×16 etc.)
  //   where we need to keep the first ring clear of the head-shaft
  //   fuse zone.
  //
  //   Threads are cut only when the thread zone is at least one
  //   full pitch — below that the cutter would have zero rings.
  let threadedShaft = shaft;
  const hasThread = dims.pitch > 0 && dims.threadLength > 0;
  if (hasThread && USE_REAL_THREAD) {
    const threadStartZ = Math.max(HEAD_CLEAR_MM, dims.L - dims.threadLength);
    const coverLen = dims.L - threadStartZ;
    if (coverLen >= dims.pitch) {
      const cutter = makeThreadRingsCutter(
        oc,
        dims.d / 2,
        dims.minorD / 2,
        dims.pitch,
        threadStartZ,
        coverLen,
      );
      threadedShaft = boolCut(oc, shaft, cutter);
    }
  }

  // ── 4. Fuse head + (threaded) shaft into a single solid ──
  const bolt = boolFuse(oc, headChamfered, threadedShaft);

  // ── 5. Export ──
  const bytes = exportStepBytes(oc, bolt);
  const ext = FORMAT_EXT.STEP;
  return {
    bytes,
    format: 'STEP',
    mimeType: FORMAT_MIME.STEP,
    ext,
    backend: 'local',
    generatedMs: Date.now() - started,
    fileName: bomFileName(req, ext),
  };
}
