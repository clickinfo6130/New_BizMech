/**
 * Postgres connection — dynamic per-database pool registry.
 *
 * Goals:
 *   1. Adding a new category DB (Cylinder_Core, LmGuide_Core, …) MUST be
 *      a pure config change — no source edits.
 *   2. Each DB gets its OWN long-lived pool (best practice). Pools are
 *      lazy-instantiated on first use and cached.
 *   3. Routing decisions (which pool answers which request) are driven by
 *      the existing `maincategory.db_file_name` column — the same field
 *      PartManager already uses on the desktop side.
 *
 * Configuration (all in .env):
 *
 *   PG_DATABASES   = Standard_Core,Motor_Core,Cylinder_Core   ← canonical list
 *   PG_PRIMARY_DB  = Standard_Core                            ← holds maincategory etc.
 *   PG_DB_ALIASES  = std:Standard_Core,motor:Motor_Core       ← short names for /diag/*
 *
 * Public API:
 *
 *   getPool(dbName)            ← pg.Pool for a specific DB (case-insensitive)
 *   primaryPool()              ← pg.Pool for the primary DB
 *   query(pool, sql, params)   ← parameterized query helper
 *   queryPrimary(sql, params)  ← shortcut for primary DB
 *   poolForPartCode(code)      ← lookup pool via partCode → DB index
 *   poolForSubCategory(code)   ← lookup pool via subcategory → maincategory.db_file_name
 *   listDatabases()            ← registered DB names
 *   resolveDbAlias(name)       ← turn 'std' into 'Standard_Core'
 *   ping()                     ← health-check every registered DB
 */
import pg from 'pg';
import 'dotenv/config';

// ─────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────

const {
  PG_HOST = '192.168.0.17',
  PG_PORT = '5432',
  PG_USER = '',
  PG_PASSWORD = '',
  PG_DATABASES = 'Standard_Core,Motor_Core',
  PG_PRIMARY_DB = 'Standard_Core',
  PG_DB_ALIASES = '',
  PG_POOL_MAX = '10',
  PG_IDLE_TIMEOUT_MS = '30000',
  PG_CONNECTION_TIMEOUT_MS = '5000',
  PG_SSL = 'false',
} = process.env;

const baseConfig: pg.PoolConfig = {
  host: PG_HOST,
  port: Number(PG_PORT),
  user: PG_USER,
  password: PG_PASSWORD,
  max: Number(PG_POOL_MAX),
  idleTimeoutMillis: Number(PG_IDLE_TIMEOUT_MS),
  connectionTimeoutMillis: Number(PG_CONNECTION_TIMEOUT_MS),
  ssl: PG_SSL === 'true' ? { rejectUnauthorized: false } : false,
};

const REGISTERED_DBS: string[] = PG_DATABASES.split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const PRIMARY_DB: string = PG_PRIMARY_DB.trim() || REGISTERED_DBS[0] || 'postgres';

const ALIASES = new Map<string, string>();
for (const pair of PG_DB_ALIASES.split(',')) {
  const [alias, real] = pair.split(':').map((s) => s?.trim());
  if (alias && real) ALIASES.set(alias.toLowerCase(), real);
}

// ─────────────────────────────────────────────────────────
// Pool registry
// ─────────────────────────────────────────────────────────

const pools = new Map<string, pg.Pool>(); // key: real DB name (case-preserved)

/** Look up the canonical DB name for an alias / case-insensitive match. */
export function resolveDbAlias(input: string): string {
  if (!input) return PRIMARY_DB;
  const lower = input.toLowerCase();
  if (ALIASES.has(lower)) return ALIASES.get(lower)!;
  // case-insensitive lookup against registered DBs
  const hit = REGISTERED_DBS.find((d) => d.toLowerCase() === lower);
  return hit ?? input;
}

/** Get (or lazy-create) the pool for a given DB name. */
export function getPool(dbName: string): pg.Pool {
  const real = resolveDbAlias(dbName);
  let pool = pools.get(real);
  if (!pool) {
    pool = new pg.Pool({ ...baseConfig, database: real });
    pool.on('error', (e) =>
      // eslint-disable-next-line no-console
      console.error(`[pg:${real}] idle client error:`, e.message),
    );
    pools.set(real, pool);
  }
  return pool;
}

export const primaryPool = (): pg.Pool => getPool(PRIMARY_DB);
export const listDatabases = (): readonly string[] => REGISTERED_DBS;
export const primaryDbName = (): string => PRIMARY_DB;

// ─────────────────────────────────────────────────────────
// Query helpers
// ─────────────────────────────────────────────────────────

export async function query<T = unknown>(
  pool: pg.Pool,
  sql: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  const client = await pool.connect();
  try {
    const res = await client.query(sql, params as unknown[]);
    return res.rows as T[];
  } finally {
    client.release();
  }
}

export const queryPrimary = <T = unknown>(
  sql: string,
  params: readonly unknown[] = [],
) => query<T>(primaryPool(), sql, params);

// ─────────────────────────────────────────────────────────
// partCode → DB index (lazy, cached)
// ─────────────────────────────────────────────────────────

let partIndex: Map<string, string> | null = null;
let partIndexPromise: Promise<Map<string, string>> | null = null;

async function buildPartIndex(): Promise<Map<string, string>> {
  const idx = new Map<string, string>();
  // ★ Only index partspec.part_code — that is the table every /parts/:code/*
  //   endpoint actually queries. Mixing parttype.part_type_code into this
  //   index used to break motor routing: Standard_Core.parttype lists motor
  //   leaves (e.g. "SGM-7", "SGM-V") for the category tree, but the matching
  //   partspec rows live in Motor_Core. Indexing parttype would register
  //   those codes against Standard_Core first (Standard_Core iterated first)
  //   and then Motor_Core's partspec scan would skip them — every such
  //   motor spec endpoint returned null and the UI stayed on "loading…".
  for (const dbName of REGISTERED_DBS) {
    const pool = getPool(dbName);
    try {
      const rows = await query<{ code: string }>(
        pool,
        `SELECT DISTINCT part_code AS code FROM partspec WHERE is_active = TRUE`,
      );
      for (const r of rows) {
        if (r.code && !idx.has(r.code)) idx.set(r.code, dbName);
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(
        `[pg] partspec index from ${dbName}:`,
        e instanceof Error ? e.message : String(e),
      );
    }
  }
  return idx;
}

export async function getPartIndex(): Promise<Map<string, string>> {
  if (partIndex) return partIndex;
  if (!partIndexPromise) partIndexPromise = buildPartIndex();
  partIndex = await partIndexPromise;
  return partIndex;
}

export function resetPartIndex() {
  partIndex = null;
  partIndexPromise = null;
}

export async function poolForPartCode(partCode: string): Promise<pg.Pool> {
  const idx = await getPartIndex();
  return getPool(idx.get(partCode) ?? PRIMARY_DB);
}

// ─────────────────────────────────────────────────────────
// subCategory → DB index (resolved via maincategory.db_file_name)
// ─────────────────────────────────────────────────────────

let subDbIndex: Map<string, string> | null = null;
let subDbIndexPromise: Promise<Map<string, string>> | null = null;

async function buildSubDbIndex(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const rows = await queryPrimary<{
      sub_cat_code: string;
      db_file_name: string | null;
    }>(`
      SELECT s.sub_cat_code, m.db_file_name
        FROM subcategory s
        JOIN maincategory m ON s.main_cat_code = m.main_cat_code
       WHERE s.is_active = TRUE AND m.is_active = TRUE
    `);
    for (const r of rows) {
      // db_file_name is "motor_core.db" / "Motor_core.db" → strip extension
      // and case-insensitively match against REGISTERED_DBS.
      const stripped = String(r.db_file_name ?? '')
        .replace(/\.db$/i, '')
        .trim();
      if (!stripped) continue;
      const real =
        REGISTERED_DBS.find((d) => d.toLowerCase() === stripped.toLowerCase()) ??
        PRIMARY_DB;
      map.set(r.sub_cat_code, real);
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(
      '[pg] sub-category DB index build:',
      e instanceof Error ? e.message : String(e),
    );
  }
  return map;
}

export async function getSubDbIndex(): Promise<Map<string, string>> {
  if (subDbIndex) return subDbIndex;
  if (!subDbIndexPromise) subDbIndexPromise = buildSubDbIndex();
  subDbIndex = await subDbIndexPromise;
  return subDbIndex;
}

export function resetSubDbIndex() {
  subDbIndex = null;
  subDbIndexPromise = null;
}

export async function poolForSubCategory(subCatCode: string): Promise<pg.Pool> {
  const idx = await getSubDbIndex();
  return getPool(idx.get(subCatCode) ?? PRIMARY_DB);
}

// ─────────────────────────────────────────────────────────
// Health check
// ─────────────────────────────────────────────────────────

export interface PingResult {
  ok: boolean;
  results: { db: string; status: string }[];
}

export async function ping(): Promise<PingResult> {
  const results: { db: string; status: string }[] = [];
  for (const dbName of REGISTERED_DBS) {
    try {
      const rows = await query<{ db: string; v: string }>(
        getPool(dbName),
        `SELECT current_database() AS db, version() AS v`,
      );
      const ver = (rows[0]?.v ?? '').split(' on ')[0];
      results.push({ db: dbName, status: `OK — ${rows[0]?.db} — ${ver}` });
    } catch (e) {
      results.push({
        db: dbName,
        status: `FAIL — ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }
  return {
    ok: results.length > 0 && results.every((r) => r.status.startsWith('OK')),
    results,
  };
}

// ─────────────────────────────────────────────────────────
// Graceful shutdown — close every pool
// ─────────────────────────────────────────────────────────

export async function shutdown(): Promise<void> {
  await Promise.allSettled(Array.from(pools.values()).map((p) => p.end()));
  pools.clear();
}
