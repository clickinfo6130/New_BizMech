/**
 * Disk-backed file cache for CAD outputs.
 *
 * Key = SHA256 of the canonicalized CadGenerateRequest. Each entry stores
 * the raw file bytes plus a sibling .json sidecar with the original request
 * and timing info — enough for `/diag/cache` inspection and for the
 * download handler to rebuild the HTTP response without re-reading the
 * bytes into RAM (content-type/ext come from the sidecar).
 *
 * The cache is intentionally dumb: no LRU, no size cap, no index DB.
 * Aging is handled by `CACHE_MAX_AGE_DAYS` (file mtime older than that ⇒
 * treated as a miss and overwritten on next write). Real LRU + S3 come
 * in Phase 2.
 */
import { createHash } from 'crypto';
import { promises as fs, existsSync, statSync, readFileSync } from 'fs';
import { join } from 'path';

import type { CadGenerateRequest, CadGenerateResult, CadFormat } from './types.js';

const CACHE_DIR =
  process.env.CAD_CACHE_DIR?.trim() ||
  join(process.cwd(), 'cache');

const MAX_AGE_MS =
  Number(process.env.CAD_CACHE_MAX_AGE_DAYS ?? 30) * 24 * 60 * 60 * 1000;

export interface CacheSidecar {
  request: CadGenerateRequest;
  format: CadFormat;
  mimeType: string;
  ext: string;
  fileName: string;
  backend: 'local' | 'exchanger';
  generatedMs: number;
  storedAt: string;
  sizeBytes: number;
  /** When true, this entry was a fallback and should be re-generated on next POST. */
  fallback?: boolean;
}

/**
 * Produce a stable cache key from a request. Every field that affects
 * the output must be included — changing any of them invalidates the
 * cached file. Dimensions are normalized to strings with fixed
 * precision so that `{d: 10}` and `{d: 10.0}` map to the same key.
 *
 * Backend-selection env vars (CAD_BACKEND, OCCT_REAL_THREAD) are
 * folded into the key so flipping them in .env auto-invalidates every
 * cached file — otherwise a request with identical partCode+dimensions
 * would keep returning the same old STEP regardless of the new flag.
 */
export function hashRequest(req: CadGenerateRequest): string {
  const normalized = {
    partCode: String(req.partCode).trim(),
    keyComposite: String(req.keyComposite ?? '').trim(),
    format: req.format,
    material: (req.material ?? '').trim().toLowerCase(),
    surface: (req.surface ?? '').trim().toLowerCase(),
    locale: req.locale ?? 'ko',
    dimensions: Object.keys(req.dimensions ?? {})
      .sort()
      .reduce<Record<string, string>>((acc, k) => {
        const v = req.dimensions[k];
        acc[k] =
          typeof v === 'number' ? Number(v.toFixed(6)).toString() : String(v).trim();
        return acc;
      }, {}),
    // Backend fingerprint — keeps cache honest when flags change.
    backend: (process.env.CAD_BACKEND ?? 'hand').toLowerCase(),
    realThread: (process.env.OCCT_REAL_THREAD ?? 'false').toLowerCase() === 'true',
  };
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

async function ensureDir(): Promise<void> {
  if (!existsSync(CACHE_DIR)) {
    await fs.mkdir(CACHE_DIR, { recursive: true });
  }
}

function filePath(hash: string, ext: string): string {
  return join(CACHE_DIR, `${hash}.${ext}`);
}

function sidecarPath(hash: string): string {
  return join(CACHE_DIR, `${hash}.json`);
}

/**
 * Load an existing cache entry. Returns `null` on miss, on TTL expiry, or
 * on any parse / IO error. Never throws — a cache failure must fall back
 * to regeneration.
 */
export function readCache(
  hash: string,
): { bytes: Buffer; sidecar: CacheSidecar; cachePath: string } | null {
  try {
    const sc = sidecarPath(hash);
    if (!existsSync(sc)) return null;
    const st = statSync(sc);
    if (Date.now() - st.mtimeMs > MAX_AGE_MS) return null;
    const sidecar = JSON.parse(readFileSync(sc, 'utf-8')) as CacheSidecar;
    const fp = filePath(hash, sidecar.ext);
    if (!existsSync(fp)) return null;
    const bytes = readFileSync(fp);
    return { bytes, sidecar, cachePath: fp };
  } catch {
    return null;
  }
}

/** Write a generated file plus its sidecar. Returns the on-disk path. */
export async function writeCache(
  hash: string,
  req: CadGenerateRequest,
  result: CadGenerateResult,
): Promise<string> {
  await ensureDir();
  const fp = filePath(hash, result.ext);
  const sc = sidecarPath(hash);
  await fs.writeFile(fp, result.bytes);
  const sidecar: CacheSidecar = {
    request: req,
    format: result.format,
    mimeType: result.mimeType,
    ext: result.ext,
    fileName: result.fileName,
    backend: result.backend,
    generatedMs: result.generatedMs,
    storedAt: new Date().toISOString(),
    sizeBytes: result.bytes.length,
    fallback: result.noCache === true,
  };
  await fs.writeFile(sc, JSON.stringify(sidecar, null, 2), 'utf-8');
  return fp;
}

/** Summary for /diag/cache — small, cheap to compute. */
export async function listCache(): Promise<{
  count: number;
  totalBytes: number;
  dir: string;
  maxAgeDays: number;
}> {
  if (!existsSync(CACHE_DIR)) {
    return { count: 0, totalBytes: 0, dir: CACHE_DIR, maxAgeDays: MAX_AGE_MS / (86400 * 1000) };
  }
  const entries = await fs.readdir(CACHE_DIR);
  let count = 0;
  let totalBytes = 0;
  for (const name of entries) {
    if (name.endsWith('.json')) continue;
    const st = statSync(join(CACHE_DIR, name));
    if (st.isFile()) {
      count += 1;
      totalBytes += st.size;
    }
  }
  return {
    count,
    totalBytes,
    dir: CACHE_DIR,
    maxAgeDays: MAX_AGE_MS / (86400 * 1000),
  };
}
