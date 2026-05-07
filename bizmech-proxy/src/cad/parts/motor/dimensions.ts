/**
 * Motor dimension resolver — currently scoped to the SGM-7 servo motor
 * series (Yaskawa Sigma-7) plus its add-on options (brake, gearhead,
 * oil seal). Catalog field names mirror the C++ `MotorDimensions`
 * struct (`C++Source/PartData.h:929-1116`) so a future expansion to
 * other motor types reuses the same resolver.
 *
 * Required fields (SGM-7 needs all of these to produce measurable geometry):
 *   LC           — frame width (square side length, mm)
 *   L1_LL or LX  — total motor length including encoder cap, mm
 *   S            — output shaft diameter, mm
 *   LR           — output shaft protrusion length, mm
 *
 * Optional fields with C++ fallbacks:
 *   LH, L2, L3, R, LB / LE, EnH / EnW / EnL, PCD_LA, M_LZ, TL_LG.
 *
 * Option detection (mirrors C++ `SetMotorOptions` line 1131-1156 and
 * the brake-detection block at line 1180-1192):
 *   hasBrake     — `req.dimensions.hasBrake` flag, OR
 *                   `Attachment_Options` contains "E" / "C", OR
 *                   `SL > 0`
 *   hasGearhead  — `req.dimensions.hasGearhead` flag, OR
 *                   `GearHead` string contains "H"
 *   hasOilSeal   — `req.dimensions.hasOilSeal` flag
 *
 * When hasBrake is true the C++ swaps L1/L2/L3 for the brake-equipped
 * variants `LO1_LLO`, `LO2`, `LO3`. We apply the same swap so the
 * resulting axial layout matches catalog measurements for braked
 * motors directly.
 *
 * Gearhead dims (used only when hasGearhead) — `G_*` prefixed:
 *   G_LC, G_LL, G_LG, G_LA, G_LZ, G_LB, G_LE, G_LD, G_L3 (mounting
 *   geometry) and G_S, G_L2 (output shaft).
 */
import type { CadGenerateRequest } from '../../types.js';
import { resolveDims, type DimSpec } from '../../core/dim-resolver.js';

export interface MotorCoreDims {
  /** Frame width (square frame side length). */
  LC: number;
  /** Total length from front face to rear of encoder. */
  L1: number;
  /** Output shaft diameter. */
  S: number;
  /** Output shaft protrusion length. */
  LR: number;
}

export interface MotorOptions {
  /** Electromagnetic brake module + cover between stator and encoder. */
  hasBrake: boolean;
  /** Reduction gearhead extending the assembly past the front face. */
  hasGearhead: boolean;
  /** Rubber oil-seal ring around the shaft on the front face. */
  hasOilSeal: boolean;
  /** Terminal connector box on top (cosmetic — currently not modelled). */
  hasConnector: boolean;
}

export interface BrakeDims {
  /** Brake module axial length. */
  SL: number;
}

export interface GearheadDims {
  /** Gearhead frame width (square). */
  G_LC: number;
  /** Total assembly length including the motor (L1_LL + gearhead). */
  G_LL: number;
  /** Gearhead flange thickness. */
  G_LG: number;
  /** Mounting bolt PCD on the gearhead flange. */
  G_LA?: number;
  /** Mounting bolt hole diameter. */
  G_LZ?: number;
  /** Pilot-boss 1 outer diameter. */
  G_LB?: number;
  /** Pilot-boss 1 axial length. */
  G_LE?: number;
  /** Pilot-boss 2 outer diameter. */
  G_LD?: number;
  /** Combined pilot 1+2 axial length. */
  G_L3?: number;
  /** Gearhead output shaft diameter. */
  G_S: number;
  /** Gearhead output shaft protrusion length (main section). */
  G_L2: number;
}

export interface MotorDims extends MotorCoreDims {
  /** Frame height (defaults to LC). */
  LH: number;
  /** Front body section length (front bracket + stator). */
  L2: number;
  /** Encoder / connector axial position from the front face. */
  L3: number;
  /** Corner radius of the square frame profile. */
  R: number;
  /** Pilot-boss OD on the front face (bearing fit). */
  LB?: number;
  /** Pilot-boss protrusion length. */
  LE?: number;
  /** Encoder cap height / diameter. */
  EnH: number;
  /** Encoder cap width — when 0, encoder is circular. */
  EnW: number;
  /** Encoder cap axial length. */
  EnL: number;
  /** Bolt-circle diameter (mounting hole positions). */
  PCD_LA?: number;
  /** Mounting bolt size raw string from the catalog (e.g. "4-M5"). */
  M_LZ?: string;
  /** Mounting hole / tap depth. */
  TL_LG?: number;
  /** Resolved option flags. */
  options: MotorOptions;
  /** Brake dims (only meaningful when options.hasBrake). */
  brake?: BrakeDims;
  /** Gearhead dims (only meaningful when options.hasGearhead). */
  gearhead?: GearheadDims;
}

const MOTOR_CORE_SPEC: DimSpec<MotorCoreDims> = {
  LC: { aliases: ['LC', 'frameW', 'frameWidth'], required: true },
  L1: { aliases: ['L1', 'L1_LL', 'LX', 'totalLength'], required: true },
  S:  { aliases: ['S', 'shaftDia', 'shaftDiameter'], required: true },
  LR: { aliases: ['LR', 'shaftLen', 'shaftLength'], required: true },
};

function readNumber(req: CadGenerateRequest, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = req.dimensions[k];
    if (v == null || v === '') continue;
    const n = typeof v === 'number' ? v : parseFloat(String(v));
    if (Number.isFinite(n)) return n;
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
 * Coerce a request value to a boolean. Treats `"Y"` / `"y"` / `"yes"` /
 * `"true"` / `"1"` / `"T"` / `"on"` as true; everything else (including
 * empty / undefined) is false.
 */
function readBoolFlag(req: CadGenerateRequest, ...keys: string[]): boolean {
  for (const k of keys) {
    const v = req.dimensions[k];
    if (v == null || v === '') continue;
    const s = String(v).trim().toLowerCase();
    if (s === 'y' || s === 'yes' || s === 'true' || s === '1' || s === 't' || s === 'on') {
      return true;
    }
  }
  return false;
}

function resolveOptions(req: CadGenerateRequest): MotorOptions {
  // Brake — explicit flag, or `Attachment_Options` contains E / C, or
  // `SL > 0` (catalog-driven implicit detection per C++ line 1180-1183).
  let hasBrake = readBoolFlag(req, 'hasBrake', 'has_brake', 'brake');
  if (!hasBrake) {
    const att = readString(req, 'Attachment_Options', 'attachment_options');
    if (att) {
      const u = att.toUpperCase();
      if (u.includes('E') || u.includes('C')) hasBrake = true;
    }
  }
  if (!hasBrake) {
    const sl = readNumber(req, 'SL');
    if (sl != null && sl > 0) hasBrake = true;
  }

  // Gearhead — explicit flag, or `GearHead` string contains "H" (per
  // C++ line 1144).
  let hasGearhead = readBoolFlag(req, 'hasGearhead', 'has_gearhead', 'gearhead');
  if (!hasGearhead) {
    const gh = readString(req, 'GearHead', 'gearHead', 'gearhead_type');
    if (gh && gh.toUpperCase().includes('H')) hasGearhead = true;
  }

  const hasOilSeal = readBoolFlag(req, 'hasOilSeal', 'has_oilseal', 'oilseal', 'oil_seal');
  const hasConnector =
    readBoolFlag(req, 'hasConnector', 'has_connector', 'connector') ||
    (() => {
      const v = readNumber(req, 'CW_MW');
      return v != null && v > 0;
    })();

  return { hasBrake, hasGearhead, hasOilSeal, hasConnector };
}

/**
 * Resolve a SGM-7 dimension record. Throws on missing required fields.
 * Optional fields are filled with the same fallbacks the C++ code uses
 * (see `CreateSquareFrameBody` for the corresponding `if (val <= 0)`
 * blocks at lines 1186-1204, 1297-1303, 1310 of NewCreateMotorClass.cpp).
 */
export function resolveMotorDims(
  req: CadGenerateRequest,
  partLabel: string,
): MotorDims {
  const options = resolveOptions(req);

  // ── Effective L1 / L2 / L3 ──
  // When hasBrake the C++ swaps in `LO1_LLO`, `LO2`, `LO3` (line 1185-1192).
  // The resolver returns the SWAPPED value as the "active" L1/L2/L3 so
  // downstream geometry only deals with one set of axial dims.
  let L1: number;
  let L2_raw: number | null;
  let L3_raw: number | null;
  if (options.hasBrake) {
    const lo1 = readNumber(req, 'LO1_LLO', 'LO1');
    L1 = lo1 && lo1 > 0 ? lo1 : (readNumber(req, 'L1', 'L1_LL', 'LX') ?? 0);
    L2_raw = readNumber(req, 'LO2');
    if (!L2_raw || L2_raw <= 0) L2_raw = readNumber(req, 'L2');
    L3_raw = readNumber(req, 'LO3');
    if (!L3_raw || L3_raw <= 0) L3_raw = readNumber(req, 'L3');
  } else {
    L1 = readNumber(req, 'L1', 'L1_LL', 'LX') ?? 0;
    L2_raw = readNumber(req, 'L2');
    L3_raw = readNumber(req, 'L3');
  }
  // Resolve the rest via the strict resolver — but inject our computed
  // L1 first so the strict validator can act on it.
  const tempReq: CadGenerateRequest = { ...req, dimensions: { ...req.dimensions, L1 } };
  const core = resolveDims(tempReq, MOTOR_CORE_SPEC, partLabel);

  if (core.LC <= 0 || core.L1 <= 0 || core.S <= 0 || core.LR <= 0) {
    throw new Error(
      `${partLabel}: motor dimensions must be positive — ` +
        `LC=${core.LC} L1=${core.L1} S=${core.S} LR=${core.LR}`,
    );
  }
  if (core.S * 2 >= core.LC) {
    throw new Error(
      `${partLabel}: shaft diameter S=${core.S} must be less than half the frame ` +
        `width LC=${core.LC} — output shaft would protrude outside the bracket.`,
    );
  }

  const LH = readNumber(req, 'LH') ?? core.LC;
  const R = readNumber(req, 'R', 'cornerR') ?? 1;

  // L2 default: C++ line 1199 → L1 − encCapLen, where encCapLen = L1×0.2 when EnL absent.
  const EnL_raw = readNumber(req, 'EnL');
  const encCapLen_default = EnL_raw && EnL_raw > 0 ? EnL_raw : core.L1 * 0.2;
  const L2 = L2_raw && L2_raw > 0 ? L2_raw : core.L1 - encCapLen_default;
  const L3 = L3_raw && L3_raw > 0 ? L3_raw : L2 + (core.L1 - L2) * 0.5;

  // Encoder defaults: C++ line 1301-1303.
  let EnH = readNumber(req, 'EnH') ?? 0;
  const EnW = readNumber(req, 'EnW') ?? 0;
  if (EnH <= 0 && EnW <= 0) EnH = core.LC * 0.85;
  const EnL = encCapLen_default;

  const LB = readNumber(req, 'LB') ?? undefined;
  const LE = readNumber(req, 'LE') ?? undefined;
  const PCD_LA = readNumber(req, 'PCD_LA', 'PCD') ?? undefined;
  const M_LZ = readString(req, 'M_LZ', 'mountBolt');
  const TL_LG = readNumber(req, 'TL_LG', 'mountDepth') ?? undefined;

  const brake = options.hasBrake ? resolveBrakeDims(req, core, L2, encCapLen_default) : undefined;
  const gearhead = options.hasGearhead ? resolveGearheadDims(req, core, partLabel) : undefined;

  return {
    ...core,
    LH,
    L2,
    L3,
    R,
    LB: LB && LB > 0 ? LB : undefined,
    LE: LE && LE > 0 ? LE : undefined,
    EnH,
    EnW,
    EnL,
    PCD_LA: PCD_LA && PCD_LA > 0 ? PCD_LA : undefined,
    M_LZ,
    TL_LG: TL_LG && TL_LG > 0 ? TL_LG : undefined,
    options,
    brake,
    gearhead,
  };
}

/**
 * Brake module length — C++ line 1248: prefer catalog `SL`, else
 * compute as `L1 − L2 − encCapLen`, else fall back to 25 mm.
 */
function resolveBrakeDims(
  req: CadGenerateRequest,
  core: MotorCoreDims,
  L2: number,
  encCapLen: number,
): BrakeDims {
  let SL = readNumber(req, 'SL') ?? 0;
  if (SL <= 0) SL = core.L1 - L2 - encCapLen;
  if (SL <= 0) SL = 25;
  return { SL };
}

/**
 * Gearhead dims — required: G_LC, G_LL, G_S. Other fields default to
 * C++ values (line 3454-3460 etc.). Throws if the bare minimum isn't
 * present so the user gets a clear error rather than a degenerate solid.
 */
function resolveGearheadDims(
  req: CadGenerateRequest,
  core: MotorCoreDims,
  partLabel: string,
): GearheadDims {
  const G_LC = readNumber(req, 'G_LC') ?? core.LC;
  const G_LL = readNumber(req, 'G_LL') ?? 0;
  const G_S = readNumber(req, 'G_S') ?? core.S;
  if (G_LL <= 0 || G_S <= 0) {
    throw new Error(
      `${partLabel}: hasGearhead is set but required gearhead dims are missing — ` +
        `need G_LL (total assembly length) and G_S (output shaft dia). ` +
        `Got G_LL=${G_LL} G_S=${G_S}.`,
    );
  }
  if (G_LL <= core.L1) {
    throw new Error(
      `${partLabel}: gearhead total length G_LL=${G_LL} must exceed motor L1=${core.L1} ` +
        `— no axial room for the gearhead body.`,
    );
  }
  const gearheadOnlyLen = G_LL - core.L1;
  const G_LG = readNumber(req, 'G_LG') ?? gearheadOnlyLen * 0.4;
  const G_LA = readNumber(req, 'G_LA') ?? undefined;
  const G_LZ = readNumber(req, 'G_LZ') ?? undefined;
  const G_LB = readNumber(req, 'G_LB') ?? undefined;
  const G_LE = readNumber(req, 'G_LE') ?? undefined;
  const G_LD = readNumber(req, 'G_LD') ?? undefined;
  const G_L3 = readNumber(req, 'G_L3') ?? undefined;
  // G_L2: gearhead output shaft length. Falls back to motor's LR if absent.
  const G_L2 = readNumber(req, 'G_L2', 'G_LR') ?? core.LR;

  return {
    G_LC,
    G_LL,
    G_LG,
    G_LA: G_LA && G_LA > 0 ? G_LA : undefined,
    G_LZ: G_LZ && G_LZ > 0 ? G_LZ : undefined,
    G_LB: G_LB && G_LB > 0 ? G_LB : undefined,
    G_LE: G_LE && G_LE > 0 ? G_LE : undefined,
    G_LD: G_LD && G_LD > 0 ? G_LD : undefined,
    G_L3: G_L3 && G_L3 > 0 ? G_L3 : undefined,
    G_S,
    G_L2,
  };
}

/**
 * Parse the M_LZ field — the catalog string can be `"4-M5"`, `"M5"`,
 * `"M8x1.0"`, `"5"` (plain through-hole diameter), etc. Returns:
 *   - `{ kind: 'tap', M: nominal }` when the string starts with `M…`
 *   - `{ kind: 'through', dia: number }` when the string parses to a
 *     plain numeric diameter
 *   - `null` when the string is empty / unparseable
 *
 * The leading quantity prefix (`4-`, `8-`) is stripped first so callers
 * always see just the size token.
 */
export function parseMountingBolt(
  raw: string | undefined,
): { kind: 'tap'; M: number } | { kind: 'through'; dia: number } | null {
  if (!raw) return null;
  let s = raw.trim().toUpperCase();
  const dash = s.indexOf('-');
  if (dash >= 0) s = s.slice(dash + 1).trim();
  const tap = s.match(/^M\s*(\d+(?:\.\d+)?)/);
  if (tap) {
    const n = parseFloat(tap[1]);
    if (Number.isFinite(n) && n > 0) return { kind: 'tap', M: n };
  }
  const num = parseFloat(s);
  if (Number.isFinite(num) && num > 0) return { kind: 'through', dia: num };
  return null;
}
