/**
 * Plummer block (SD / SN series) dimension resolver. Catalog field
 * names mirror the C++ `BearingDimensions` struct; aliases below cover
 * Korean and Timken-style English alternates seen in BizMech-web.
 *
 * Required fields (resolved through aliases, then size-table fallback,
 * then thrown):
 *   d1   — shaft / bearing-bore diameter (mm)
 *   D2   — bearing OD (housing seat diameter)
 *   A    — base / body width (along shaft axis)
 *   L    — base length (perpendicular to shaft axis, mounting-slot direction)
 *   H    — overall height from foot bottom to bearing axis
 *   H1   — foot thickness
 *   H2   — overall height from foot bottom to dome top
 *   J    — mounting slot pitch (between the two foot slots)
 *   N    — mounting slot width (clearance for the foot bolt)
 *   g    — bearing seat axial width (length of the cylindrical bore)
 *
 * Optional fields with C++ fallbacks:
 *   A1   — top body width (defaults to A × 0.7)
 *   J1   — cap bolt pitch (Z direction)
 *   N1   — mounting slot length (defaults to N + 5)
 *   t / capBoltM
 *        — cap bolt size (M-spec parsed from "M16" etc., default M16)
 *
 * Resolution order for each dim:
 *   1. Direct field on `req.dimensions` matching any alias.
 *   2. Hardcoded size-table lookup keyed by the catalog's 호칭 /
 *      ProductNo (when the row has one).
 *   3. Throw `DimensionMissingError` listing what was tried.
 *
 * Cap bolt count detection:
 *   1. Explicit `capBoltCount` field on the request.
 *   2. partCode prefix: "SD" → 4, "SN" → 2.
 *   3. Heuristic per C++ line 6966: `J1 > 0 && J2 == 0` ⇒ heavy duty (4).
 */
import type { CadGenerateRequest } from '../../types.js';

export interface PlummerBlockDims {
  d1: number;
  D2: number;
  A: number;
  L: number;
  H: number;
  H1: number;
  H2: number;
  J: number;
  N: number;
  g: number;
  A1: number;
  J1: number;
  N1: number;
  capBoltM: number;
  capBoltCount: 2 | 4;
  // Optional conditional foot-hole dimensions — drive the C++ features
  // `Extra_4Bolt_Holes` (line 7126-7136) and `Locating_Pin_Holes`
  // (line 7138-7148). Zero/missing means "feature disabled".
  J2?: number;  // round bolt-hole pitch in X (SN-only secondary holes)
  N2?: number;  // round bolt-hole diameter (SN-only)
  J3?: number;  // locating pin Z-margin from foot edge
  J4?: number;  // locating pin X-margin from foot edge
  N3?: number;  // locating pin diameter
}

/**
 * Hardcoded size table — port of C++'s `SetPlummerBlockDim`
 * (`NewCreateBearingClass.cpp` line 7836-8101). Used as the second-
 * tier fallback when the BizMech-web catalog row is incomplete. Keys
 * are the 호칭 / ProductNo strings seen on the spec dropdown
 * (uppercase, no whitespace).
 *
 * SD = heavy duty (4 cap bolts). The C++ source has SD entries only;
 * SN entries should be added once a real catalog row needs them.
 */
const SD_SIZE_TABLE: Record<string, Omit<PlummerBlockDims, 'capBoltCount'>> = {
  SD534:  { d1: 180, D2: 310, A: 270, L: 620, H: 180, H1: 60, H2: 360, J: 510, N: 32, g: 96,  A1: 230, J1: 140, N1: 52, capBoltM: 24 },
  SD3134: { d1: 180, D2: 280, A: 250, L: 560, H: 170, H1: 50, H2: 340, J: 470, N: 35, g: 98,  A1: 220, J1: 120, N1: 42, capBoltM: 24 },
  SD3136: { d1: 160, D2: 300, A: 270, L: 630, H: 180, H1: 55, H2: 365, J: 520, N: 35, g: 106, A1: 250, J1: 140, N1: 52, capBoltM: 30 },
  SD3138: { d1: 170, D2: 320, A: 310, L: 680, H: 190, H1: 55, H2: 385, J: 560, N: 35, g: 114, A1: 270, J1: 140, N1: 55, capBoltM: 30 },
  SD3140: { d1: 180, D2: 340, A: 310, L: 700, H: 200, H1: 65, H2: 400, J: 570, N: 35, g: 122, A1: 280, J1: 160, N1: 55, capBoltM: 30 },
  SD3144: { d1: 200, D2: 370, A: 320, L: 780, H: 225, H1: 70, H2: 450, J: 640, N: 40, g: 130, A1: 310, J1: 180, N1: 60, capBoltM: 30 },
  SD3148: { d1: 220, D2: 400, A: 330, L: 820, H: 240, H1: 70, H2: 475, J: 680, N: 40, g: 138, A1: 320, J1: 190, N1: 60, capBoltM: 30 },
  SD3152: { d1: 240, D2: 440, A: 360, L: 880, H: 260, H1: 85, H2: 515, J: 740, N: 42, g: 154, A1: 350, J1: 200, N1: 62, capBoltM: 36 },
  SD3156: { d1: 260, D2: 460, A: 360, L: 920, H: 280, H1: 85, H2: 550, J: 770, N: 42, g: 156, A1: 350, J1: 210, N1: 62, capBoltM: 36 },
  SD3160: { d1: 280, D2: 500, A: 390, L: 990, H: 300, H1: 100, H2: 590, J: 830, N: 50, g: 170, A1: 380, J1: 230, N1: 70, capBoltM: 36 },
  SD3164: { d1: 300, D2: 540, A: 430, L: 1060, H: 325, H1: 100, H2: 640, J: 890, N: 50, g: 186, A1: 400, J1: 250, N1: 70, capBoltM: 36 },
  SD3172: { d1: 340, D2: 600, A: 470, L: 1140, H: 365, H1: 120, H2: 710, J: 960, N: 57, g: 202, A1: 460, J1: 310, N1: 77, capBoltM: 42 },
  SD3176: { d1: 360, D2: 620, A: 500, L: 1160, H: 375, H1: 120, H2: 735, J: 980, N: 57, g: 204, A1: 490, J1: 320, N1: 77, capBoltM: 42 },
  SD3180: { d1: 380, D2: 650, A: 520, L: 1220, H: 390, H1: 125, H2: 770, J: 1040, N: 57, g: 210, A1: 510, J1: 340, N1: 77, capBoltM: 42 },
  SD3184: { d1: 400, D2: 700, A: 560, L: 1250, H: 420, H1: 135, H2: 820, J: 1070, N: 57, g: 234, A1: 550, J1: 380, N1: 77, capBoltM: 42 },
};

/**
 * Aliases — every key our resolver tries for each canonical dim. The
 * lists are intentionally generous because BizMech-web's catalog has
 * been seen to use Korean labels (호칭, 내경, …), Timken codes (Bgw,
 * Bgh, …), and shorthand letters (d, B). First non-empty hit wins.
 */
const ALIASES: Record<
  Exclude<keyof PlummerBlockDims, 'capBoltCount'>,
  readonly string[]
> = {
  d1:       ['d1', 'd', '내경', 'bore', 'shaftBore'],
  D2:       ['D2', 'D', '외경', 'bearingOD'],
  A:        ['A', '폭', 'width', 'shaftWidth'],
  L:        ['L', 'Bgw', 'baseLength', '베이스길이', '슬롯피치'],
  H:        ['H', '중심높이', 'axisHeight', 'centerHeight'],
  H1:       ['H1', '베이스두께', 'baseThickness'],
  H2:       ['H2', 'Bgh', '높이', '총높이', 'totalHeight'],
  J:        ['J', '볼트피치', '마운팅피치', 'boltPitch'],
  J1:       ['J1', '캡볼트피치', 'capBoltPitch'],
  N:        ['N', '슬롯폭', 'slotWidth'],
  N1:       ['N1', '슬롯길이', 'slotLength'],
  g:        ['g', 'G_seat', 'bearingWidth', '베어링폭', 'B'],
  A1:       ['A1', '본체폭', 'bodyWidth'],
  capBoltM: ['capBoltM', 'capBoltSize'],
  // Optional conditional features — return null (not present) by default.
  J2:       ['J2'],
  N2:       ['N2'],
  J3:       ['J3'],
  J4:       ['J4'],
  N3:       ['N3'],
};

function readNumber(req: CadGenerateRequest, ...keys: readonly string[]): number | null {
  for (const k of keys) {
    const v = req.dimensions[k];
    if (v == null || v === '') continue;
    const n = typeof v === 'number' ? v : parseFloat(String(v));
    if (Number.isFinite(n) && n > 0) return n;
  }
  // Case-insensitive fallback (some DBs serialize keys with different casing).
  const lower: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(req.dimensions)) lower[k.toLowerCase()] = v;
  for (const k of keys) {
    const v = lower[k.toLowerCase()];
    if (v == null || v === '') continue;
    const n = typeof v === 'number' ? v : parseFloat(String(v));
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function readString(req: CadGenerateRequest, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = req.dimensions[k];
    if (v != null && v !== '') return String(v);
  }
  return undefined;
}

/**
 * Parse a catalog cap-bolt size string ("M16", "M20", " M24 x 2.5",
 * etc.) into the M-nominal in mm. Returns null when the string
 * doesn't look like an M-thread spec.
 */
function parseCapBoltM(raw: string | undefined): number | null {
  if (!raw) return null;
  const m = raw.trim().toUpperCase().match(/M\s*(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Look up a row in the SD size table by the catalog's product-number
 * field (호칭 / ProductNo / sizeCode). Returns null if no match.
 */
function lookupSizeTable(
  req: CadGenerateRequest,
): Omit<PlummerBlockDims, 'capBoltCount'> | null {
  const raw = readString(req, '호칭', 'ProductNo', 'productNo', 'sizeCode', 'size');
  if (!raw) return null;
  const key = raw.trim().toUpperCase().replace(/\s+/g, '');
  return SD_SIZE_TABLE[key] ?? null;
}

/**
 * Resolve a plummer block dimension record.
 *   1. Try alias hits on `req.dimensions` for each canonical field.
 *   2. Fill remaining fields from the size table (if 호칭 matches).
 *   3. Throw with a structured message listing all still-missing fields.
 */
export function resolvePlummerBlockDims(
  req: CadGenerateRequest,
  partLabel: string,
): PlummerBlockDims {
  const tableEntry = lookupSizeTable(req);

  // Resolve order — mirrors C++ `SetPlummerBlockDim` behaviour
  // (`NewCreateBearingClass.cpp` line 7836-8101) which OVERWRITES the
  // `m_partData->Dim.*` fields with hardcoded constants when the
  // ProductNo matches a known entry. The catalog DB sometimes carries
  // dimensions in different conventions (e.g., SD3134 ships H2=175 in
  // BizMech-web but the C++ size-table value is 340 — the latter is
  // what the dimensions actually need to be for correct geometry).
  // So when we have a size-table entry for this ProductNo, we use it
  // FIRST and only fall back to the DB value when the table entry is
  // missing the field.
  const resolveOne = (key: keyof typeof ALIASES): number | null => {
    if (tableEntry) {
      const tableVal = tableEntry[key];
      if (tableVal != null && tableVal > 0) return tableVal;
    }
    const direct = readNumber(req, ...ALIASES[key]);
    if (direct != null) return direct;
    return null;
  };

  const required: Array<keyof typeof ALIASES> = [
    'd1', 'D2', 'A', 'L', 'H', 'H1', 'H2', 'J', 'N', 'g',
  ];
  const missing: Array<keyof typeof ALIASES> = [];
  const values: Partial<Record<keyof typeof ALIASES, number>> = {};
  for (const k of required) {
    const v = resolveOne(k);
    if (v == null || v <= 0) missing.push(k);
    else values[k] = v;
  }
  if (missing.length) {
    const tableHint = tableEntry
      ? ' (size-table lookup also failed for these fields — table entry exists but field is undefined)'
      : ` (size-table lookup found no entry for 호칭/ProductNo "${readString(req, '호칭', 'ProductNo') ?? '<not set>'}")`;
    throw new Error(
      `${partLabel}: cannot generate — missing or non-positive dimension(s): ` +
        missing.map((k) => `${k} (tried ${ALIASES[k].join('/')})`).join('; ') +
        tableHint +
        `. Received keys: ${Object.keys(req.dimensions).join(', ') || '(none)'}`,
    );
  }

  const A = values.A!;
  const L = values.L!;
  const H = values.H!;
  const H2 = values.H2!;
  const N = values.N!;
  const J = values.J!;
  const D2 = values.D2!;
  const d1 = values.d1!;

  if (D2 <= d1) {
    throw new Error(
      `${partLabel}: bearing OD D2=${D2} must exceed bore d1=${d1}.`,
    );
  }
  if (H2 <= H) {
    throw new Error(
      `${partLabel}: total height H2=${H2} must exceed H=${H} ` +
        `(H is foot-bottom to bearing axis; H2 includes the dome above).`,
    );
  }

  const A1 = resolveOne('A1') ?? A * 0.7;
  const J1 = resolveOne('J1') ?? J * 0.55;
  const N1 = resolveOne('N1') ?? N + 5;

  // Cap bolt size — read the `t` catalog string ("M16" etc.) or the
  // `capBoltM` numeric override or the size-table value.
  const capBoltM_str = parseCapBoltM(readString(req, 't', 'capBolt', 'cap_bolt'));
  const capBoltM_num = resolveOne('capBoltM');
  const capBoltM = capBoltM_str ?? capBoltM_num ?? 16;

  // Cap bolt count detection.
  let capBoltCount: 2 | 4 = 2;
  const code = String(req.partCode).toUpperCase();
  const explicit = readNumber(req, 'capBoltCount', 'cap_bolt_count');
  const J2 = readNumber(req, 'J2') ?? 0;
  if (explicit === 4) capBoltCount = 4;
  else if (explicit === 2) capBoltCount = 2;
  else if (code.startsWith('SD')) capBoltCount = 4;
  else if (code.startsWith('SN')) capBoltCount = 2;
  else if (J1 > 0 && J2 === 0) capBoltCount = 4;

  // Optional conditional foot-hole dimensions — pass through if catalog
  // provides them, undefined otherwise. Used downstream by the
  // `Extra_4Bolt_Holes` (SN) and `Locating_Pin_Holes` features.
  const J2_opt = resolveOne('J2') ?? undefined;
  const N2_opt = resolveOne('N2') ?? undefined;
  const J3_opt = resolveOne('J3') ?? undefined;
  const J4_opt = resolveOne('J4') ?? undefined;
  const N3_opt = resolveOne('N3') ?? undefined;

  return {
    d1,
    D2,
    A,
    L,
    H,
    H1: values.H1!,
    H2,
    J,
    N,
    g: values.g!,
    A1,
    J1,
    N1,
    capBoltM,
    capBoltCount,
    J2: J2_opt,
    N2: N2_opt,
    J3: J3_opt,
    J4: J4_opt,
    N3: N3_opt,
  };
}
