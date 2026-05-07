/**
 * BOM metadata resolver — assembles the four fields a CAD application
 * (Inventor / SolidWorks) reads as part-level "iProperty" data when a
 * STEP file is opened:
 *
 *   ┌─────────────────────┬─────────────────┬─────────────────────────┐
 *   │ BOM column          │ iProperty       │ Source                  │
 *   ├─────────────────────┼─────────────────┼─────────────────────────┤
 *   │ 부품명               │ Description     │ partspec.part_name      │
 *   │ 규격                 │ Part Number     │ partCode + size + length│
 *   │ 재질                 │ MaterialSpec    │ user-selected option    │
 *   │ 규격번호             │ Stock Number    │ keyComposite[1] or 표준 │
 *   └─────────────────────┴─────────────────┴─────────────────────────┘
 *
 * The 단중 (unit weight) / 총중량 (total weight) columns are filled in
 * by the CAD application from the imported geometry — no embedding
 * required on our side.
 *
 * The output is a pure data structure consumed by `embedBomInStep`.
 * Empty strings (rather than null/undefined) are returned for missing
 * fields so the post-processor can write deterministic STEP regardless
 * of which fields the request supplied.
 */
import type { CadGenerateRequest } from '../types.js';

export interface BomMetadata {
  /** "육각머리볼트" — part name shown in the BOM Manager's 부품명 column. */
  partName: string;
  /** "SUS304" — material name from the user's spec selection. */
  material: string;
  /** "M10X1.5-40L" — unique specification string used as Part Number. */
  specification: string;
  /** "KS B 1002:2016" — engineering standard reference number. */
  standard: string;
}

/**
 * Derive the four BOM fields from a CadGenerateRequest. All inputs are
 * already merged into the request by `download.ts`:
 *   · partName / standard — explicit fields
 *   · material            — explicit field, falls back to dimensions["재질"]
 *   · specification       — composed from partCode + size + length
 *
 * Spec-string format mirrors the KS bolt convention used by the C++
 * reference (NewCreateBoltClass.cpp ~line 60): `<size>X<pitch>-<length>L`
 * for fastenered parts (e.g. "M10X1.5-40L"), `<size>` for non-threaded
 * parts (washers etc.), and the keyComposite's tail segment as a
 * generic fallback for other families.
 */
export function resolveBomMetadata(req: CadGenerateRequest): BomMetadata {
  return {
    partName: (req.partName ?? '').trim() || req.partCode,
    material: (req.material ?? readDimAlias(req.dimensions, ['재질', 'Material', 'material']) ?? '')
      .toString()
      .trim(),
    specification: composeSpecification(req),
    standard: (req.standard ?? '').toString().trim(),
  };
}

/**
 * Build the Part-Number style spec string. Threaded fasteners use the
 * `<sizeLabel>X<pitch>-<length>L` convention (e.g. "M10X1.5-40L"), with
 * the size taken from the user's spec selection when available so non-
 * standard sizes survive verbatim ("M14F", "G3/8" etc.).
 */
function composeSpecification(req: CadGenerateRequest): string {
  const dims = req.dimensions;

  // ── Size label ──
  const sizeLabel =
    readDimAlias(dims, ['List', '사이즈', 'Size', 'size', '호칭', 'Nominal']) ??
    (typeof dims.d === 'number' ? `M${dims.d}` : null) ??
    (typeof dims.M === 'number' ? `M${dims.M}` : null);

  // ── Pitch (threaded fasteners only) ──
  const pitchRaw = readDimAlias(dims, ['pitch', 'P', 'P1(UNC)', 'P2(UNF)']);
  const pitch =
    pitchRaw != null && Number.isFinite(Number(pitchRaw)) && Number(pitchRaw) > 0
      ? Number(pitchRaw)
      : null;

  // ── Length ──
  const lengthRaw = readDimAlias(dims, [
    'L',
    '전체길이',
    'length',
    'Length',
    'Length_min',
    'Length_default',
  ]);
  const length =
    lengthRaw != null && Number.isFinite(Number(lengthRaw)) && Number(lengthRaw) > 0
      ? Number(lengthRaw)
      : null;

  if (sizeLabel) {
    let s = String(sizeLabel).trim();
    if (pitch != null) s += `X${formatNumber(pitch)}`;
    if (length != null) s += `-${formatNumber(length)}L`;
    if (s) return s;
  }

  // Fallback — last segment of the keyComposite (e.g. "HBOLT|KS B 1002|M10" → "M10").
  if (req.keyComposite) {
    const last = req.keyComposite.split('|').pop()?.trim();
    if (last) return last;
  }
  return req.partCode;
}

/** Trim trailing zeros without forcing a fixed precision: 1.5 → "1.5", 40 → "40". */
function formatNumber(n: number): string {
  const s = Number(n.toFixed(4)).toString();
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}

function readDimAlias(
  dims: Record<string, number | string>,
  aliases: readonly string[],
): string | number | null {
  for (const k of aliases) {
    const v = dims[k];
    if (v == null || v === '') continue;
    return v;
  }
  return null;
}

/**
 * Build a download filename keyed off the BOM specification string —
 * "M6X1-40L.stp" instead of the legacy "HBOLT_HBOLT_KS_B_1002_M6.stp".
 *
 * Why this matters
 * ─────────────────
 * Inventor's STEP→IPT importer uses the source FILENAME as the IPT's
 * filename and (by default) as the tree-browser display label.
 * Importing a STEP whose name encodes an internal part code reproduces
 * that mess in the assembly tree:
 *
 *   AS-DRAWN tree:    [•]:M6X1-40L:1
 *   AS-IMPORTED tree: HBOLT_HBOLT_KS_B_1002_M6_(2).ipt   ← legacy
 *
 * Sanitisation rules:
 *   · Windows-illegal characters (`<>:"/\\|?*`) and whitespace → "_"
 *   · Non-printable / non-ASCII bytes → stripped (Inventor sometimes
 *     mis-encodes Korean filenames on import; we keep the ASCII
 *     specification — Description/Part Number iProperties carry the
 *     Korean part name instead).
 *   · Repeated underscores collapsed and trimmed at edges.
 *
 * Falls back to `partCode` if the spec resolves to an empty string.
 */
export function bomFileName(req: CadGenerateRequest, ext: string): string {
  const bom = resolveBomMetadata(req);
  const cleaned = bom.specification
    .replace(/[<>:"/\\|?*\s]+/g, '_')
    .replace(/[^\x21-\x7E]+/g, '')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `${cleaned || req.partCode}.${ext}`;
}
