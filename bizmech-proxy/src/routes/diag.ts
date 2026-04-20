/**
 * Diagnostic endpoints — show the actual shape of every registered DB.
 *
 *   GET /diag/dbs                              → list of registered DBs + status
 *   GET /diag/schemas?db=<dbName|alias>
 *   GET /diag/tables?db=<dbName|alias>
 *   GET /diag/columns?db=…&table=…
 *   GET /diag/sample?db=…&table=…
 *   GET /diag/index                            → in-memory partCode → DB map
 *   GET /diag/sub-index                        → subCategory → DB map
 *   POST /diag/reset                           → drop both in-memory indexes
 */
import { Router } from 'express';
import {
  getPool,
  getPartIndex,
  getSubDbIndex,
  listDatabases,
  ping,
  primaryDbName,
  query,
  resetPartIndex,
  resetSubDbIndex,
  resolveDbAlias,
} from '../db.js';

const router = Router();

router.get('/diag/dbs', async (_req, res, next) => {
  try {
    const p = await ping();
    res.json({
      registered: listDatabases(),
      primary: primaryDbName(),
      status: p.results,
      ok: p.ok,
    });
  } catch (e) {
    next(e);
  }
});

router.get('/diag/schemas', async (req, res, next) => {
  try {
    const pool = getPool(resolveDbAlias(String(req.query.db ?? '')));
    const rows = await query<{ schema_name: string }>(
      pool,
      `SELECT schema_name FROM information_schema.schemata
        WHERE schema_name NOT IN ('pg_catalog','information_schema','pg_toast')
          AND schema_name NOT LIKE 'pg_%'
        ORDER BY schema_name`,
    );
    res.json(rows.map((r) => r.schema_name));
  } catch (e) {
    next(e);
  }
});

router.get('/diag/tables', async (req, res, next) => {
  try {
    const pool = getPool(resolveDbAlias(String(req.query.db ?? '')));
    const rows = await query(
      pool,
      `SELECT table_schema, table_name, table_type
         FROM information_schema.tables
        WHERE table_schema NOT IN ('pg_catalog','information_schema')
        ORDER BY table_schema, table_name`,
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

router.get('/diag/columns', async (req, res, next) => {
  try {
    const pool = getPool(resolveDbAlias(String(req.query.db ?? '')));
    const table = String(req.query.table ?? '').trim();
    if (!table) return res.status(400).json({ error: 'table_required' });
    let schema = 'public';
    let name = table;
    if (table.includes('.')) [schema, name] = table.split('.');
    const rows = await query(
      pool,
      `SELECT column_name, data_type, is_nullable
         FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = $2
        ORDER BY ordinal_position`,
      [schema, name],
    );
    res.json({ schema, table: name, columns: rows });
  } catch (e) {
    next(e);
  }
});

router.get('/diag/sample', async (req, res, next) => {
  try {
    const pool = getPool(resolveDbAlias(String(req.query.db ?? '')));
    const table = String(req.query.table ?? '').trim();
    if (!table) return res.status(400).json({ error: 'table_required' });
    const safe = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?$/;
    if (!safe.test(table)) {
      return res.status(400).json({ error: 'invalid_table_name' });
    }
    const rows = await query(pool, `SELECT * FROM ${table} LIMIT 3`);
    res.json({ table, rows });
  } catch (e) {
    next(e);
  }
});

router.get('/diag/index', async (_req, res, next) => {
  try {
    const idx = await getPartIndex();
    const buckets: Record<string, string[]> = {};
    for (const [code, db] of idx.entries()) {
      (buckets[db] ??= []).push(code);
    }
    const totals: Record<string, number> = {};
    for (const [db, codes] of Object.entries(buckets)) {
      totals[db] = codes.length;
      buckets[db] = codes.sort();
    }
    res.json({ totals, buckets });
  } catch (e) {
    next(e);
  }
});

router.get('/diag/sub-index', async (_req, res, next) => {
  try {
    const idx = await getSubDbIndex();
    const out: Record<string, string> = {};
    for (const [sub, db] of idx.entries()) out[sub] = db;
    res.json(out);
  } catch (e) {
    next(e);
  }
});

router.post('/diag/reset', (_req, res) => {
  resetPartIndex();
  resetSubDbIndex();
  res.json({ ok: true });
});

export default router;
