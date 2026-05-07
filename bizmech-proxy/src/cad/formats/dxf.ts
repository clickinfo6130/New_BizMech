/**
 * DXF file composer — wraps a generator's ENTITIES with the standard
 * HEADER / TABLES (layers) / BLOCKS scaffolding and emits bytes.
 *
 * Generators (in parts/*) call `assembleDxfFile(req, build)` where
 * `build` is a callback that draws lines/text/dims into the provided
 * DxfBuilder. The composer handles the boilerplate so every part gets
 * a consistent layer set and units.
 */
import type { CadGenerateRequest, CadGenerateResult } from '../types.js';
import { FORMAT_EXT, FORMAT_MIME } from '../types.js';
import { DxfBuilder, emitStandardLayers } from '../core/dxf.js';
import { bomFileName } from '../core/bom-meta.js';

export type DxfGenerator = (b: DxfBuilder) => void;

export interface DxfAssembleOptions {
  /** Override the ACAD version string. Default AC1009 (R12). */
  acadVersion?: string;
  /** Override the drawing units. Default 4 (millimeters). */
  insUnits?: number;
}

export function assembleDxfFile(
  req: CadGenerateRequest,
  build: DxfGenerator,
  opts: DxfAssembleOptions = {},
): CadGenerateResult {
  const started = Date.now();
  const b = new DxfBuilder();

  // HEADER
  b.raw('0\r\nSECTION');
  b.raw('2\r\nHEADER');
  b.raw('9\r\n$ACADVER');
  b.code(1, opts.acadVersion ?? 'AC1009');
  b.raw('9\r\n$INSUNITS');
  b.code(70, opts.insUnits ?? 4);
  b.raw('0\r\nENDSEC');

  // TABLES — layers
  b.raw('0\r\nSECTION');
  b.raw('2\r\nTABLES');
  b.raw('0\r\nTABLE');
  b.raw('2\r\nLAYER');
  b.code(70, 4);
  emitStandardLayers(b);
  b.raw('0\r\nENDTAB');
  b.raw('0\r\nENDSEC');

  // BLOCKS — empty but required by R12
  b.raw('0\r\nSECTION');
  b.raw('2\r\nBLOCKS');
  b.raw('0\r\nENDSEC');

  // ENTITIES — the generator fills this
  b.raw('0\r\nSECTION');
  b.raw('2\r\nENTITIES');
  build(b);
  b.raw('0\r\nENDSEC');

  b.raw('0\r\nEOF');

  const ext = FORMAT_EXT.DXF;
  const mimeType = FORMAT_MIME.DXF;
  return {
    bytes: Buffer.from(b.render(), 'utf-8'),
    format: 'DXF',
    mimeType,
    ext,
    backend: 'local',
    generatedMs: Date.now() - started,
    // Same BOM-aware filename rule as STEP for consistency.
    fileName: bomFileName(req, ext),
  };
}
