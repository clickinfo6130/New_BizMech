/**
 * OpenCascade.js (WASM) singleton — lazy-loaded on first use.
 *
 * This module bridges the Node/ESM/Windows environment to the
 * opencascade.js 1.1.1 emscripten build. The package was designed for
 * webpack/vite + browser targets; several workarounds are required
 * to run it inside our Node + ESM proxy:
 *
 *   1. Emscripten references CJS globals `__dirname`/`__filename` —
 *      we inject them into `globalThis` before the loader runs.
 *   2. The package's `index.js` uses a webpack-style .wasm import that
 *      Node can't resolve; we bypass it by calling the raw loader
 *      at `dist/opencascade.wasm.js` via `pathToFileURL` + dynamic
 *      import.
 *   3. Emscripten environment detection misfires under ESM — we
 *      preload the WASM binary via `readFileSync` and pass it through
 *      the `wasmBinary` option so the runtime never needs fetch().
 *   4. Transfer() and related methods expect an explicit `compgraph`
 *      boolean (Transfer(shape, mode, true)). Passing 2 args throws.
 *   5. STEPControl_Writer.Write() writes to the Emscripten virtual
 *      filesystem. We hand it a short ASCII name, let it write, then
 *      read the bytes back via `oc.FS.readFile`. The VFS root should
 *      be cleaned between writes because stale Embind string memory
 *      can reuse a corrupted filename otherwise.
 *
 * All probe artifacts moved to the generators' unit tests; this file
 * is the sole production entry point.
 */
import { pathToFileURL } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';
import { createRequire } from 'module';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyOc = any;

let ocPromise: Promise<AnyOc> | null = null;

async function initOcct(): Promise<AnyOc> {
  const require_ = createRequire(import.meta.url);
  const packageJsonPath = require_.resolve('opencascade.js/package.json');
  const pkgRoot = dirname(packageJsonPath);
  const wasmDir = join(pkgRoot, 'dist');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).__dirname = wasmDir;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).__filename = join(wasmDir, 'opencascade.wasm.js');

  const wasmBytes = readFileSync(join(wasmDir, 'opencascade.wasm.wasm'));
  const loaderUrl = pathToFileURL(join(wasmDir, 'opencascade.wasm.js')).href;
  const mod = await import(loaderUrl);

  const factory = (mod.default ?? mod) as (opts: { wasmBinary: Buffer }) => Promise<AnyOc>;
  return factory({ wasmBinary: wasmBytes });
}

/** Get the OCCT runtime, loading it on first call. */
export function getOcct(): Promise<AnyOc> {
  if (!ocPromise) {
    ocPromise = initOcct().catch((err) => {
      // Don't cache a failed load; allow retry on next request.
      ocPromise = null;
      throw err;
    });
  }
  return ocPromise;
}

/** Returns `true` if opencascade.js has been loaded into memory. */
export function isOcctReady(): boolean {
  return ocPromise !== null;
}

/**
 * Discard the currently-loaded OCCT WASM runtime. The next `getOcct()`
 * call will re-initialize from scratch (+ ~700 ms warmup).
 *
 * Use this after a WASM runtime error (e.g. "memory access out of
 * bounds"): once OCCT's internal heap is corrupted, every subsequent
 * geometry call on that instance fails too. Only a fresh WASM module
 * can recover. We accept the warmup cost on the next request in
 * exchange for reliable operation.
 */
export function resetOcct(): void {
  ocPromise = null;
}

// ─────────────────────────────────────────────────────────────────────
// STEP export — write a TopoDS_Shape to a Buffer via the VFS.
// ─────────────────────────────────────────────────────────────────────

/**
 * Clean the VFS root of any leftover .stp files so the Write() call
 * can't collide with stale Embind string memory (see module header).
 */
function cleanVfsRoot(oc: AnyOc): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fs = (oc as any).FS;
  try {
    for (const f of fs.readdir('/') as string[]) {
      if (['.', '..', 'tmp', 'home', 'dev', 'proc'].includes(f)) continue;
      try { fs.unlink(f); } catch { /* keep going */ }
    }
  } catch {
    /* VFS not ready yet — fine */
  }
}

/**
 * Export a TopoDS_Shape to STEP bytes.
 *
 * The filename is an implementation detail — the caller never sees it.
 * We use 'a.stp' for historical reasons (shortest ASCII that produced
 * stable results during probing; see module header note 5).
 */
export function exportStepBytes(oc: AnyOc, shape: AnyOc): Buffer {
  cleanVfsRoot(oc);
  // NOTE on assembly structure
  // ──────────────────────────
  // STEPControl_Writer flattens a single TopoDS_Solid into ONE
  // MANIFOLD_SOLID_BREP wrapped in ONE PRODUCT — fine for bolts/nuts/
  // washers (single body) and for the ring sub-shapes used by the
  // bearing's `exportAssemblyStepBytes`. Do NOT pass a Compound of
  // multiple disjoint solids here: OCCT writes one PRODUCT per solid
  // and links them with NEXT_ASSEMBLY_USAGE_OCCURRENCE regardless of
  // the `write.step.assembly = 0` setting (verified empirically — the
  // setting changes nothing for that input shape on opencascade.js
  // 1.1.1). For multi-component output use `exportAssemblyStepBytes`,
  // which goes through the XCAF-aware STEPCAFControl_Writer and gives
  // the named, grouped structure CAD systems expect.
  const writer = new oc.STEPControl_Writer_1();
  const status = writer.Transfer(shape, oc.STEPControl_StepModelType.STEPControl_AsIs, true);
  // 1 = RetDone; anything else indicates the transfer produced nothing.
  if ((status?.value ?? status) !== 1) {
    throw new Error(`OCCT Transfer failed — status=${status?.value ?? status}`);
  }
  writer.Write('a.stp');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fs = (oc as any).FS;
  const entries = (fs.readdir('/') as string[]).filter(
    (f) => !['.', '..', 'tmp', 'home', 'dev', 'proc'].includes(f),
  );
  if (entries.length === 0) {
    throw new Error('OCCT Write produced no output file in the VFS');
  }
  // Most recent (or only) written file — some OCCT versions mangle the
  // filename via Embind string memory reuse; accept whatever is there.
  const target = entries.find((n) => n === 'a.stp') ?? entries[0];
  const data = fs.readFile(target) as Uint8Array;
  return Buffer.from(data);
}

/**
 * One named component for `exportAssemblyStepBytes`. The `shape` is
 * normally a single TopoDS_Solid, but may be a TopoDS_Compound — sub-
 * solids of a Compound stay together as multi-body within the same
 * component (matching the bearing's "Ball" component which holds 8
 * disjoint sphere bodies that should select / move together).
 */
export interface AssemblyComponent {
  /** Human-readable component name shown in the CAD system's tree. */
  name: string;
  /** TopoDS_Solid or TopoDS_Compound to attach as this component's geometry. */
  shape: AnyOc;
}

/**
 * Post-process a STEP file produced by `exportStepBytes(merged-multi-shell-Solid)`
 * so its `BREP_WITH_VOIDS` (one outer shell + N "voids") is rewritten as
 * (N+1) sibling `MANIFOLD_SOLID_BREP`s sharing one `ADVANCED_BREP_SHAPE_REPRESENTATION`.
 *
 * Why
 * ───
 * Inventor's STEP translator splits BREP_WITH_VOIDS into separate
 * components on import — the whole reason `mergeShapesIntoMultibodySolid`
 * exists (1 PRODUCT, 1 SHAPE_REPRESENTATION) gets undone client-side
 * because each void becomes its own draggable .ipt sub-part. Multiple
 * MANIFOLD_SOLID_BREPs in one shape representation is the standard
 * SolidWorks / Creo encoding for a multi-body part — Inventor reliably
 * imports THAT as a single `.ipt` with N bodies that can't drag apart.
 *
 * Transformation
 * ──────────────
 *   BEFORE:
 *     #15  = BREP_WITH_VOIDS('', #16,(#420,#825,#837,…));
 *     #420 = ORIENTED_CLOSED_SHELL('',*,#421,.F.);
 *     #825 = ORIENTED_CLOSED_SHELL('',*,#826,.F.);
 *     …
 *     #10  = ADVANCED_BREP_SHAPE_REPRESENTATION('',(#11,#15),#921);
 *
 *   AFTER:
 *     #15   = MANIFOLD_SOLID_BREP('', #16);
 *     #N+1  = MANIFOLD_SOLID_BREP('', #421);
 *     #N+2  = MANIFOLD_SOLID_BREP('', #826);
 *     …
 *     #10   = ADVANCED_BREP_SHAPE_REPRESENTATION('',(#11,#15,#N+1,#N+2,…),#921);
 *
 * The outer shell's MANIFOLD reuses the original BREP_WITH_VOIDS entity
 * id (#15) so all existing references stay valid; new manifolds get
 * fresh ids past `maxExistingId`. ORIENTED_CLOSED_SHELL entries are
 * left in the file as orphans — STEP parsers ignore unreferenced
 * entities, so removing them would only complicate the rewrite.
 *
 * Idempotent: if the file has no BREP_WITH_VOIDS, the input is
 * returned unmodified (no-op for non-multi-body STEPs from bolt /
 * washer / nut generators).
 */
export function flattenBrepWithVoidsToManifolds(stepText: string): string {
  // BREP_WITH_VOIDS may wrap across lines — match across newlines via [\s\S]
  const bwvRe =
    /^(#(\d+))\s*=\s*BREP_WITH_VOIDS\s*\(\s*'[^']*'\s*,\s*(#\d+)\s*,\s*\(([\s\S]*?)\)\s*\)\s*;/m;
  const bwvMatch = stepText.match(bwvRe);
  if (!bwvMatch) return stepText;

  const bwvEntityId = bwvMatch[1]; // e.g. "#15"
  const outerShellId = bwvMatch[3]; // e.g. "#16"
  const voidIds = bwvMatch[4]
    .split(/[,\s\n]+/)
    .map((s) => s.trim())
    .filter((s) => /^#\d+$/.test(s));
  if (voidIds.length === 0) return stepText;

  // Resolve each void ORIENTED_CLOSED_SHELL → its inner CLOSED_SHELL id.
  // ORIENTED_CLOSED_SHELL signature: ('', *, parentShellId, .F. | .T.)
  const innerShellIds: string[] = [];
  for (const voidId of voidIds) {
    const re = new RegExp(
      `^${voidId.replace('#', '#')}\\s*=\\s*ORIENTED_CLOSED_SHELL\\s*\\(\\s*'[^']*'\\s*,\\s*\\*\\s*,\\s*(#\\d+)`,
      'm',
    );
    const m = stepText.match(re);
    if (!m) {
      throw new Error(
        `flattenBrepWithVoidsToManifolds: cannot find ORIENTED_CLOSED_SHELL for ${voidId}`,
      );
    }
    innerShellIds.push(m[1]);
  }

  // Allocate fresh entity ids past the current max.
  const allIdMatches = stepText.matchAll(/^#(\d+)\s*=/gm);
  let maxId = 0;
  for (const m of allIdMatches) {
    const n = parseInt(m[1], 10);
    if (n > maxId) maxId = n;
  }

  // Build replacement: outer shell reuses bwvEntityId, voids get new ids.
  const outerManifoldLine = `${bwvEntityId} = MANIFOLD_SOLID_BREP('',${outerShellId});`;
  const newManifoldIds: string[] = [];
  const newManifoldLines: string[] = [];
  for (const shellId of innerShellIds) {
    const newId = `#${++maxId}`;
    newManifoldIds.push(newId);
    newManifoldLines.push(`${newId} = MANIFOLD_SOLID_BREP('',${shellId});`);
  }

  // 1. Replace the BREP_WITH_VOIDS entity with the outer MANIFOLD_SOLID_BREP
  //    PLUS the new sibling manifolds (concatenated on the next lines).
  const replacement = [outerManifoldLine, ...newManifoldLines].join('\n');
  let out = stepText.replace(bwvRe, replacement);

  // 2. Extend the ADVANCED_BREP_SHAPE_REPRESENTATION items list to
  //    include the new manifold ids alongside the original outer.
  //    Pattern: `('label',(item1,item2,...), #ctxId)`
  const reprRe = new RegExp(
    `^(#\\d+\\s*=\\s*ADVANCED_BREP_SHAPE_REPRESENTATION\\s*\\(\\s*'[^']*'\\s*,\\s*\\()([^)]+)(\\)\\s*,\\s*#\\d+\\s*\\)\\s*;)`,
    'm',
  );
  const reprMatch = out.match(reprRe);
  if (!reprMatch) {
    throw new Error(
      'flattenBrepWithVoidsToManifolds: could not locate ADVANCED_BREP_SHAPE_REPRESENTATION',
    );
  }
  const itemsList = reprMatch[2].trim();
  const extendedItems = `${itemsList},${newManifoldIds.join(',')}`;
  out = out.replace(reprRe, `$1${extendedItems}$3`);

  // 3. Strip the now-orphaned `ORIENTED_CLOSED_SHELL` entries that the
  //    BREP_WITH_VOIDS used to reference. Leaving them around triggers
  //    Inventor's STEP translator to lock the import dialog into
  //    "Structure: Assembly" (the .iam-only path) — its multi-body
  //    detection treats the orphans as evidence of a partial assembly
  //    structure even though they're unreferenced. SolidWorks ignores
  //    orphans cleanly, but for Inventor compatibility we have to do
  //    it ourselves.
  for (const voidId of voidIds) {
    const orphanRe = new RegExp(
      `^${voidId.replace('#', '#')}\\s*=\\s*ORIENTED_CLOSED_SHELL[^;]*;\\n?`,
      'm',
    );
    out = out.replace(orphanRe, '');
  }

  return out;
}

/**
 * Stuff every input shape's outer SHELL into a SINGLE `TopoDS_Solid`
 * via `BRep_Builder.Add(solid, shell)`. The resulting Solid is
 * topologically irregular — STEP's `MANIFOLD_SOLID_BREP` expects one
 * outer shell + cavity shells, and our shells are mutually disjoint
 * rather than nested — but OCCT's writer accepts it and serialises it
 * as a single `BREP_WITH_VOIDS` under one PRODUCT. That structure is
 * what Inventor (and SolidWorks, Creo) imports as a single multi-body
 * part where every input solid is now a body inside one .ipt instead
 * of a free-moving sub-assembly component. The trade-off is that the
 * "voids" (sphere 2..N) are recorded as cavities of the "outer shell"
 * (sphere 1), which is semantically wrong; visually each body still
 * renders correctly, and measurement tools still pick up the catalog
 * dimensions because the underlying geometry (CYLINDRICAL_SURFACE,
 * TOROIDAL_SURFACE, SPHERICAL_SURFACE) is unchanged.
 *
 * Use this when you need "multi-body in ONE STEP product" — e.g. the
 * deep-groove ball bearing where the C++ reference's design intent is
 * "one part, N bodies" and the STEP-as-assembly behaviour (each ball
 * draggable independently) breaks downstream measurement workflows.
 *
 * Returns the new TopoDS_Solid; pass it directly to `exportStepBytes`.
 */
export function mergeShapesIntoMultibodySolid(oc: AnyOc, shapes: AnyOc[]): AnyOc {
  if (shapes.length === 0) {
    throw new Error('mergeShapesIntoMultibodySolid: at least one shape required');
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ocAny = oc as any;
  const BuilderCtor = ocAny.BRep_Builder_1 ?? ocAny.BRep_Builder;
  const SolidCtor = ocAny.TopoDS_Solid_1 ?? ocAny.TopoDS_Solid;
  if (!BuilderCtor || !SolidCtor) {
    throw new Error('mergeShapesIntoMultibodySolid: BRep_Builder / TopoDS_Solid binding missing');
  }
  const builder = new BuilderCtor();
  const solid = new SolidCtor();
  builder.MakeSolid(solid);

  let shellsAdded = 0;
  for (const shape of shapes) {
    forEachShape(oc, shape, oc.TopAbs_ShapeEnum.TopAbs_SHELL, (shell) => {
      builder.Add(solid, shell);
      shellsAdded++;
    });
  }
  if (shellsAdded === 0) {
    throw new Error(
      `mergeShapesIntoMultibodySolid: no shells found in ${shapes.length} ` +
        `input shapes — they may be wires/edges, not solids`,
    );
  }
  return solid;
}

/**
 * Export a multi-component assembly to STEP. Each entry in `components`
 * is sent through `STEPControl_Writer.Transfer` separately, so each
 * becomes its own top-level PRODUCT in the resulting file. With STEP
 * assembly mode ON (the default), CAD systems import this as an
 * assembly with one component per entry. A component's `shape` may be
 * a TopoDS_Compound — its sub-solids stay grouped within that single
 * component (e.g. the 8 ball bodies of a bearing all live under one
 * "Ball" component instead of becoming 8 free-moving components).
 *
 * Why this exists, and why it's NOT XCAF-based
 * ────────────────────────────────────────────
 * The C++ reference's bearing output is an Inventor .iam with three
 * named children (Inner, Outer, Ball). The natural OCCT path to a
 * named assembly is `STEPCAFControl_Writer` + an XCAF-managed document,
 * BUT opencascade.js 1.1.1 ships without the `XCAFApp_Application`
 * binding (it's listed in Supported APIs.md with a stub-level marker),
 * so we can't construct the application singleton needed to host the
 * document. The non-CAF path below produces the same 3-component
 * structure — Inventor still imports it as an .iam with 3 children —
 * but the children get OCCT's default names ("Open CASCADE STEP
 * translator 7.4 1.X"). Naming is recovered by `step-bom.ts`'s
 * post-processor downstream of this function (`renameAssemblySubProducts`).
 *
 * What about the "balls move freely" bug?
 * ───────────────────────────────────────
 * That was caused by passing a Compound of 10 disjoint solids (rings +
 * 8 balls) to `exportStepBytes`, which OCCT serialises as 10 separate
 * sub-products — Inventor imports each ball as its own draggable
 * component. By calling Transfer ONCE per logical group (rings as
 * solids, balls as ONE Compound of 8), we end up with 3 sub-products,
 * and the 8 ball bodies share a single component placement that moves
 * as one unit.
 */
export function exportAssemblyStepBytes(
  oc: AnyOc,
  _rootName: string,
  components: AssemblyComponent[],
): Buffer {
  if (components.length === 0) {
    throw new Error('exportAssemblyStepBytes: at least one component required');
  }
  cleanVfsRoot(oc);

  const writer = new oc.STEPControl_Writer_1();
  for (const comp of components) {
    const status = writer.Transfer(
      comp.shape,
      oc.STEPControl_StepModelType.STEPControl_AsIs,
      true,
    );
    const code = status?.value ?? status;
    // 1 = IFSelect_RetDone, 2 = RetVoid (nothing transferred — that
    // would silently drop the component). Both signal failure here.
    if (code !== 1) {
      throw new Error(
        `STEPControl_Writer.Transfer failed for component "${comp.name}" — status=${code}`,
      );
    }
  }

  writer.Write('a.stp');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fs = (oc as any).FS;
  const entries = (fs.readdir('/') as string[]).filter(
    (f: string) => !['.', '..', 'tmp', 'home', 'dev', 'proc'].includes(f),
  );
  if (entries.length === 0) {
    throw new Error('OCCT Write produced no output file in the VFS');
  }
  const target = entries.find((n: string) => n === 'a.stp') ?? entries[0];
  const data = fs.readFile(target) as Uint8Array;
  return Buffer.from(data);
}

// ─────────────────────────────────────────────────────────────────────
// Topology helpers — the tedious-to-remember OCCT binding names.
// ─────────────────────────────────────────────────────────────────────

/**
 * Iterate every sub-shape of `shape` that matches `toFind` (e.g. EDGE,
 * FACE, VERTEX). Each item is automatically downcast to the concrete
 * topology type via the callback's `downcast` helper.
 */
export function forEachShape(
  oc: AnyOc,
  shape: AnyOc,
  toFind: number,
  cb: (current: AnyOc) => void,
): void {
  const explorer = new oc.TopExp_Explorer_2(shape, toFind, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  while (explorer.More()) {
    cb(explorer.Current());
    explorer.Next();
  }
}

/** Downcast a generic TopoDS_Shape to TopoDS_Edge. */
export function toEdge(oc: AnyOc, shape: AnyOc): AnyOc {
  return oc.TopoDS.Edge_1(shape);
}

/** Downcast to TopoDS_Face. */
export function toFace(oc: AnyOc, shape: AnyOc): AnyOc {
  return oc.TopoDS.Face_1(shape);
}

/**
 * Apply a uniform chamfer of `distance` to every edge of `shape`.
 * Edges that can't be chamfered (e.g. on a curved surface boundary
 * already at zero length) are silently skipped, matching the
 * forgiveness of the C++ source's Inventor-side code path.
 */
export function chamferAllEdges(oc: AnyOc, shape: AnyOc, distance: number): AnyOc {
  const maker = new oc.BRepFilletAPI_MakeChamfer(shape);
  forEachShape(oc, shape, oc.TopAbs_ShapeEnum.TopAbs_EDGE, (sub) => {
    try {
      const edge = toEdge(oc, sub);
      maker.Add_2(distance, edge);
    } catch {
      /* skip edges that can't be chamfered */
    }
  });
  return maker.Shape();
}

/** Apply a uniform fillet of `radius` to every edge. */
export function filletAllEdges(oc: AnyOc, shape: AnyOc, radius: number): AnyOc {
  const maker = new oc.BRepFilletAPI_MakeFillet(shape);
  forEachShape(oc, shape, oc.TopAbs_ShapeEnum.TopAbs_EDGE, (sub) => {
    try {
      const edge = toEdge(oc, sub);
      maker.Add_2(radius, edge);
    } catch {
      /* skip edges that can't be filleted */
    }
  });
  return maker.Shape();
}

// ─────────────────────────────────────────────────────────────────────
// Primitive shape builders — the ones that cover most bolt/nut/washer
// geometry without further OCCT knowledge on the caller side.
// ─────────────────────────────────────────────────────────────────────

export function makeCylinder(oc: AnyOc, radius: number, height: number): AnyOc {
  const ax = new oc.gp_Ax2_3(
    new oc.gp_Pnt_3(0, 0, 0),
    new oc.gp_Dir_4(0, 0, 1),
  );
  return new oc.BRepPrimAPI_MakeCylinder_3(ax, radius, height).Shape();
}

export function makeBox(oc: AnyOc, sx: number, sy: number, sz: number): AnyOc {
  const corner = new oc.gp_Pnt_3(-sx / 2, -sy / 2, 0);
  return new oc.BRepPrimAPI_MakeBox_2(corner, sx, sy, sz).Shape();
}

/**
 * Regular hexagonal prism — across-flats `acrossFlats`, height `h`,
 * base at z=0 and top at z=`h`. Flats aligned with the X/Y axes (a
 * vertex is at angle 30° from +X, matching hand-written hexPrism).
 *
 * Built via MakePolygon → MakeFace → MakePrism (extrude).
 */
export function makeHexPrism(oc: AnyOc, acrossFlats: number, height: number): AnyOc {
  const R = acrossFlats / Math.sqrt(3); // circumradius
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const polyBuilder = new (oc as any).BRepBuilderAPI_MakePolygon_1();
  for (let i = 0; i < 6; i++) {
    const a = ((30 + 60 * i) * Math.PI) / 180;
    polyBuilder.Add_1(new oc.gp_Pnt_3(R * Math.cos(a), R * Math.sin(a), 0));
  }
  polyBuilder.Close();
  const wire = polyBuilder.Wire();

  // Planar face from wire. MakeFace_15(wire, onlyPlane) works for a
  // simple planar polygon in opencascade.js 1.1.1.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const face = new (oc as any).BRepBuilderAPI_MakeFace_15(wire, true).Face();

  // Extrude +Z by `height`. MakePrism_1(face, vec, copy, canonize).
  const vec = new oc.gp_Vec_4(0, 0, height);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new (oc as any).BRepPrimAPI_MakePrism_1(face, vec, false, true).Shape();
}

/**
 * Boolean cut (A − B) — removes B's volume from A. Used to cut thread
 * grooves from a cylindrical shaft. Mirrors `boolFuse`: uses the _3
 * overload (a, b) to match the binding generator's numbering.
 *
 * Why we check IsDone()/HasErrors() even though OCCT "throws":
 *   opencascade.js 1.1.1's emscripten build lacks `___cxa_can_catch`,
 *   so real C++ throws from deep inside OCCT crash the WASM runtime
 *   instead of propagating to JS. Before that happens, OCCT's own
 *   boolean-algo bookkeeping flags the failure on the algo object.
 *   Surfacing those flags as JS `throw` gives the bolt fallback logic
 *   a clean signal (instead of a silently degraded shape or a runtime
 *   crash on the NEXT call).
 */
export function boolCut(oc: AnyOc, a: AnyOc, b: AnyOc): AnyOc {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const CutCtor = (oc as any).BRepAlgoAPI_Cut_3;
  if (!CutCtor) throw new Error('OCCT BRepAlgoAPI_Cut_3 not available');
  const op = new CutCtor(a, b);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (op as any).Build?.();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const isDone = (op as any).IsDone?.() ?? true;
  if (!isDone) {
    throw new Error('OCCT BRepAlgoAPI_Cut: IsDone()=false — boolean failed');
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hasErrors = (op as any).HasErrors?.() ?? false;
  if (hasErrors) {
    throw new Error('OCCT BRepAlgoAPI_Cut: HasErrors()=true — degenerate input geometry');
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (op as any).Shape();
}

/**
 * 2D point in the XZ profile plane: `[radial, axial]`. Used by the
 * bearing-ring profile builder where X is radial distance from the
 * bearing axis and Z is axial position.
 */
export type ProfilePoint2D = readonly [number, number];

/**
 * One segment of a bearing-ring profile. Lines need only the end point
 * (start = previous segment's end). Arcs need the end point plus a
 * center and direction (`ccw` true = counterclockwise viewed from +Y,
 * which appears CONVEX from the metal-side; `ccw` false = clockwise =
 * CONCAVE, used for the raceway groove arc).
 *
 * The profile builder consumes a list of segments PLUS a starting
 * point (`startAt`) so each subsequent segment connects from the
 * previous one's end.
 */
export type ProfileSegment =
  | { kind: 'line'; to: ProfilePoint2D }
  | { kind: 'arc'; to: ProfilePoint2D; center: ProfilePoint2D; ccw: boolean };

/**
 * Build a closed `TopoDS_Wire` lying in the global XZ plane (Y=0) from
 * a sequence of line + arc segments. The wire is suitable for direct
 * consumption by `makeRevolZ` to produce solids of revolution like
 * bearing rings, pulleys, or any ring with a contoured cross-section.
 *
 * Why this exists
 * ───────────────
 * The bolt thread cutter uses a polygon (`BRepBuilderAPI_MakePolygon`)
 * because every segment is a straight line. Bearings need the inner /
 * outer ring's raceway as a TRUE arc — `BRepBuilderAPI_MakePolygon`
 * approximates the arc by sampling, which both inflates the STEP file
 * size and turns a clean `TOROIDAL_SURFACE` into many tiny `PLANE`
 * facets. Designers measuring radii in CAD then read the chord length
 * of each facet, not the actual radius.
 *
 * Geometry
 * ────────
 *   · Lines: built via `BRepBuilderAPI_MakeEdge_3(p1, p2)`.
 *   · Arcs:  built via a `Geom_Circle` with axis = +Y (perpendicular
 *            to the XZ profile plane), trimmed by parameter angles
 *            measured CCW from the +X direction. The `ccw` flag picks
 *            the short or long way around — both arcs from p1→p2 are
 *            geometrically valid; the chooser uses the C++ reference's
 *            convention (`ccw=true` ⇒ convex from inside, `ccw=false`
 *            ⇒ concave, used for raceway grooves).
 *
 * Throws if the segment list doesn't close (last segment's end ≠
 * `startAt` within 1e-6 mm) — `BRepPrimAPI_MakeRevol` requires a
 * closed wire and silently fails downstream otherwise.
 */
export function makeProfileWireXZ(
  oc: AnyOc,
  startAt: ProfilePoint2D,
  segments: readonly ProfileSegment[],
): AnyOc {
  if (segments.length === 0) {
    throw new Error('makeProfileWireXZ: at least one segment required');
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ocAny = oc as any;
  const wireBuilder = new ocAny.BRepBuilderAPI_MakeWire_1();

  let prev: ProfilePoint2D = startAt;
  for (const seg of segments) {
    const edge = buildSegmentEdge(oc, prev, seg);
    wireBuilder.Add_1(edge);
    prev = seg.to;
  }

  // Closure check — the wire must form a loop or MakeFace will reject it.
  const dx = prev[0] - startAt[0];
  const dz = prev[1] - startAt[1];
  if (Math.hypot(dx, dz) > 1e-6) {
    throw new Error(
      `makeProfileWireXZ: profile not closed (start=${JSON.stringify(startAt)} ` +
        `end=${JSON.stringify(prev)}, gap=${Math.hypot(dx, dz).toExponential(2)})`,
    );
  }
  return wireBuilder.Wire();
}

/**
 * Build a single line OR arc edge in the XZ plane between two points.
 * Internal helper for `makeProfileWireXZ`.
 */
function buildSegmentEdge(oc: AnyOc, from: ProfilePoint2D, seg: ProfileSegment): AnyOc {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ocAny = oc as any;
  const p1 = new oc.gp_Pnt_3(from[0], 0, from[1]);
  const p2 = new oc.gp_Pnt_3(seg.to[0], 0, seg.to[1]);

  if (seg.kind === 'line') {
    return new ocAny.BRepBuilderAPI_MakeEdge_3(p1, p2).Edge();
  }

  // Arc: build a Geom_Circle with axis = +Y (or -Y for CCW).
  // OCCT's parameter t for a circle is the CCW angle (right-hand rule
  // around the Ax2 axis) measured from the X-direction of the Ax2.
  // We want:
  //   ccw=true  → short CCW arc viewed from +Y
  //   ccw=false → short CW  arc viewed from +Y (equivalent to CCW around -Y)
  // Picking the axis direction collapses the two cases to a single
  // formula: parameter increases monotonically from start to end.
  // Build the arc via Geom_TrimmedCurve and the single-arg
  // BRepBuilderAPI_MakeEdge overload (the multi-arg overloads in the
  // opencascade.js 1.1.1 build are picky about parameter signatures —
  // _24 strictly accepts ONE handle).
  //
  //   1. Derive radius from the start/end distance to center.
  //   2. For each candidate axis (+Y / −Y), compute parameter angles
  //      t1/t2 for start/end. The parameter direction depends on the
  //      axis:
  //        +Y → localY = (0,0,−1) → point(t) = (cx+r·cos t, 0, cz−r·sin t)
  //        −Y → localY = (0,0,+1) → point(t) = (cx+r·cos t, 0, cz+r·sin t)
  //   3. Pick the axis whose `t2 − t1` (after normalising t2 > t1) is
  //      ≤ π — i.e. the SHORT arc. Geometrically, exactly one of the
  //      two axes yields the short arc as the increasing-parameter
  //      direction; the other gives the long arc.
  //   4. Trim the circle and wrap in a single Handle_Geom_Curve.
  //
  // The `seg.ccw` flag is intentionally ignored: the SHORT arc between
  // two points on a circle is geometrically unique (90° fillets, raceway
  // grooves). For arcs that would need to span > π, callers should
  // split them into multiple segments.
  const cx = seg.center[0];
  const cz = seg.center[1];
  const radius = Math.hypot(from[0] - cx, from[1] - cz);
  const radius2 = Math.hypot(seg.to[0] - cx, seg.to[1] - cz);
  if (Math.abs(radius - radius2) > 1e-4) {
    throw new Error(
      `buildSegmentEdge: arc start/end not equidistant from center ` +
        `(r1=${radius.toFixed(4)} r2=${radius2.toFixed(4)})`,
    );
  }
  const center3 = new oc.gp_Pnt_3(cx, 0, cz);
  const xRefDir = new oc.gp_Dir_4(1, 0, 0);

  for (const axisY of [+1, -1] as const) {
    let t1: number;
    let t2: number;
    if (axisY === 1) {
      t1 = Math.atan2(cz - from[1], from[0] - cx);
      t2 = Math.atan2(cz - seg.to[1], seg.to[0] - cx);
    } else {
      t1 = Math.atan2(from[1] - cz, from[0] - cx);
      t2 = Math.atan2(seg.to[1] - cz, seg.to[0] - cx);
    }
    while (t2 <= t1) t2 += 2 * Math.PI;
    if (t2 - t1 > Math.PI + 1e-9) continue;
    const axisDir = new oc.gp_Dir_4(0, axisY, 0);
    const ax2 = new ocAny.gp_Ax2_2(center3, axisDir, xRefDir);
    const CircleCtor = ocAny.Geom_Circle_2 ?? ocAny.Geom_Circle_1;
    const circle = new CircleCtor(ax2, radius);
    const hCurve = new ocAny.Handle_Geom_Curve_2(circle);
    const trimmed = new ocAny.Geom_TrimmedCurve(hCurve, t1, t2, true, true);
    const hTrimmed = new ocAny.Handle_Geom_Curve_2(trimmed);
    return new ocAny.BRepBuilderAPI_MakeEdge_24(hTrimmed).Edge();
  }
  throw new Error(
    `buildSegmentEdge: could not build short arc — endpoints may be ` +
      `diametrically opposite (semicircle case not yet supported)`,
  );
}

/**
 * Translate a shape by (dx, dy, dz).
 */
export function translateShape(oc: AnyOc, shape: AnyOc, dx: number, dy: number, dz: number): AnyOc {
  const trsf = new oc.gp_Trsf_1();
  trsf.SetTranslation_1(new oc.gp_Vec_4(dx, dy, dz));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new (oc as any).BRepBuilderAPI_Transform_2(shape, trsf, false).Shape();
}

/**
 * Rotate a shape by `angleRad` radians around the Z-axis (the bearing
 * axis convention used throughout the bolt and bearing generators).
 *
 * `share` controls how the result relates to `shape` for downstream
 * STEP export:
 *   · `share=true` (default) — the result REFERENCES the input's BRep
 *     (BRepBuilderAPI_Transform with copy=false). N rotated clones of
 *     a master shape produce 1 MANIFOLD_SOLID_BREP + N placements in
 *     STEP — Inventor imports them as one logical part instanced N
 *     times via NEXT_ASSEMBLY_USAGE_OCCURRENCE, mirroring the C++
 *     CircularPattern feature where editing one instance updates them
 *     all.
 *   · `share=false` — the result owns a deep copy of the BRep
 *     (copy=true). Each clone becomes its own MANIFOLD_SOLID_BREP in
 *     STEP, so a downstream Boolean op or `Explode` can treat them
 *     independently. The bearing's rolling balls do NOT need this
 *     (they're never modified post-build) — sharing is what produces
 *     the "balls move as one Ball component, not 8 free balls" import
 *     behavior the user reported as required.
 */
export function rotateShapeAroundZ(
  oc: AnyOc,
  shape: AnyOc,
  angleRad: number,
  share = true,
): AnyOc {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ocAny = oc as any;
  const origin = new oc.gp_Pnt_3(0, 0, 0);
  const zdir = new oc.gp_Dir_4(0, 0, 1);
  const ax1 = new ocAny.gp_Ax1_2(origin, zdir);
  const trsf = new oc.gp_Trsf_1();
  trsf.SetRotation_1(ax1, angleRad);
  return new ocAny.BRepBuilderAPI_Transform_2(shape, trsf, !share).Shape();
}

/**
 * Build a sphere of `radius` centered at the given XYZ coordinates.
 * Used by the bearing generator for rolling-ball elements; also
 * useful for any cosmetic-detail point-marker.
 *
 * The opencascade.js 1.1.1 build exposes several MakeSphere overloads
 * with different argument tuples. We try the ones that take a center
 * point in priority order; the helper isolates this binding pickling
 * so callers don't have to know which numbered overload is live.
 */
export function makeSphere(
  oc: AnyOc,
  center: readonly [number, number, number],
  radius: number,
): AnyOc {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ocAny = oc as any;
  // The opencascade.js 1.1.1 build's MakeSphere overload table is
  // confusing — `_3` and similar low-numbered overloads accept a
  // partial-sphere parameter list (`R, angle1, angle2`), not the
  // (Ax2, R) form we'd want. Rather than guessing the right binding
  // number, build the sphere at the ORIGIN with the radius-only
  // overload (`_1` / `_2`) and then translate it. The `translateShape`
  // helper produces an equivalent solid with the surface still
  // expressed as a `SPHERICAL_SURFACE` in STEP, so measurement
  // accuracy is unaffected.
  // opencascade.js 1.1.1 numbers MakeSphere overloads as follows
  // (verified empirically):
  //   _1 → (Standard_Real R)                      ← what we want
  //   _2 → (Standard_Real R, Standard_Real angle1)  (2 args)
  //   _3 → (Standard_Real R, ang1, ang2)            (3 args)
  //   _4 → (Standard_Real R, ang1, ang2, ang3)      (4 args)
  //   _5 → (gp_Pnt center, R) etc.
  // We only need a full sphere; use _1 and translate to the desired
  // center.
  const RadCtor =
    ocAny.BRepPrimAPI_MakeSphere_1 ?? ocAny.BRepPrimAPI_MakeSphere;
  if (!RadCtor) {
    throw new Error('OCCT BRepPrimAPI_MakeSphere not available');
  }
  const sphereAtOrigin = new RadCtor(radius).Shape();
  if (center[0] === 0 && center[1] === 0 && center[2] === 0) {
    return sphereAtOrigin;
  }
  return translateShape(oc, sphereAtOrigin, center[0], center[1], center[2]);
}

/**
 * Build a torus (donut) — major radius (path) + minor radius (tube),
 * axis along +Z, centred at the origin. Translate / rotate after.
 *
 * Used by the plummer-block eye-bolt generator: the lifting eye is a
 * circular ring of cross-section `tubeR`, swept along a circle of
 * radius `pathR`. STEP exports this as a `TOROIDAL_SURFACE`, matching
 * the C++ Inventor `CreateSweep` output exactly.
 *
 * Overload selection mirrors makeSphere: try the simplest binding
 * (`_1` = R1, R2) and translate/rotate the result for non-default
 * positioning.
 */
export function makeTorus(
  oc: AnyOc,
  pathR: number,
  tubeR: number,
): AnyOc {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ocAny = oc as any;
  // opencascade.js 1.1.1's MakeTorus overload table is opaque. Try the
  // simplest binding first (R1, R2 — full torus around +Z), then fall
  // back to others. If none work, throw — the caller can catch and
  // skip the torus rather than crashing the whole build.
  const candidates = [
    ocAny.BRepPrimAPI_MakeTorus_1,
    ocAny.BRepPrimAPI_MakeTorus_2,
    ocAny.BRepPrimAPI_MakeTorus_3,
    ocAny.BRepPrimAPI_MakeTorus,
  ];
  for (const Ctor of candidates) {
    if (!Ctor) continue;
    try {
      const shape = new Ctor(pathR, tubeR).Shape();
      if (shape) return shape;
    } catch {
      // Try next overload
    }
  }
  throw new Error('OCCT BRepPrimAPI_MakeTorus binding not callable with (pathR, tubeR)');
}

/**
 * Revolve a planar closed wire (in the XZ plane, X ≥ 0) around the
 * Z-axis by `angleRad` radians. Produces a solid of revolution.
 *
 * Used for building the "stacked-rings" thread cutter — a zigzag
 * profile revolved 360° becomes a tube whose outer surface alternates
 * between the shaft's major radius and the thread's minor radius,
 * carving a ring-shaped V-groove at each apex when subtracted from a
 * shaft cylinder.
 *
 * Stacked-rings vs true-helix is a deliberate compromise: it looks
 * identical to a real thread at any normal viewing angle but is
 * created from two simple operations (planar revolve + single
 * boolean cut) instead of fragile helical pipe-shell + boolean cut.
 * The opencascade.js 1.1.1 WASM build crashes on the latter across
 * several bolt sizes (see comments in `step-occt.ts`).
 */
/**
 * Revolve a planar closed wire around an ARBITRARY axis defined by an
 * origin point and a direction vector — both expressed in 3D world
 * coordinates. The wire must be planar and contain the axis (or lie on
 * one side of it) for the result to be a valid solid.
 *
 * Used by the taper-roller bearing generator: each roller's revolution
 * axis is tilted relative to the bearing's central Z axis (the contact
 * angle), so `makeRevolZ` (which is hard-wired to +Z) doesn't apply.
 */
export function makeRevolAroundAxis(
  oc: AnyOc,
  wire: AnyOc,
  axisOriginXYZ: readonly [number, number, number],
  axisDirXYZ: readonly [number, number, number],
  angleRad = 2 * Math.PI,
): AnyOc {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ocAny = oc as any;
  const face = new ocAny.BRepBuilderAPI_MakeFace_15(wire, true).Face();
  const origin = new oc.gp_Pnt_3(axisOriginXYZ[0], axisOriginXYZ[1], axisOriginXYZ[2]);
  const dir = new oc.gp_Dir_4(axisDirXYZ[0], axisDirXYZ[1], axisDirXYZ[2]);
  const axis = new ocAny.gp_Ax1_2(origin, dir);
  const RevolCtor =
    ocAny.BRepPrimAPI_MakeRevol_1 ??
    ocAny.BRepPrimAPI_MakeRevol_2 ??
    ocAny.BRepPrimAPI_MakeRevol_3 ??
    ocAny.BRepPrimAPI_MakeRevol;
  if (!RevolCtor) {
    throw new Error('OCCT BRepPrimAPI_MakeRevol binding not available');
  }
  return new RevolCtor(face, axis, angleRad, true).Shape();
}

export function makeRevolZ(oc: AnyOc, wire: AnyOc, angleRad = 2 * Math.PI): AnyOc {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ocAny = oc as any;
  const face = new ocAny.BRepBuilderAPI_MakeFace_15(wire, true).Face();
  const origin = new oc.gp_Pnt_3(0, 0, 0);
  const zdir = new oc.gp_Dir_4(0, 0, 1);
  const axis = new ocAny.gp_Ax1_2(origin, zdir);
  const RevolCtor =
    ocAny.BRepPrimAPI_MakeRevol_1 ??
    ocAny.BRepPrimAPI_MakeRevol_2 ??
    ocAny.BRepPrimAPI_MakeRevol_3 ??
    ocAny.BRepPrimAPI_MakeRevol;
  if (!RevolCtor) {
    throw new Error('OCCT BRepPrimAPI_MakeRevol binding not available');
  }
  return new RevolCtor(face, axis, angleRad, true).Shape();
}

/**
 * Build a stacked-rings thread cutter solid.
 *
 * Visually identical to real helical threads at normal viewing angle;
 * topologically a stack of N full rings — each one a V-groove ring
 * carved out of the shaft's outer surface at the matching axial
 * position. N = floor(threadLen / pitch).
 *
 * Profile (XZ half-plane, revolved around Z):
 *
 *         ┌──────────┐  x = R+EPS (outside shaft, clean boolean)
 *         │          │
 *         │          │  top at z = startZ + N·pitch
 *      ╲  └          │
 *       ╲            │
 *        ╲           │
 *    ... zigzag ...
 *        ╱           │
 *       ╱            │
 *      ╱             │
 *     ╱  ┌           │
 *        │           │  bottom at z = startZ
 *        └───────────┘
 *      x = R (bottom-left)
 *
 * The zigzag's apexes dip inward to x = minorR; between apexes the
 * zigzag returns to x = majorR. When revolved, this traces out the
 * thread rings. When subtracted from the shaft cylinder, each apex
 * becomes a V-groove valley.
 *
 * EPS = 0.2 mm outside-shaft margin so the cutter extends just past
 * the shaft's outer surface, giving OCCT's boolean a clean
 * intersection rather than a tangent-at-boundary case.
 */
export function makeThreadRingsCutter(
  oc: AnyOc,
  majorR: number,
  minorR: number,
  pitch: number,
  startZ: number,
  threadLen: number,
): AnyOc {
  if (pitch <= 0 || majorR <= 0 || minorR <= 0 || majorR <= minorR) {
    throw new Error(
      `makeThreadRingsCutter: invalid parameters (pitch=${pitch}, majorR=${majorR}, minorR=${minorR})`,
    );
  }
  // ceil guarantees the cutter covers `threadLen` fully — the caller's
  // boolCut will truncate whatever extends past the shaft tip, giving
  // a clean tapered end on the last ring.
  const nTurns = Math.ceil(threadLen / pitch);
  if (nTurns < 1) {
    throw new Error(
      `makeThreadRingsCutter: threadLen (${threadLen}) < pitch (${pitch})`,
    );
  }
  const EPS_RADIAL = 0.2;
  // Quarter-pitch axial shift: guarantees zigzag peak vertices never
  // land at startZ + k·pitch exactly. Without this shift, a fully-
  // threaded bolt where (L − startZ) is an integer multiple of pitch
  // would place a peak vertex at z = L, coinciding with the shaft's
  // tip-edge circle and triggering OCCT's tangent-at-boundary failure
  // mode during `boolCut`. The visual impact of the shift is
  // imperceptible (< 0.5 mm on coarse-pitch bolts).
  const zigOffset = 0.25 * pitch;
  const zigBot = startZ + zigOffset;
  const zigTop = zigBot + nTurns * pitch;
  // Top cap extension so the cutter's outer cap surface sits well
  // above the highest zigzag peak.
  const capTop = zigTop + 0.5 * pitch;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const poly = new (oc as any).BRepBuilderAPI_MakePolygon_1();
  // A: bottom-right corner, just outside the shaft at z=startZ
  poly.Add_1(new oc.gp_Pnt_3(majorR + EPS_RADIAL, 0, startZ));
  // B: top-right corner, above all rings
  poly.Add_1(new oc.gp_Pnt_3(majorR + EPS_RADIAL, 0, capTop));
  // C: zigzag start — topmost peak (above zigTop's ring apex)
  poly.Add_1(new oc.gp_Pnt_3(majorR, 0, zigTop));
  // Descending zigzag: nTurns (apex, peak) pairs
  for (let i = nTurns - 1; i >= 0; i--) {
    const zApex = zigBot + i * pitch + pitch / 2;
    const zPeak = zigBot + i * pitch;
    poly.Add_1(new oc.gp_Pnt_3(minorR, 0, zApex));
    poly.Add_1(new oc.gp_Pnt_3(majorR, 0, zPeak));
  }
  // Last vertex added by the loop: (majorR, 0, zigBot). `Close()`
  // implicitly adds a diagonal back to A = (majorR+EPS, 0, startZ)
  // — a tapered bottom ramp mirroring the top B→C diagonal.
  poly.Close();
  const wire = poly.Wire();
  return makeRevolZ(oc, wire, 2 * Math.PI);
}

/**
 * Combine multiple shapes into a TopoDS_Compound. The result behaves as
 * a single "shape" for STEP export while keeping each constituent shape
 * as a first-class sub-entity in the output — no boolean operation is
 * performed, so this is robust for mixing solids + wires (e.g. a bolt
 * body plus its cosmetic helical thread curves).
 */
export function makeCompound(oc: AnyOc, shapes: AnyOc[]): AnyOc {
  // opencascade.js 1.1.1 generates overload-suffixed constructors.
  // Default ctors sometimes appear as `_1` (the first overload) and
  // sometimes unsuffixed. Try both rather than guessing — a missed
  // binding would surface as a "not a constructor" TypeError with an
  // unhelpful stack trace from deep inside emscripten.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ocAny = oc as any;
  const BuilderCtor = ocAny.BRep_Builder_1 ?? ocAny.BRep_Builder;
  const CompoundCtor = ocAny.TopoDS_Compound_1 ?? ocAny.TopoDS_Compound;
  if (!BuilderCtor || !CompoundCtor) {
    throw new Error(
      `makeCompound: OCCT binding missing ` +
        `(BRep_Builder=${!!BuilderCtor} TopoDS_Compound=${!!CompoundCtor})`,
    );
  }
  const builder = new BuilderCtor();
  const compound = new CompoundCtor();
  builder.MakeCompound(compound);
  for (const s of shapes) builder.Add(compound, s);
  return compound;
}

/**
 * Build a single smooth helical wire wrapping around the Z-axis at
 * constant radius `radius`, starting at z=0 and extending +Z by
 * `length`, advancing `pitch` per turn.
 *
 * Returns a `TopoDS_Wire` with one smooth edge (true C∞ helix curve
 * via `Geom_CylindricalSurface` + 2D line trick — not a polyline
 * approximation). Suitable as:
 *   · A cosmetic thread indicator overlaid on a shaft (compounded
 *     with the bolt solid — see `makeCompound`).
 *   · The rail of `BRepOffsetAPI_MakePipeShell` if a real groove is
 *     ever reintroduced.
 *
 * The start point sits at (radius, 0, 0). After `turns = length/pitch`
 * revolutions the end point sits at (radius·cos(θ), radius·sin(θ),
 * length) where θ = 2π·turns.
 */
export function makeHelixWire(
  oc: AnyOc,
  radius: number,
  pitch: number,
  length: number,
): AnyOc {
  if (length <= 0 || pitch <= 0 || radius <= 0) {
    throw new Error('makeHelixWire: invalid parameters');
  }
  const turns = length / pitch;
  const thetaMax = 2 * Math.PI * turns;

  const origin = new oc.gp_Pnt_3(0, 0, 0);
  const zdir = new oc.gp_Dir_4(0, 0, 1);
  const ax2 = new oc.gp_Ax2_3(origin, zdir);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ax3 = new (oc as any).gp_Ax3_2(ax2);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cylSurface = new (oc as any).Geom_CylindricalSurface_1(ax3, radius);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vec2d = new (oc as any).gp_Vec2d_4(1, pitch / (2 * Math.PI));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dir2d = new (oc as any).gp_Dir2d_2(vec2d);
  const p2d = new oc.gp_Pnt2d_3(0, 0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ax2d = new (oc as any).gp_Ax2d_2(p2d, dir2d);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const line2d = new (oc as any).Geom2d_Line_1(ax2d);

  const slope = pitch / (2 * Math.PI);
  const lineParamScale = Math.sqrt(1 + slope * slope);
  const uMax = thetaMax * lineParamScale;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hLine = new (oc as any).Handle_Geom2d_Curve_2(line2d);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const trimmed = new (oc as any).Geom2d_TrimmedCurve(hLine, 0, uMax, true, true);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hTrim = new (oc as any).Handle_Geom2d_Curve_2(trimmed);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hSurf = new (oc as any).Handle_Geom_Surface_2(cylSurface);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const helixEdge = new (oc as any).BRepBuilderAPI_MakeEdge_30(hTrim, hSurf).Edge();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (oc as any).BRepLib.BuildCurves3d_2?.(helixEdge);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new (oc as any).BRepBuilderAPI_MakeWire_2(helixEdge).Wire();
}

/**
 * DEPRECATED — kept only so existing imports don't break during the
 * transition. This is the old swept-V-groove solid; it triggered many
 * OCCT boolean failure modes (manifold count regressions, WASM
 * `___cxa_can_catch` crashes, shaft-eating cuts) across real bolt
 * sizes. New code should build a solid bolt and overlay
 * `makeHelixWire` via `makeCompound` — that mirrors how the C++
 * reference (`NewCreateBoltClass.cpp` line 1541–1579) delegates
 * thread rendering to Inventor's cosmetic-thread feature instead of
 * CSG.
 */
export function makeHelicalThread(
  oc: AnyOc,
  rOuter: number,
  pitch: number,
  threadLength: number,
  depth = 0.54 * pitch,
): AnyOc {
  if (threadLength <= 0 || pitch <= 0 || rOuter <= 0) {
    throw new Error('makeHelicalThread: invalid thread parameters');
  }
  const turns = threadLength / pitch;
  const thetaMax = 2 * Math.PI * turns;

  // 1. Cylindrical surface on +Z
  const origin = new oc.gp_Pnt_3(0, 0, 0);
  const zdir = new oc.gp_Dir_4(0, 0, 1);
  const ax2 = new oc.gp_Ax2_3(origin, zdir);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ax3 = new (oc as any).gp_Ax3_2(ax2);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cylSurface = new (oc as any).Geom_CylindricalSurface_1(ax3, rOuter);

  // 2. 2D line in (u,v) parametrization with slope pitch/(2π). Direction
  //    must be a unit vector — gp_Dir2d normalises automatically.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vec2d = new (oc as any).gp_Vec2d_4(1, pitch / (2 * Math.PI));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dir2d = new (oc as any).gp_Dir2d_2(vec2d);
  const p2d = new oc.gp_Pnt2d_3(0, 0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ax2d = new (oc as any).gp_Ax2d_2(p2d, dir2d);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const line2d = new (oc as any).Geom2d_Line_1(ax2d);

  // 3. Wrap in Handle_Geom2d_Curve + trim to the helix range.
  //    Note: the u-parameter on a unit-direction line equals arc length
  //    in (u,v) space, so a line of slope s covers Δθ and Δz·s in u.
  //    For exactly `turns` full revolutions we need u = √(1 + s²)·Δθ.
  const slope = pitch / (2 * Math.PI);
  const lineParamScale = Math.sqrt(1 + slope * slope);
  const uMax = thetaMax * lineParamScale;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hLine = new (oc as any).Handle_Geom2d_Curve_2(line2d);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const trimmed = new (oc as any).Geom2d_TrimmedCurve(hLine, 0, uMax, true, true);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hTrim = new (oc as any).Handle_Geom2d_Curve_2(trimmed);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hSurf = new (oc as any).Handle_Geom_Surface_2(cylSurface);

  // 4. Build the 3D edge (curve-on-surface) and force its 3D curve.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const helixEdge = new (oc as any).BRepBuilderAPI_MakeEdge_30(hTrim, hSurf).Edge();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (oc as any).BRepLib.BuildCurves3d_2?.(helixEdge);

  // 5. Wire from single edge
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const helixWire = new (oc as any).BRepBuilderAPI_MakeWire_2(helixEdge).Wire();

  // 6. V-profile groove cross-section (triangle) in the XZ plane:
  //    outer-bottom → apex (innermost) → outer-top, closing back.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const profilePoly = new (oc as any).BRepBuilderAPI_MakePolygon_1();
  profilePoly.Add_1(new oc.gp_Pnt_3(rOuter, 0, 0));
  profilePoly.Add_1(new oc.gp_Pnt_3(rOuter - depth, 0, pitch / 2));
  profilePoly.Add_1(new oc.gp_Pnt_3(rOuter, 0, pitch));
  profilePoly.Close();
  const profileWire = profilePoly.Wire();

  // 7. Sweep profile along smooth helix
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pipe = new (oc as any).BRepOffsetAPI_MakePipeShell(helixWire);
  pipe.Add_1(profileWire, false, false);
  pipe.Build();
  // IsDone() flags sweep failures (profile self-intersection, bad frame)
  // that OCCT logs internally without throwing to JS. Surfacing them here
  // lets the bolt generator fall back cleanly instead of handing a
  // corrupted solid to the subsequent boolean cut.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((pipe as any).IsDone && !(pipe as any).IsDone()) {
    throw new Error('makeHelicalThread: MakePipeShell.IsDone()=false');
  }
  pipe.MakeSolid();
  return pipe.Shape();
}

/**
 * Boolean fuse — glues two shapes into one solid with shared faces
 * removed. Used to combine bolt head + shaft into a single solid
 * (hand-written STEP emits them as two disjoint shells).
 *
 * opencascade.js 1.1.1 exposes several BRepAlgoAPI_Fuse overloads; we
 * try them in order from "no progress arg" to "with progress" and use
 * the first that doesn't throw on our build.
 */
export function boolFuse(oc: AnyOc, a: AnyOc, b: AnyOc): AnyOc {
  // opencascade.js 1.1.1 exposes _3 as the standard 2-shape Fuse
  // (the binding generator shifted the overload numbering by one).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const FuseCtor = (oc as any).BRepAlgoAPI_Fuse_3;
  if (!FuseCtor) {
    throw new Error('OCCT BRepAlgoAPI_Fuse_3 not available in this build');
  }
  const op = new FuseCtor(a, b);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (op as any).Build?.();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (op as any).Shape();
}
