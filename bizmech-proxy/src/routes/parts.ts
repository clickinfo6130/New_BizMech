/**
 * Part spec / dimension endpoints.
 * Routes per request pick the right pool via poolForPartCode(partCode).
 *
 *   GET  /parts/:partCode/spec
 *   GET  /parts/:partCode/dimension-meta
 *   GET  /parts/:partCode/dimension-keys
 *   POST /parts/:partCode/dimension/find   body:{keyValues}
 *   GET  /parts/find?q=…
 */
import { Router } from 'express';
import pg from 'pg';
import { getPool, listDatabases, poolForPartCode, query } from '../db.js';
import { jsonCell } from '../util/json.js';

const router = Router();

interface SpecRow {
  id: number;
  part_type: string;
  part_code: string;
  part_name: string;
  /** string when column is TEXT, already-parsed object when JSONB. */
  spec_data: unknown;
}

function parseSpec(row: SpecRow) {
  const json = jsonCell<{ Series?: unknown[] }>(row.spec_data, {});
  const series = (json.Series ?? []).map((s) => {
    const raw = s as Record<string, unknown>;
    return {
      id: Number(raw.id ?? 0),
      name: String(raw.name ?? ''),
      cmd: String(raw.CMD ?? ''),
      options: ((raw.option ?? []) as Array<Record<string, unknown>>).map(
        (o) => ({
          id: Number(o.id ?? 0),
          name: String(o.name ?? ''),
          defaultValue: String(o.default_Value ?? '0'),
          isActive: String(o.isActive ?? 'TRUE').toUpperCase() === 'TRUE',
          type: typeof o.type === 'string' ? (o.type as string) : undefined,
          values: Array.isArray(o.values)
            ? (o.values as Array<Record<string, unknown>>).map((v) => ({
                enumid: (v.enumid as number | string) ?? '',
                name: String(v.name ?? ''),
                desc: typeof v.desc === 'string' ? (v.desc as string) : '',
                filter: v.filter as string[] | string | undefined,
                filter_Values: v.filter_Values as string[][] | undefined,
              }))
            : [],
        }),
      ),
    };
  });
  return {
    id: row.id,
    partType: row.part_type,
    partCode: row.part_code,
    partName: row.part_name,
    series,
  };
}

router.get('/parts/:partCode/spec', async (req, res, next) => {
  try {
    const partCode = req.params.partCode;
    const pool = await poolForPartCode(partCode);
    const rows = await query<SpecRow>(
      pool,
      `SELECT id, part_type, part_code, part_name, spec_data
         FROM partspec WHERE part_code = $1 AND is_active = TRUE LIMIT 1`,
      [partCode],
    );
    if (!rows.length) return res.json(null);
    res.json(parseSpec(rows[0]));
  } catch (e) {
    next(e);
  }
});

router.get('/parts/:partCode/dimension-meta', async (req, res, next) => {
  try {
    const partCode = req.params.partCode;
    const pool = await poolForPartCode(partCode);
    const rows = await query<{
      part_code: string;
      field_name: string;
      display_name: string | null;
      display_name_en: string | null;
      data_type: string | null;
      unit: string | null;
      is_key_field: number | null;
      display_order: number | null;
    }>(
      pool,
      `SELECT part_code, field_name, display_name, display_name_en, data_type,
              unit, is_key_field, display_order
         FROM dimensionmeta
        WHERE part_code = $1 AND is_active = TRUE
        ORDER BY display_order, id`,
      [partCode],
    );
    res.json(
      rows.map((r) => ({
        partCode: r.part_code,
        fieldName: r.field_name,
        displayName: r.display_name ?? r.field_name ?? '',
        displayNameEn: r.display_name_en ?? undefined,
        dataType: r.data_type ?? 'TEXT',
        unit: r.unit ?? undefined,
        isKeyField: Number(r.is_key_field ?? 0) === 1,
        displayOrder: Number(r.display_order ?? 0),
      })),
    );
  } catch (e) {
    next(e);
  }
});

router.get('/parts/:partCode/dimension-keys', async (req, res, next) => {
  try {
    const partCode = req.params.partCode;
    const pool = await poolForPartCode(partCode);
    const rows = await query<{
      part_code: string;
      key_field_name: string;
      key_level: number | null;
      key_value: string;
      parent_key: string | null;
      sort_order: number | null;
    }>(
      pool,
      `SELECT part_code, key_field_name, key_level, key_value, parent_key, sort_order
         FROM dimensionkeyoption
        WHERE part_code = $1 AND is_active = TRUE
        ORDER BY key_level, sort_order, key_value`,
      [partCode],
    );
    res.json(
      rows.map((r) => ({
        partCode: r.part_code,
        keyFieldName: r.key_field_name,
        keyLevel: Number(r.key_level ?? 1),
        keyValue: r.key_value,
        parentKey: r.parent_key ?? null,
      })),
    );
  } catch (e) {
    next(e);
  }
});

interface DimRow {
  id: number;
  part_code: string;
  key_composite: string | null;
  /** string when column is TEXT, already-parsed object when JSONB. */
  key_values: unknown;
  /** string when column is TEXT, already-parsed object when JSONB. */
  dimension_data: unknown;
}

function parseDim(r: DimRow) {
  return {
    id: r.id,
    partCode: r.part_code,
    keyComposite: r.key_composite ?? '',
    keyValues: jsonCell<Record<string, string>>(r.key_values, {}),
    dimensionData: jsonCell<Record<string, number | string>>(r.dimension_data, {}),
  };
}

router.post('/parts/:partCode/dimension/find', async (req, res, next) => {
  try {
    const partCode = req.params.partCode;
    const keyValues: Record<string, string> = req.body?.keyValues ?? {};
    const pool = await poolForPartCode(partCode);

    const rows = await query<DimRow>(
      pool,
      `SELECT id, part_code, key_composite, key_values, dimension_data
         FROM partdimension WHERE part_code = $1 AND is_active = TRUE`,
      [partCode],
    );
    const parsed = rows.map(parseDim);
    if (!parsed.length) return res.json(null);

    const wanted = Object.entries(keyValues).filter(
      ([, v]) => v != null && v !== '' && v !== '-',
    );
    if (!wanted.length) return res.json(parsed[0]);

    const normalize = (s: string) => s.trim().toLowerCase();
    const isSizeKey = (k: string) => {
      const kn = normalize(k);
      return kn === 'list' || kn === '사이즈' || kn === '호칭' || kn === 'size';
    };

    function scorePair(k: string, want: string, got: string | undefined) {
      if (got == null) return 0;
      const a = normalize(want);
      const b = normalize(got);
      const mult = isSizeKey(k) ? 2 : 1;
      if (a === b) return 3 * mult;
      if (a && b && (a.startsWith(b) || b.startsWith(a))) return 2 * mult;
      const na = parseFloat(want);
      const nb = parseFloat(String(got));
      if (!Number.isNaN(na) && !Number.isNaN(nb) && Math.abs(na - nb) < 1e-6) {
        return 1 * mult;
      }
      return 0;
    }

    let best = parsed[0];
    let bestScore = -1;
    for (const row of parsed) {
      let s = 0;
      for (const [k, v] of wanted) s += scorePair(k, v, row.keyValues[k]);
      if (s > bestScore) {
        bestScore = s;
        best = row;
      }
    }
    // eslint-disable-next-line no-console
    console.log(
      `  [findDimension] part=${partCode} wanted=${JSON.stringify(keyValues)} → score=${bestScore} key=${best?.keyComposite} dims(${Object.keys(best?.dimensionData ?? {}).length} keys)`,
    );
    res.json(bestScore > 0 ? best : parsed[0]);
  } catch (e) {
    next(e);
  }
});

/**
 * /parts/find?q=… — used to resolve linked parts whose display name may
 * live in any registered DB (Standard_Core, Motor_Core, Cylinder_Core, …).
 * Iterates `listDatabases()` in registration order and returns the first
 * hit. Adding a new DB to PG_DATABASES extends the search automatically.
 */
router.get('/parts/find', async (req, res, next) => {
  try {
    const q = String(req.query.q ?? '').trim();
    if (!q) return res.json(null);

    async function tryPool(pool: pg.Pool) {
      let rows = await query<SpecRow>(
        pool,
        `SELECT id, part_type, part_code, part_name, spec_data
           FROM partspec
          WHERE is_active = TRUE AND (part_code = $1 OR part_name = $1)
          LIMIT 1`,
        [q],
      );
      if (!rows.length) {
        rows = await query<SpecRow>(
          pool,
          `SELECT id, part_type, part_code, part_name, spec_data
             FROM partspec
            WHERE is_active = TRUE AND part_name ILIKE $1
            LIMIT 1`,
          [`%${q}%`],
        );
      }
      return rows.length ? parseSpec(rows[0]) : null;
    }

    for (const dbName of listDatabases()) {
      const hit = await tryPool(getPool(dbName));
      if (hit) return res.json(hit);
    }
    res.json(null);
  } catch (e) {
    next(e);
  }
});

export default router;
