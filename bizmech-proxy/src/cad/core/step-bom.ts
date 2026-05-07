/**
 * STEP BOM embedder — post-processes a freshly generated STEP file so
 * a CAD application reading it sees populated `iProperty`-equivalent
 * metadata.
 *
 *   ┌─────────────────────┬──────────────────────────────────────────┐
 *   │ BOM field           │ STEP entity                              │
 *   ├─────────────────────┼──────────────────────────────────────────┤
 *   │ 부품명               │ PRODUCT.description (3rd arg)            │
 *   │ 규격 (Part Number)   │ PRODUCT.id + PRODUCT.name (1st & 2nd arg)│
 *   │ 재질                 │ HEADER.FILE_NAME description string +    │
 *   │                     │   trailing comment block                  │
 *   │ 규격번호 (Stock No.) │ HEADER.FILE_NAME description string +    │
 *   │                     │   trailing comment block                  │
 *   └─────────────────────┴──────────────────────────────────────────┘
 *
 * Why this approach (vs adding PROPERTY_DEFINITION entities)
 * ───────────────────────────────────────────────────────────
 * AP214 supports `PROPERTY_DEFINITION` + `PROPERTY_DEFINITION_REPRESENTATION`
 * for arbitrary user-defined attributes, but Inventor's STEP importer
 * does NOT map those into iProperties on import — they end up in
 * Custom Document Properties at best. By contrast Inventor reliably
 * maps:
 *   PRODUCT.id          → Part Number  (Design Tracking iProperty)
 *   PRODUCT.description → Description  (Design Tracking iProperty)
 *
 * The remaining two fields (Material, Stock Number) Inventor's STEP
 * importer leaves blank regardless of how they're encoded; users
 * either edit them manually post-import or the CAD-side BOM extractor
 * (PartManager.Bom) gets a STEP-aware implementation later. We DO
 * include all four in the file so a future extractor (or any STEP
 * text inspection) can recover them — the comment block at the end
 * of the DATA section is a stable, machine-parseable anchor.
 *
 * The post-processor is non-destructive: if it can't find the PRODUCT
 * entity (unexpected STEP variant) it returns the input bytes
 * unmodified rather than risking corruption.
 */
import type { BomMetadata } from './bom-meta.js';

/**
 * Marker line that delimits the BOM block at the end of the STEP file.
 * A future STEP-based BOM extractor can locate this block via simple
 * substring search rather than parsing PRODUCT entities.
 *
 * Format: each line is `/* <KEY>=<value> *<slash>` — an in-comment
 * key=value pair. STEP comments (`/* ... *<slash>`) are valid anywhere
 * in the file and ignored by every parser.
 */
const BOM_BLOCK_BEGIN = '/* BIZMECH_BOM_BEGIN */';
const BOM_BLOCK_END = '/* BIZMECH_BOM_END */';

export function embedBomInStep(stepText: string, bom: BomMetadata): string {
  if (!stepText) return stepText;

  let out = stepText;

  // 1. Rewrite the first PRODUCT entity to carry the Part Number + Part Name.
  out = rewriteFirstProduct(out, bom);

  // 2. Rewrite the FILE_NAME header so the description / author fields
  //    surface the BOM info even if the importer ignores PRODUCT.
  out = rewriteFileNameHeader(out, bom);

  // 3. Append a stable comment block holding all four BOM fields.
  //    Idempotent: if a previous block exists we replace it.
  out = upsertBomCommentBlock(out, bom);

  return out;
}

/**
 * Replace the first occurrence of `PRODUCT('...','...','...',(...))` so
 * its first 3 arguments carry the BOM identity:
 *
 *   PRODUCT('M10X1.5-40L','M10X1.5-40L','육각머리볼트',(#frames));
 *
 * We preserve the 4th argument (the frame-of-reference list) verbatim
 * because it references entity numbers we mustn't disturb.
 */
function rewriteFirstProduct(stepText: string, bom: BomMetadata): string {
  // Regex anchors: keyword PRODUCT, opening paren, three `'..'` strings
  // (with possible escaped quotes), then `(...)` for frames, then `);`.
  // STEP allows newlines + indentation between tokens — `\s*` everywhere.
  const re =
    /(=\s*PRODUCT\s*\(\s*)('(?:[^']|'')*')\s*,\s*('(?:[^']|'')*')\s*,\s*('(?:[^']|'')*')(\s*,\s*\([^)]*\)\s*\)\s*;)/;
  const m = stepText.match(re);
  if (!m) return stepText;
  const partNumber = stepEscape(bom.specification || 'BizMech_Part');
  const partLabel = stepEscape(bom.specification || 'BizMech_Part');
  const description = stepEscape(bom.partName || '');
  return stepText.replace(
    re,
    `$1'${partNumber}','${partLabel}','${description}'$5`,
  );
}

/**
 * Update the STEP HEADER section's FILE_NAME description list. AP214
 * defines `FILE_NAME(name, time, author[], org[], preprocessor, system,
 * authorisation)`. The 5th and 6th args (preprocessor + system) are
 * narrative strings — we hijack the description portion in `name` to
 * encode the BOM, so a human inspecting the file can read it without
 * tooling.
 *
 * Specifically we set the FILE_NAME `name` argument to the spec string
 * (e.g. "M10X1.5-40L") and the `description` (1st arg of FILE_NAME) is
 * a list which we leave alone; instead we stamp the human-readable BOM
 * into FILE_DESCRIPTION's first list element if present.
 */
function rewriteFileNameHeader(stepText: string, bom: BomMetadata): string {
  // Only touch FILE_NAME's first argument (display name). Pattern:
  //   FILE_NAME('something','timestamp', ...
  const re = /(FILE_NAME\s*\(\s*)('(?:[^']|'')*')(\s*,)/;
  const m = stepText.match(re);
  if (!m) return stepText;
  const display = stepEscape(
    [bom.specification, bom.partName, bom.material, bom.standard]
      .filter((s) => s && s.trim() !== '')
      .join(' | '),
  );
  return stepText.replace(re, `$1'${display}'$3`);
}

/**
 * Insert (or replace) the `/* BIZMECH_BOM_BEGIN ... BIZMECH_BOM_END *<slash>`
 * comment block immediately before the `ENDSEC;` of the DATA section.
 * STEP comments are syntactically transparent so this never breaks
 * downstream parsing.
 */
function upsertBomCommentBlock(stepText: string, bom: BomMetadata): string {
  const block = [
    BOM_BLOCK_BEGIN,
    `/* BIZMECH_BOM_PARTNAME='${commentEscape(bom.partName)}' */`,
    `/* BIZMECH_BOM_PARTNUMBER='${commentEscape(bom.specification)}' */`,
    `/* BIZMECH_BOM_MATERIAL='${commentEscape(bom.material)}' */`,
    `/* BIZMECH_BOM_STANDARD='${commentEscape(bom.standard)}' */`,
    BOM_BLOCK_END,
  ].join('\n');

  // Strip an existing block if present (idempotency — re-embedding on
  // the same file replaces rather than duplicates).
  const existingRe = new RegExp(
    escapeForRegex(BOM_BLOCK_BEGIN) +
      '[\\s\\S]*?' +
      escapeForRegex(BOM_BLOCK_END) +
      '\\n?',
    'g',
  );
  let out = stepText.replace(existingRe, '');

  // Find the LAST `ENDSEC;` (ends the DATA section) and insert our
  // block immediately before it. If absent (malformed STEP), append
  // at end and trust whatever consumer to be tolerant.
  const endsec = out.lastIndexOf('ENDSEC;');
  if (endsec === -1) {
    return out + '\n' + block + '\n';
  }
  return out.slice(0, endsec) + block + '\n' + out.slice(endsec);
}

/** Escape a STEP string literal — single quotes are doubled in STEP. */
function stepEscape(s: string): string {
  return (s ?? '').replace(/'/g, "''");
}

/** Escape a value for inclusion inside a STEP comment — strip `*\/`. */
function commentEscape(s: string): string {
  return (s ?? '').replace(/\*\//g, '* /');
}

function escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
