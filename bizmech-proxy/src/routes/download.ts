/**
 * Download orchestrator — Phase 1.
 *
 *   POST /download             → { fileName, url, hash, fromCache, ... }
 *   GET  /download/file/:hash  → streams the cached bytes
 *   GET  /diag/cad             → worker + cache diagnostic
 *
 * Flow for a local-format request (STEP/DXF/IGES):
 *   1. Resolve concrete dimensions from partdimension for (partCode, keyComposite).
 *   2. Build a canonical CadGenerateRequest.
 *   3. Hash it → cache check. HIT ⇒ return URL immediately.
 *   4. MISS ⇒ call the worker, write bytes + sidecar to disk cache, return URL.
 *
 * Flow for a native-format request (DWG/IPT/SLDPRT/Z3):
 *   1. Same cache check but with the target format in the key.
 *   2. MISS ⇒ first generate a STEP with the same dimensions (reuses the
 *      STEP cache if present), then hand the bytes to the CAD Exchanger
 *      adapter. In Phase 1 the adapter returns `not_configured` and we
 *      respond with a structured 503 so the UI shows "준비 중".
 */
import { Router } from 'express';
import type { CadFormat, CadGenerateRequest } from '../cad/types.js';
import { EXCHANGER_FORMATS, FORMAT_EXT, FORMAT_MIME, LOCAL_FORMATS } from '../cad/types.js';
import { generateLocal, supportedParts, UnsupportedPartError } from '../cad/worker.js';
import { hashRequest, listCache, readCache, writeCache } from '../cad/cache.js';
import { convert as exchangerConvert, isExchangerConfigured } from '../cad/exchanger/stub.js';
import { poolForPartCode, query } from '../db.js';
import { jsonCell } from '../util/json.js';

const router = Router();

interface DimRow {
  part_code: string;
  key_composite: string | null;
  dimension_data: unknown;
  key_values: unknown;
}

interface SpecNameRow {
  part_name: string | null;
}

async function loadDimensions(
  partCode: string,
  keyComposite: string,
): Promise<Record<string, number | string>> {
  const pool = await poolForPartCode(partCode);
  const rows = await query<DimRow>(
    pool,
    `SELECT part_code, key_composite, dimension_data, key_values
       FROM partdimension
      WHERE part_code = $1 AND is_active = TRUE
        AND (key_composite = $2 OR $2 = '')
      LIMIT 1`,
    [partCode, keyComposite ?? ''],
  );
  if (!rows.length) {
    throw new Error(
      `No partdimension row for partCode="${partCode}" keyComposite="${keyComposite}". ` +
        `Pick a concrete option combination before downloading.`,
    );
  }
  const dimData = jsonCell<Record<string, number | string>>(rows[0].dimension_data, {});
  const keyVals = jsonCell<Record<string, string>>(rows[0].key_values, {});
  // Merge keyValues into dimensions so aliases like "호칭" resolve for generators
  // that fall back to key-field names.
  return { ...keyVals, ...dimData };
}

/**
 * Look up `partspec.part_name` for the BOM metadata embedded into the
 * generated STEP. Returns null if no spec row exists — the worker
 * tolerates an absent partName (the post-processor falls back to the
 * partCode in that case).
 */
async function loadPartName(partCode: string): Promise<string | null> {
  try {
    const pool = await poolForPartCode(partCode);
    const rows = await query<SpecNameRow>(
      pool,
      `SELECT part_name FROM partspec
        WHERE part_code = $1 AND is_active = TRUE LIMIT 1`,
      [partCode],
    );
    return rows[0]?.part_name?.trim() || null;
  } catch {
    return null;
  }
}

function buildUrl(host: string | undefined, hash: string): string {
  const base = process.env.PUBLIC_BASE_URL?.trim() || `http://localhost:${process.env.PORT ?? 8080}`;
  void host; // kept for future X-Forwarded-Host handling
  return `${base}/api/download/file/${hash}`;
}

/**
 * Pull the first non-empty string for any of the given alias keys out of
 * a loose `Record<string, unknown>`. Used to harvest BOM-relevant values
 * (재질, 표준번호 …) from the request's `extraDimensions` payload.
 */
function pickAlias(
  src: Record<string, unknown>,
  aliases: readonly string[],
): string | undefined {
  for (const k of aliases) {
    const v = src[k];
    if (v == null || v === '') continue;
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return undefined;
}

function isSupportedFormat(v: unknown): v is CadFormat {
  return typeof v === 'string' && [...LOCAL_FORMATS, ...EXCHANGER_FORMATS].includes(v as CadFormat);
}

router.post('/download', async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const partCode = String(body.partCode ?? '').trim();
  const keyComposite = String(body.keyComposite ?? '').trim();
  const formatRaw = body.format;
  const locale = (body.locale as CadGenerateRequest['locale']) ?? 'ko';

  if (!partCode) {
    return res.status(400).json({ error: 'partCode_required' });
  }
  if (!isSupportedFormat(formatRaw)) {
    return res.status(400).json({
      error: 'unsupported_format',
      message: `format must be one of ${[...LOCAL_FORMATS, ...EXCHANGER_FORMATS].join(', ')}`,
    });
  }
  const format = formatRaw;

  // 1) Load the DB-derived dimensions for this key_composite row
  let dimensions: Record<string, number | string>;
  try {
    dimensions = await loadDimensions(partCode, keyComposite);
  } catch (e) {
    return res.status(404).json({
      error: 'dimensions_not_found',
      message: e instanceof Error ? e.message : String(e),
    });
  }

  // 2) Merge the user's live selection on top — values the user typed
  //    (EDITBOX length, etc.) aren't in the DB row and must override
  //    the DB's Length_min fallback. Filter to numeric / non-empty.
  const extraRaw = (body.extraDimensions ?? {}) as Record<string, unknown>;
  for (const [k, v] of Object.entries(extraRaw)) {
    if (v == null || v === '') continue;
    if (typeof v === 'number' && Number.isFinite(v)) dimensions[k] = v;
    else if (typeof v === 'string') dimensions[k] = v;
  }

  // Resolve BOM metadata from the same DB lookup as dimensions:
  //   · partName  ← partspec.part_name (one extra query)
  //   · standard  ← keyComposite's leading segment ("HBOLT|KS B 1002|M10"
  //                  → "KS B 1002") OR the user-selected 표준번호 in
  //                  extraDimensions if present (more specific, e.g.
  //                  "KS B 1002:2016").
  //   · material  ← body.material (already on the request)
  //   The actual specification string ("M10X1.5-40L") is computed by
  //   the bom-meta resolver from dimensions inside the worker.
  const partName = await loadPartName(partCode);
  let standard: string | undefined;
  const extraStd = pickAlias(extraRaw, ['표준번호', 'standardNo', 'standard_no', 'standard']);
  if (extraStd) standard = extraStd;
  else if (keyComposite.includes('|')) {
    const parts = keyComposite.split('|');
    if (parts.length >= 2 && parts[1].trim()) standard = parts[1].trim();
  }

  const canonical: CadGenerateRequest = {
    partCode,
    keyComposite,
    dimensions,
    material: body.material ? String(body.material) : pickAlias(extraRaw, ['재질', 'material']),
    surface: body.surface ? String(body.surface) : undefined,
    format,
    locale,
    partName: partName ?? undefined,
    standard,
  };

  // 2) Cache check — but skip entries marked `fallback: true`. Those
  //    were produced when the preferred backend crashed; we want to
  //    retry the preferred backend on this request (fresh WASM heap
  //    thanks to resetOcct in the generator). The existing file on
  //    disk stays put so any in-flight GET /download/file/:hash stream
  //    for the OLD response keeps working.
  const hash = hashRequest(canonical);
  const cached = readCache(hash);
  if (cached && !cached.sidecar.fallback) {
    return res.json({
      fileName: cached.sidecar.fileName,
      mimeType: cached.sidecar.mimeType,
      url: buildUrl(req.headers.host, hash),
      hash,
      sizeBytes: cached.sidecar.sizeBytes,
      fromCache: true,
      generatedMs: 0,
      backend: cached.sidecar.backend,
    });
  }

  // 3) Generate
  const isLocal = (LOCAL_FORMATS as readonly CadFormat[]).includes(format);

  if (isLocal) {
    try {
      const result = await generateLocal(canonical);
      // Always write the file + sidecar so the GET stream endpoint
      // can serve the browser's download request. Fallback entries
      // carry `fallback: true` in the sidecar; the cache lookup at
      // the top of this handler treats them as MISS on future POSTs
      // so the preferred backend gets retried.
      await writeCache(hash, canonical, result);
      return res.json({
        fileName: result.fileName,
        mimeType: result.mimeType,
        url: buildUrl(req.headers.host, hash),
        hash,
        sizeBytes: result.bytes.length,
        fromCache: false,
        generatedMs: result.generatedMs,
        backend: result.backend,
      });
    } catch (e) {
      const status = e instanceof UnsupportedPartError ? 501 : 500;
      return res.status(status).json({
        error: 'generate_failed',
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // 4) Native format → CAD Exchanger (Phase 2)
  // First, ensure we have / produce a STEP for this selection.
  const stepReq: CadGenerateRequest = { ...canonical, format: 'STEP' };
  const stepHash = hashRequest(stepReq);
  let stepBytes: Buffer;
  const cachedStep = readCache(stepHash);
  if (cachedStep) {
    stepBytes = cachedStep.bytes;
  } else {
    try {
      const step = await generateLocal(stepReq);
      await writeCache(stepHash, stepReq, step);
      stepBytes = step.bytes;
    } catch (e) {
      return res.status(500).json({
        error: 'step_generate_failed',
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const conv = await exchangerConvert({
    stepBytes,
    targetFormat: format,
    partCode,
    keyComposite,
  });
  if (!conv.ok) {
    const code = conv.code === 'not_configured' ? 503 : 500;
    return res.status(code).json({
      error: conv.code,
      message: conv.message,
      phase: conv.phase,
    });
  }
  await writeCache(hash, canonical, conv.result);
  return res.json({
    fileName: conv.result.fileName,
    mimeType: conv.result.mimeType,
    url: buildUrl(req.headers.host, hash),
    hash,
    sizeBytes: conv.result.bytes.length,
    fromCache: false,
    generatedMs: conv.result.generatedMs,
    backend: conv.result.backend,
  });
});

router.get('/download/file/:hash', (req, res) => {
  const hash = String(req.params.hash || '').trim();
  if (!/^[0-9a-f]{64}$/i.test(hash)) {
    return res.status(400).json({ error: 'bad_hash' });
  }
  const cached = readCache(hash);
  if (!cached) {
    return res.status(404).json({ error: 'not_found' });
  }
  res.setHeader('Content-Type', cached.sidecar.mimeType);
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${encodeURIComponent(cached.sidecar.fileName)}"`,
  );
  res.setHeader('Content-Length', String(cached.sidecar.sizeBytes));
  // The download URL is content-stable for a fixed (partCode, dimensions,
  // format) tuple — same request → same hash in the URL — so a browser
  // that aggressively caches will return the *previous* generation's
  // bytes even after we regenerate server-side. `no-cache` here forces a
  // conditional revalidation; combined with the always-200 response from
  // the proxy this means the browser fetches fresh bytes every time. The
  // server-side disk cache (`bizmech-proxy/cache/`) still saves
  // OCCT compute time; this header only stops the BROWSER from
  // shortcutting our changes.
  res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  return res.end(cached.bytes);
});

router.get('/diag/cad', async (_req, res) => {
  const cache = await listCache();
  return res.json({
    localFormats: LOCAL_FORMATS,
    exchangerFormats: EXCHANGER_FORMATS,
    exchangerConfigured: isExchangerConfigured(),
    supportedParts: supportedParts(),
    cache,
    knownMimeTypes: FORMAT_MIME,
    knownExtensions: FORMAT_EXT,
  });
});

export default router;
