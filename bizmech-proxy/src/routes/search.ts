/**
 * GET /search?orderCode=HBOLT|KS B 1002|M10
 *
 * Resolves a full order-code string to { spec, dimension, meta } in a
 * single call. Routes to the correct pool via poolForPartCode(partCode).
 */
import { Router } from 'express';
import { poolForPartCode, query } from '../db.js';
import { jsonCell } from '../util/json.js';

const router = Router();

router.get('/search', async (req, res, next) => {
  try {
    const orderCode = String(req.query.orderCode ?? '').trim();
    if (!orderCode) return res.json(null);
    const partCode = orderCode.split('|')[0];
    if (!partCode) return res.json(null);

    const pool = await poolForPartCode(partCode);

    const dimRows = await query<{
      id: number;
      part_code: string;
      key_composite: string;
      key_values: unknown;
      dimension_data: unknown;
    }>(
      pool,
      `SELECT id, part_code, key_composite, key_values, dimension_data
         FROM partdimension
        WHERE part_code = $1 AND is_active = TRUE
          AND (key_composite = $2 OR key_composite LIKE $3)
        LIMIT 1`,
      [partCode, orderCode, `${orderCode}%`],
    );
    if (!dimRows.length) return res.json(null);

    const dimension = {
      id: dimRows[0].id,
      partCode: dimRows[0].part_code,
      keyComposite: dimRows[0].key_composite ?? '',
      keyValues: jsonCell<Record<string, string>>(dimRows[0].key_values, {}),
      dimensionData: jsonCell<Record<string, number | string>>(dimRows[0].dimension_data, {}),
    };

    const specRows = await query<{
      id: number;
      part_type: string;
      part_code: string;
      part_name: string;
      spec_data: unknown;
    }>(
      pool,
      `SELECT id, part_type, part_code, part_name, spec_data
         FROM partspec WHERE part_code = $1 AND is_active = TRUE LIMIT 1`,
      [partCode],
    );
    if (!specRows.length) return res.json(null);
    const specRow = specRows[0];
    const sj = jsonCell<{ Series?: unknown[] }>(specRow.spec_data, {});
    const series = (sj.Series ?? []).map((s) => {
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
    const spec = {
      id: specRow.id,
      partType: specRow.part_type,
      partCode: specRow.part_code,
      partName: specRow.part_name,
      series,
    };

    const metaRows = await query<{
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
    const meta = metaRows.map((r) => ({
      partCode: r.part_code,
      fieldName: r.field_name,
      displayName: r.display_name ?? r.field_name ?? '',
      displayNameEn: r.display_name_en ?? undefined,
      dataType: r.data_type ?? 'TEXT',
      unit: r.unit ?? undefined,
      isKeyField: Number(r.is_key_field ?? 0) === 1,
      displayOrder: Number(r.display_order ?? 0),
    }));

    res.json({ spec, dimension, meta });
  } catch (e) {
    next(e);
  }
});

export default router;
