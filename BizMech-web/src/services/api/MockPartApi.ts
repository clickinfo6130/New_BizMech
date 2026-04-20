/**
 * MockPartApi — reads /public/data/Standard_Core.db & Motor_Core.db in-browser
 * using sql.js (SQLite compiled to WebAssembly).
 *
 * Strategy:
 *   - Lazy-load sql-wasm.wasm once (cached).
 *   - Fetch each .db file once, open as sql.js Database, cache instance.
 *   - `maincategory.db_file_name` tells us which physical .db a part lives in.
 *   - All reads return plain JSON matching the types in @/types.
 *
 * This file implements IPartApi so the Java backend can later replace it
 * transparently via `apiFactory.ts`.
 */
// ★ Use the CJS build explicitly. The default `sql.js` entry resolves to
//   `dist/sql-wasm-browser.js` via the package's `browser` field, which is a
//   UMD/IIFE without a proper ESM default export and breaks `import default`
//   under Vite. `dist/sql-wasm.js` is the CJS UMD that esbuild can convert
//   cleanly.
// @ts-expect-error — sql.js has no TS declarations for the subpath
import initSqlJs from 'sql.js/dist/sql-wasm.js';
import type { Database, SqlJsStatic } from 'sql.js';
// Vite will turn this into a hashed URL under /assets and serve the wasm.
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url';

import type { IPartApi } from './IPartApi';
import { buildOrderCode } from './IPartApi';
import type {
  AuthUser,
  DimensionKeyOption,
  DimensionMeta,
  DownloadRequest,
  DownloadResult,
  LoginRequest,
  LoginResult,
  MainCategory,
  MidCategory,
  PartDimension,
  PartSpec,
  PartSeriesSpec,
  PartType,
  SubCategory,
} from '@/types';

// ─────────────────────────────────────────────────────────
// sql.js singleton bootstrap
// ─────────────────────────────────────────────────────────

let sqlPromise: Promise<SqlJsStatic> | null = null;
function getSql(): Promise<SqlJsStatic> {
  if (!sqlPromise) {
    sqlPromise = initSqlJs({ locateFile: () => sqlWasmUrl });
  }
  return sqlPromise;
}

const dbCache = new Map<string, Promise<Database>>();

async function openDb(fileName: string): Promise<Database> {
  const key = fileName.toLowerCase();
  let p = dbCache.get(key);
  if (!p) {
    p = (async () => {
      const SQL = await getSql();
      const url = `/data/${fileName}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
      const buf = new Uint8Array(await res.arrayBuffer());
      return new SQL.Database(buf);
    })();
    dbCache.set(key, p);
  }
  return p;
}

// Helper: run a parameterized query and map rows to a typed array.
function runQuery<T>(
  db: Database,
  sql: string,
  params: (string | number | null)[] = [],
  map: (row: Record<string, unknown>) => T,
): T[] {
  const stmt = db.prepare(sql);
  stmt.bind(params as never);
  const out: T[] = [];
  while (stmt.step()) {
    out.push(map(stmt.getAsObject()));
  }
  stmt.free();
  return out;
}

// ─────────────────────────────────────────────────────────
// Main category → which DB file to query
// ─────────────────────────────────────────────────────────
//
// Some rows in the DBs reference 'Motor_core.db' with mixed case. Always
// resolve via an in-memory cache that normalizes to the actual file on disk.

const DB_FILE_INDEX: Record<string, string> = {
  standard_core: 'Standard_Core.db',
  motor_core: 'Motor_Core.db',
};

function resolveDbFile(name: string): string {
  const lower = (name || '').toLowerCase().replace(/\.db$/, '');
  return DB_FILE_INDEX[lower] ?? 'Standard_Core.db';
}

// A part's home db — looked up once via maincategory→subcategory→midcategory→parttype.
// Since the category tree is tiny, we prefetch a map partTypeCode → dbFileName.
let partTypeDbIndex: Map<string, string> | null = null;

async function getPartTypeDbIndex(): Promise<Map<string, string>> {
  if (partTypeDbIndex) return partTypeDbIndex;
  const result = new Map<string, string>();
  // We must inspect both DBs since a part may only exist in one of them.
  for (const fileName of ['Standard_Core.db', 'Motor_Core.db']) {
    try {
      const db = await openDb(fileName);
      const rows = runQuery<{ code: string }>(
        db,
        `SELECT part_type_code AS code FROM parttype WHERE is_active = 1`,
        [],
        (r) => ({ code: String(r.code) }),
      );
      for (const r of rows) {
        if (!result.has(r.code)) result.set(r.code, fileName);
      }
      // Also index partspec (used when parttype is empty — Motor_Core.parttype is empty)
      const rows2 = runQuery<{ code: string }>(
        db,
        `SELECT DISTINCT part_code AS code FROM partspec`,
        [],
        (r) => ({ code: String(r.code) }),
      );
      for (const r of rows2) {
        if (!result.has(r.code)) result.set(r.code, fileName);
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[MockPartApi] failed to index', fileName, e);
    }
  }
  partTypeDbIndex = result;
  return result;
}

async function dbForPartCode(partCode: string): Promise<Database> {
  const idx = await getPartTypeDbIndex();
  const file = idx.get(partCode) ?? 'Standard_Core.db';
  return openDb(file);
}

// ─────────────────────────────────────────────────────────
// MockPartApi implementation
// ─────────────────────────────────────────────────────────

export class MockPartApi implements IPartApi {
  // ── Auth (local, no real verification) ─────────────
  async login(req: LoginRequest): Promise<LoginResult> {
    await new Promise((r) => setTimeout(r, 200)); // slight UX delay
    if (!req.username || !req.password) {
      throw new Error('Username/password required');
    }
    const user: AuthUser = {
      id: req.username,
      name: req.username,
      email: req.username.includes('@') ? req.username : `${req.username}@bizmech.local`,
      roles: ['user'],
    };
    return { token: `mock.${btoa(req.username)}.${Date.now()}`, user };
  }

  async me(token: string): Promise<AuthUser | null> {
    if (!token?.startsWith('mock.')) return null;
    try {
      const name = atob(token.split('.')[1]);
      return { id: name, name, roles: ['user'] };
    } catch {
      return null;
    }
  }

  async logout(): Promise<void> {
    // no-op
  }

  // ── Category hierarchy ──────────────────────────────
  async getMainCategories(): Promise<MainCategory[]> {
    const db = await openDb('Standard_Core.db');
    // ★ The web build only exposes physical parts browser — hide
    //    CALCULATION / UTILITY / BOM, which are desktop-plugin-only tools.
    const WEB_VISIBLE = new Set(['STANDARD', 'MOTOR']);
    return runQuery<MainCategory>(
      db,
      `SELECT main_cat_code, main_cat_name, main_cat_name_kr, is_standard, color_code, sort_order, db_file_name
         FROM maincategory WHERE is_active = 1 ORDER BY sort_order, main_cat_code`,
      [],
      (r) => ({
        code: String(r.main_cat_code),
        name: String(r.main_cat_name ?? ''),
        nameKr: String(r.main_cat_name_kr ?? ''),
        isStandard: Number(r.is_standard ?? 0) === 1,
        colorCode: (r.color_code as string) ?? null,
        sortOrder: Number(r.sort_order ?? 0),
        dbFileName: resolveDbFile(String(r.db_file_name ?? '')),
      }),
    ).filter((m) => WEB_VISIBLE.has(m.code));
  }

  /**
   * Motor leaves live in Motor_Core.db.partspec. We map subcategory → part_type
   * so picking "서보모터" lists every Servo partspec row (SGM-7, MELSERVO-J4,
   * MINAS-A6N, …). The real PartManager uses a vendor→series mapping that
   * isn't in the public DB, so we show all series of the matching type.
   */
  async getMotorPartsBySub(subCatCode: string): Promise<PartType[]> {
    const SUB_TO_PARTTYPE: Record<string, string[]> = {
      SERVO: ['Servo'],
      BLDC: ['BLDC'],
      STEPPER: ['Stepper'],
      GEARED: ['Geard', 'Geared'],
      SM_MOTOR: [],
    };
    const types = SUB_TO_PARTTYPE[subCatCode] ?? [];
    if (!types.length) return [];

    const db = await openDb('Motor_Core.db');
    const placeholders = types.map(() => '?').join(',');
    const rows = runQuery<{
      code: string;
      name: string;
      partType: string;
    }>(
      db,
      `SELECT part_code AS code, part_name AS name, part_type AS partType
         FROM partspec WHERE is_active = 1 AND part_type IN (${placeholders})
         ORDER BY part_name`,
      types,
      (r) => ({
        code: String(r.code),
        name: String(r.name ?? r.code),
        partType: String(r.partType ?? ''),
      }),
    );

    // Dedupe by code (the DB has both SGM-7 and SGM7 aliases).
    const seen = new Set<string>();
    const out: PartType[] = [];
    for (const r of rows) {
      const key = r.code.replace(/[-_\s]/g, '').toUpperCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        code: r.code,
        name: r.name,
        nameKr: r.name,
        midCatCode: subCatCode,
        cmdCode: r.code,
        hasSeries: false,
        sortOrder: out.length,
      });
    }
    return out;
  }

  async getSubCategories(mainCatCode: string): Promise<SubCategory[]> {
    // subcategory only lives in Standard_Core.db (it also holds MOTOR subs).
    // ★ Secondary sort by sub_cat_id (insertion order) because a lot of
    //   rows share sort_order=0 — that would otherwise fall through to
    //   alphabetical order and desync from PartManager's desktop order.
    const db = await openDb('Standard_Core.db');
    return runQuery<SubCategory>(
      db,
      `SELECT sub_cat_code, sub_cat_name, sub_cat_name_kr, main_cat_code, is_vendor, sort_order
         FROM subcategory WHERE is_active = 1 AND main_cat_code = ?
         ORDER BY sort_order, sub_cat_id`,
      [mainCatCode],
      (r) => ({
        code: String(r.sub_cat_code),
        name: String(r.sub_cat_name ?? ''),
        nameKr: String(r.sub_cat_name_kr ?? ''),
        mainCatCode: String(r.main_cat_code),
        isVendor: Number(r.is_vendor ?? 0) === 1,
        sortOrder: Number(r.sort_order ?? 0),
      }),
    );
  }

  async getMidCategories(subCatCode: string): Promise<MidCategory[]> {
    const db = await openDb('Standard_Core.db');
    return runQuery<MidCategory>(
      db,
      `SELECT mid_cat_code, mid_cat_name, mid_cat_name_kr, sub_cat_code, sort_order
         FROM midcategory WHERE is_active = 1 AND sub_cat_code = ?
         ORDER BY sort_order, mid_cat_id`,
      [subCatCode],
      (r) => ({
        code: String(r.mid_cat_code),
        name: String(r.mid_cat_name ?? ''),
        nameKr: String(r.mid_cat_name_kr ?? ''),
        subCatCode: String(r.sub_cat_code),
        sortOrder: Number(r.sort_order ?? 0),
      }),
    );
  }

  async getPartTypes(midCatCode: string): Promise<PartType[]> {
    // parttype is in Standard_Core; Motor_Core.parttype is empty.
    // ★ All parttype rows use sort_order=0 in the shipped DB, so we fall
    //   back to part_type_id to preserve PartManager's intended order
    //   (e.g. DGBB before ACBB under STD_BEARING).
    const db = await openDb('Standard_Core.db');
    return runQuery<PartType>(
      db,
      `SELECT part_type_code, part_type_name, part_type_name_kr, mid_cat_code, cmd_code, has_series, sort_order
         FROM parttype WHERE is_active = 1 AND mid_cat_code = ?
         ORDER BY sort_order, part_type_id`,
      [midCatCode],
      (r) => ({
        code: String(r.part_type_code),
        name: String(r.part_type_name ?? ''),
        nameKr: String(r.part_type_name_kr ?? ''),
        midCatCode: String(r.mid_cat_code),
        cmdCode: (r.cmd_code as string) ?? null,
        hasSeries: Number(r.has_series ?? 0) === 1,
        sortOrder: Number(r.sort_order ?? 0),
      }),
    );
  }

  // ── Spec / dimension ────────────────────────────────
  async getPartSpec(partCode: string): Promise<PartSpec | null> {
    const db = await dbForPartCode(partCode);
    const rows = runQuery<{
      id: number;
      part_type: string;
      part_code: string;
      part_name: string;
      spec_data: string;
    }>(
      db,
      `SELECT id, part_type, part_code, part_name, spec_data
         FROM partspec WHERE part_code = ? AND is_active = 1 LIMIT 1`,
      [partCode],
      (r) => ({
        id: Number(r.id ?? 0),
        part_type: String(r.part_type ?? ''),
        part_code: String(r.part_code),
        part_name: String(r.part_name ?? ''),
        spec_data: String(r.spec_data ?? '{}'),
      }),
    );
    if (!rows.length) return null;
    const row = rows[0];

    let json: { Series?: unknown[] } = {};
    try {
      json = JSON.parse(row.spec_data);
    } catch {
      return null;
    }

    const series: PartSeriesSpec[] = (json.Series ?? []).map((s) => {
      const raw = s as Record<string, unknown>;
      return {
        id: Number(raw.id ?? 0),
        name: String(raw.name ?? ''),
        cmd: String(raw.CMD ?? ''),
        options: ((raw.option ?? []) as Array<Record<string, unknown>>).map((o) => ({
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
                // ★ Preserve the original shape — filter is either a string[]
                //   or a comma-separated string, filter_Values is string[][].
                filter: v.filter as string[] | string | undefined,
                filter_Values: v.filter_Values as string[][] | undefined,
              }))
            : [],
        })),
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

  async findPartSpecByNameOrCode(nameOrCode: string): Promise<PartSpec | null> {
    if (!nameOrCode?.trim()) return null;
    const wanted = nameOrCode.trim();
    // Try both DBs; partCode has priority, then partName.
    for (const fileName of ['Standard_Core.db', 'Motor_Core.db']) {
      const db = await openDb(fileName);
      const match = runQuery<{ code: string }>(
        db,
        `SELECT part_code AS code FROM partspec
           WHERE is_active = 1 AND (part_code = ? OR part_name = ?) LIMIT 1`,
        [wanted, wanted],
        (r) => ({ code: String(r.code) }),
      );
      if (match.length) {
        return this.getPartSpec(match[0].code);
      }
    }
    // Heuristic fallback: partial match on partName
    for (const fileName of ['Standard_Core.db', 'Motor_Core.db']) {
      const db = await openDb(fileName);
      const match = runQuery<{ code: string }>(
        db,
        `SELECT part_code AS code FROM partspec
           WHERE is_active = 1 AND part_name LIKE ? LIMIT 1`,
        [`%${wanted}%`],
        (r) => ({ code: String(r.code) }),
      );
      if (match.length) {
        return this.getPartSpec(match[0].code);
      }
    }
    return null;
  }

  async getDimensionMeta(partCode: string): Promise<DimensionMeta[]> {
    const db = await dbForPartCode(partCode);
    return runQuery<DimensionMeta>(
      db,
      `SELECT part_code, field_name, display_name, display_name_en, data_type, unit, is_key_field, display_order
         FROM dimensionmeta WHERE part_code = ? AND is_active = 1
         ORDER BY display_order, id`,
      [partCode],
      (r) => ({
        partCode: String(r.part_code),
        fieldName: String(r.field_name),
        displayName: String(r.display_name ?? r.field_name ?? ''),
        displayNameEn: (r.display_name_en as string) ?? undefined,
        dataType: String(r.data_type ?? 'TEXT'),
        unit: (r.unit as string) ?? undefined,
        isKeyField: Number(r.is_key_field ?? 0) === 1,
        displayOrder: Number(r.display_order ?? 0),
      }),
    );
  }

  async getDimensionKeyOptions(partCode: string): Promise<DimensionKeyOption[]> {
    const db = await dbForPartCode(partCode);
    return runQuery<DimensionKeyOption>(
      db,
      `SELECT part_code, key_field_name, key_level, key_value, parent_key, sort_order
         FROM dimensionkeyoption WHERE part_code = ? AND is_active = 1
         ORDER BY key_level, sort_order, key_value`,
      [partCode],
      (r) => ({
        partCode: String(r.part_code),
        keyFieldName: String(r.key_field_name),
        keyLevel: Number(r.key_level ?? 1),
        keyValue: String(r.key_value),
        parentKey: (r.parent_key as string) ?? null,
      }),
    );
  }

  async findDimension(
    partCode: string,
    keyValues: Record<string, string>,
  ): Promise<PartDimension | null> {
    const db = await dbForPartCode(partCode);
    // Load candidate rows, then match by parsed key_values JSON in memory.
    // (partdimension.key_values is a Korean-field JSON — column names vary per part.)
    const rows = runQuery<PartDimension>(
      db,
      `SELECT id, part_code, key_composite, key_values, dimension_data
         FROM partdimension WHERE part_code = ? AND is_active = 1`,
      [partCode],
      (r) => {
        let kv: Record<string, string> = {};
        let dim: Record<string, number | string> = {};
        try {
          kv = JSON.parse(String(r.key_values ?? '{}'));
        } catch {
          /* ignore */
        }
        try {
          dim = JSON.parse(String(r.dimension_data ?? '{}'));
        } catch {
          /* ignore */
        }
        return {
          id: Number(r.id),
          partCode: String(r.part_code),
          keyComposite: String(r.key_composite ?? ''),
          keyValues: kv,
          dimensionData: dim,
        };
      },
    );

    if (!rows.length) return null;

    const wanted = Object.entries(keyValues).filter(
      ([, v]) => v != null && v !== '' && v !== '-',
    );
    if (!wanted.length) return rows[0];

    // ★ Score-based matching (fuzzy, resilient to suffix/whitespace drift).
    //
    // The spec JSON's value.name and partdimension.key_values occasionally
    // differ by a suffix ("기계용" vs "기계") or whitespace. Requiring a
    // strict AND-match of every key caused findDimension to fall back to
    // rows[0] for every selection — i.e. the preview always drew the
    // smallest (first) size.
    //
    // Scoring rules per (k, v) pair:
    //   +3 exact normalized match (winner)
    //   +2 one string starts with the other    (e.g. "기계용" ⊂ "기계")
    //   +1 numeric equality (parseFloat)          (e.g. "M3" ↔ "3" — no, skip;
    //                                              but useful for "3" ↔ "3.00")
    //    0 mismatch
    //
    // We also weight the "List"/size key higher because it's the primary
    // discriminator for the visual preview.
    const normalize = (s: string) => s.trim().toLowerCase();
    const isSizeKey = (k: string) => {
      const kn = normalize(k);
      return kn === 'list' || kn === '사이즈' || kn === '호칭' || kn === 'size';
    };

    function scorePair(k: string, want: string, got: string | undefined): number {
      if (got == null) return 0;
      const a = normalize(want);
      const b = normalize(got);
      if (!a && !b) return 0;
      const mult = isSizeKey(k) ? 2 : 1; // size matches weighted 2×
      if (a === b) return 3 * mult;
      if (a && b && (a.startsWith(b) || b.startsWith(a))) return 2 * mult;
      const na = parseFloat(want);
      const nb = parseFloat(String(got));
      if (!Number.isNaN(na) && !Number.isNaN(nb) && Math.abs(na - nb) < 1e-6) {
        return 1 * mult;
      }
      return 0;
    }

    let best: PartDimension | null = null;
    let bestScore = -1;
    for (const row of rows) {
      let score = 0;
      for (const [k, v] of wanted) {
        score += scorePair(k, v, row.keyValues[k]);
      }
      if (score > bestScore) {
        bestScore = score;
        best = row;
      }
    }

    // eslint-disable-next-line no-console
    console.debug(
      `[findDimension] part=${partCode} wanted=${JSON.stringify(keyValues)} → score=${bestScore}/${wanted.length * 6} key=${best?.keyComposite}`,
    );

    // Require at least ONE positive match to accept; else fallback to rows[0]
    // (so the preview still has something to draw).
    return bestScore > 0 ? best : rows[0];
  }

  async searchByOrderCode(orderCode: string) {
    if (!orderCode) return null;
    // Try exact match on key_composite first.
    const [partCode] = orderCode.split('|');
    if (!partCode) return null;
    const db = await dbForPartCode(partCode);

    const rows = runQuery<PartDimension>(
      db,
      `SELECT id, part_code, key_composite, key_values, dimension_data
         FROM partdimension
        WHERE part_code = ? AND (key_composite = ? OR key_composite LIKE ?)
        LIMIT 1`,
      [partCode, orderCode, `${orderCode}%`],
      (r) => {
        let kv: Record<string, string> = {};
        let dim: Record<string, number | string> = {};
        try {
          kv = JSON.parse(String(r.key_values ?? '{}'));
        } catch {
          /* ignore */
        }
        try {
          dim = JSON.parse(String(r.dimension_data ?? '{}'));
        } catch {
          /* ignore */
        }
        return {
          id: Number(r.id),
          partCode: String(r.part_code),
          keyComposite: String(r.key_composite ?? ''),
          keyValues: kv,
          dimensionData: dim,
        };
      },
    );

    if (!rows.length) return null;
    const dimension = rows[0];
    const [spec, meta] = await Promise.all([
      this.getPartSpec(partCode),
      this.getDimensionMeta(partCode),
    ]);
    if (!spec) return null;
    return { spec, dimension, meta };
  }

  // ── Download (mock) ─────────────────────────────────
  async download(req: DownloadRequest): Promise<DownloadResult> {
    // Real implementation (Java backend) should stream a file.
    // Mock produces a tiny text file summarizing the selection.
    const code = buildOrderCode(req.partCode, {});
    const content = [
      '# BizMech mock download',
      `PartCode   : ${req.partCode}`,
      `KeyCompos. : ${req.keyComposite}`,
      `Format     : ${req.format}`,
      `OrderCode  : ${code.value}`,
      '',
      'This file is generated by MockPartApi and is a placeholder.',
      'When the Java backend is ready, HttpPartApi.download() will return a real STEP/DWG stream.',
    ].join('\n');
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    return {
      fileName: `${req.partCode}_${req.keyComposite.replace(/[^\w.-]+/g, '_')}.${req.format.toLowerCase()}.txt`,
      mimeType: 'text/plain',
      url: URL.createObjectURL(blob),
    };
  }
}
