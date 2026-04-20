/**
 * Category hierarchy endpoints.
 *
 * Tables `maincategory`, `subcategory`, `midcategory`, `parttype` all
 * live in the PRIMARY DB (Standard_Core by default). Leaf parts (motor,
 * cylinder, lm-guide, …) live in the per-category DB pointed to by
 * `maincategory.db_file_name` — the proxy resolves the right pool via
 * `poolForSubCategory(subCatCode)`.
 */
import { Router } from 'express';
import { poolForSubCategory, query, queryPrimary } from '../db.js';

const router = Router();

const WEB_VISIBLE = new Set(['STANDARD', 'MOTOR']);

router.get('/categories/main', async (_req, res, next) => {
  try {
    const rows = await queryPrimary<{
      main_cat_code: string;
      main_cat_name: string | null;
      main_cat_name_kr: string | null;
      is_standard: number | null;
      color_code: string | null;
      sort_order: number | null;
      db_file_name: string | null;
    }>(
      `SELECT main_cat_code, main_cat_name, main_cat_name_kr, is_standard,
              color_code, sort_order, db_file_name
         FROM maincategory
        WHERE is_active = TRUE
        ORDER BY sort_order, main_cat_code`,
    );
    res.json(
      rows
        .map((r) => ({
          code: r.main_cat_code,
          name: r.main_cat_name ?? '',
          nameKr: r.main_cat_name_kr ?? '',
          isStandard: Number(r.is_standard ?? 0) === 1,
          colorCode: r.color_code,
          sortOrder: Number(r.sort_order ?? 0),
          dbFileName: r.db_file_name ?? '',
        }))
        .filter((m) => WEB_VISIBLE.has(m.code)),
    );
  } catch (e) {
    next(e);
  }
});

router.get('/categories/sub', async (req, res, next) => {
  try {
    const mainCatCode = String(req.query.mainCatCode ?? '');
    if (!mainCatCode) return res.json([]);
    const rows = await queryPrimary<{
      sub_cat_code: string;
      sub_cat_name: string | null;
      sub_cat_name_kr: string | null;
      main_cat_code: string;
      is_vendor: number | null;
      sort_order: number | null;
    }>(
      `SELECT sub_cat_code, sub_cat_name, sub_cat_name_kr, main_cat_code,
              is_vendor, sort_order
         FROM subcategory
        WHERE is_active = TRUE AND main_cat_code = $1
        ORDER BY sort_order, sub_cat_id`,
      [mainCatCode],
    );
    res.json(
      rows.map((r) => ({
        code: r.sub_cat_code,
        name: r.sub_cat_name ?? '',
        nameKr: r.sub_cat_name_kr ?? '',
        mainCatCode: r.main_cat_code,
        isVendor: Number(r.is_vendor ?? 0) === 1,
        sortOrder: Number(r.sort_order ?? 0),
      })),
    );
  } catch (e) {
    next(e);
  }
});

router.get('/categories/mid', async (req, res, next) => {
  try {
    const subCatCode = String(req.query.subCatCode ?? '');
    if (!subCatCode) return res.json([]);
    const rows = await queryPrimary<{
      mid_cat_code: string;
      mid_cat_name: string | null;
      mid_cat_name_kr: string | null;
      sub_cat_code: string;
      sort_order: number | null;
    }>(
      `SELECT mid_cat_code, mid_cat_name, mid_cat_name_kr, sub_cat_code, sort_order
         FROM midcategory
        WHERE is_active = TRUE AND sub_cat_code = $1
        ORDER BY sort_order, mid_cat_id`,
      [subCatCode],
    );
    res.json(
      rows.map((r) => ({
        code: r.mid_cat_code,
        name: r.mid_cat_name ?? '',
        nameKr: r.mid_cat_name_kr ?? '',
        subCatCode: r.sub_cat_code,
        sortOrder: Number(r.sort_order ?? 0),
      })),
    );
  } catch (e) {
    next(e);
  }
});

router.get('/parttypes', async (req, res, next) => {
  try {
    const midCatCode = String(req.query.midCatCode ?? '');
    if (!midCatCode) return res.json([]);
    const rows = await queryPrimary<{
      part_type_code: string;
      part_type_name: string | null;
      part_type_name_kr: string | null;
      mid_cat_code: string;
      cmd_code: string | null;
      has_series: number | null;
      sort_order: number | null;
    }>(
      `SELECT part_type_code, part_type_name, part_type_name_kr, mid_cat_code,
              cmd_code, has_series, sort_order
         FROM parttype
        WHERE is_active = TRUE AND mid_cat_code = $1
        ORDER BY sort_order, part_type_id`,
      [midCatCode],
    );
    res.json(
      rows.map((r) => ({
        code: r.part_type_code,
        name: r.part_type_name ?? '',
        nameKr: r.part_type_name_kr ?? '',
        midCatCode: r.mid_cat_code,
        cmdCode: r.cmd_code,
        hasSeries: Number(r.has_series ?? 0) === 1,
        sortOrder: Number(r.sort_order ?? 0),
      })),
    );
  } catch (e) {
    next(e);
  }
});

// ─────────────────────────────────────────────────────────
// Leaf-parts under a subcategory (motor, cylinder, lm-guide, …)
//
// The endpoint name is kept as `/motor/parts` for backward compat with
// the frontend. To extend to new categories (e.g. CYLINDER), just
// register the partspec.part_type tokens for that sub here OR rely on
// the case-insensitive ILIKE fallback.
// ─────────────────────────────────────────────────────────

const SUB_TO_PART_TYPE: Record<string, string[]> = {
  // Motor sub-categories → partspec.part_type values in Motor_Core
  SERVO: ['Servo'],
  BLDC: ['BLDC'],
  STEPPER: ['Stepper'],
  GEARED: ['Geard', 'Geared'],
  // SM_MOTOR: [],   // unknown mapping
  // ─── add new categories below ─────────────────────────
  // CYLINDER: ['Cylinder'],
  // PNEUMATIC: ['Pneumatic'],
  // LM_GUIDE: ['LMGuide', 'LinearGuide'],
};

router.get('/motor/parts', async (req, res, next) => {
  try {
    const subCatCode = String(req.query.subCatCode ?? '');
    if (!subCatCode) return res.json([]);

    const pool = await poolForSubCategory(subCatCode);

    // Build the IN-list. Falls back to ILIKE matching against subCatCode
    // for unconfigured subs (e.g. CYLINDER → 'cylinder%').
    const types = SUB_TO_PART_TYPE[subCatCode];
    let rows: { code: string; name: string; partType: string }[];
    if (types && types.length) {
      const placeholders = types.map((_, i) => `$${i + 1}`).join(',');
      rows = await query(
        pool,
        `SELECT part_code AS code, part_name AS name, part_type AS "partType"
           FROM partspec
          WHERE is_active = TRUE AND part_type IN (${placeholders})
          ORDER BY part_name`,
        types,
      );
    } else {
      rows = await query(
        pool,
        `SELECT part_code AS code, part_name AS name, part_type AS "partType"
           FROM partspec
          WHERE is_active = TRUE AND part_type ILIKE $1
          ORDER BY part_name`,
        [`${subCatCode.replace(/_$/, '')}%`],
      );
    }

    const seen = new Set<string>();
    const out: Array<Record<string, unknown>> = [];
    for (const r of rows) {
      const key = r.code.replace(/[-_\s]/g, '').toUpperCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        code: r.code,
        name: r.name ?? r.code,
        nameKr: r.name ?? r.code,
        midCatCode: subCatCode,
        cmdCode: r.code,
        hasSeries: false,
        sortOrder: out.length,
      });
    }
    res.json(out);
  } catch (e) {
    next(e);
  }
});

export default router;
