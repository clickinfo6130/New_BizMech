/**
 * Shared CAD-domain types. Mirrors BizMech-web/src/types/index.ts on the
 * frontend side so the wire format stays in lockstep.
 *
 * A download request is normalized into a CadGenerateRequest before it
 * reaches the worker. The worker produces a CadGenerateResult which the
 * orchestrator stores in the file cache and serves via a stable hash URL.
 */

export type CadFormat =
  | 'STEP'
  | 'DXF'
  | 'IGES'
  // CAD Exchanger-only (Phase 2):
  | 'DWG'
  | 'IPT'
  | 'SLDPRT'
  | 'Z3'
  | 'STL';

/** local = written by our in-process generator; exchanger = STEP → native via Cad Exchanger. */
export type CadBackend = 'local' | 'exchanger';

export const FORMAT_MIME: Record<CadFormat, string> = {
  STEP: 'application/step',
  IGES: 'application/iges',
  DXF: 'application/dxf',
  DWG: 'application/acad',
  IPT: 'application/octet-stream',
  SLDPRT: 'application/octet-stream',
  Z3: 'application/octet-stream',
  STL: 'model/stl',
};

export const FORMAT_EXT: Record<CadFormat, string> = {
  STEP: 'stp',
  IGES: 'igs',
  DXF: 'dxf',
  DWG: 'dwg',
  IPT: 'ipt',
  SLDPRT: 'sldprt',
  Z3: 'Z3',
  STL: 'stl',
};

/**
 * Formats we can generate without an external CAD Exchanger account.
 * IGES is intentionally NOT here yet — no generator implements it.
 * Leaving it in LOCAL_FORMATS would produce a 500 on click; listing
 * it in EXCHANGER_FORMATS (or removing it from both) shows a clear
 * "준비 중" instead. Add IGES back once the writer lands.
 */
export const LOCAL_FORMATS: readonly CadFormat[] = ['STEP', 'DXF'];

/** Formats that currently require CAD Exchanger (Phase 2). */
export const EXCHANGER_FORMATS: readonly CadFormat[] = ['IGES', 'DWG', 'IPT', 'SLDPRT', 'Z3', 'STL'];

/**
 * Canonical input to the CAD worker. Every field that can affect the output
 * MUST be on this object — the cache key is derived from its JSON form.
 */
export interface CadGenerateRequest {
  /** partspec.part_code, e.g. "HBOLT". */
  partCode: string;
  /** partdimension.key_composite, e.g. "HBOLT|KS B 1002|M10". */
  keyComposite: string;
  /** Concrete dimensions (e.g. { d:10, L:30, H:6.4, S:17, pitch:1.5 }). */
  dimensions: Record<string, number | string>;
  /** e.g. "SCM435". Optional — if omitted, defaulted by the generator. */
  material?: string;
  /** e.g. "무처리", "흑색산화". Optional. */
  surface?: string;
  /** Target CAD format. */
  format: CadFormat;
  /** Display locale (affects DXF text labels + STEP metadata). */
  locale?: 'ko' | 'en' | 'ja' | 'zh';

  // ── BOM metadata (embedded into STEP `PRODUCT` entity + header) ──
  // The download orchestrator fills these from partspec / partdimension
  // before the worker runs. Generators forward them through the STEP
  // post-processor so a CAD application (Inventor, SolidWorks) opening
  // the file sees a populated `iProperty` set:
  //   PRODUCT.description ← partName       (Inventor: Description)
  //   PRODUCT.id / .name  ← specification  (Inventor: Part Number)
  //   PROPERTY_DEFINITION ← material       (Inventor: MaterialSpec)
  //   PROPERTY_DEFINITION ← standard       (Inventor: Stock Number)
  // The cache key includes these — so changing material flushes the
  // cached file even though the geometry is identical.
  /** Display name from partspec.part_name, e.g. "육각머리볼트". */
  partName?: string;
  /** Standard number, e.g. "KS B 1002:2016". */
  standard?: string;
}

/** Raw bytes + metadata returned by the worker. */
export interface CadGenerateResult {
  /** File bytes (UTF-8 encoded text for STEP/DXF/IGES; binary for DWG/STL). */
  bytes: Buffer;
  /** Exact output format (echoed from request). */
  format: CadFormat;
  /** Content-Type for HTTP serving. */
  mimeType: string;
  /** Suggested file extension (no leading dot). */
  ext: string;
  /** Backend that produced the file. */
  backend: CadBackend;
  /** Generation time in ms (wall-clock inside the worker). */
  generatedMs: number;
  /** Display file name for the browser. */
  fileName: string;
  /**
   * When true, the orchestrator must NOT cache this result. Set by
   * generators that produced a degraded-quality fallback (e.g. OCCT
   * crashed and we returned hand-written STEP without real thread
   * grooves). The next request for the same spec then re-attempts
   * the preferred backend on a fresh WASM runtime.
   */
  noCache?: boolean;
}
