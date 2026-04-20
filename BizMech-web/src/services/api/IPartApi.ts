/**
 * IPartApi — data-access contract.
 *
 * ★ This interface is the single point of contact between the React app and
 *   any data source. Swap implementations via `@/services/api/factory.ts`.
 *
 * Implementations:
 *   - MockPartApi  : reads /public/data/*.db with sql.js (dev/offline)
 *   - HttpPartApi  : Axios → Java backend REST (production)
 *
 * When the Java backend is ready, it MUST expose endpoints whose response
 * shapes match the return types below.
 */
import type {
  AuthUser,
  DownloadRequest,
  DownloadResult,
  LoginRequest,
  LoginResult,
  MainCategory,
  MidCategory,
  OrderCode,
  PartDimension,
  PartSpec,
  PartType,
  SubCategory,
  DimensionMeta,
  DimensionKeyOption,
} from '@/types';

export interface IPartApi {
  // ── Auth ─────────────────────────────────────────────
  login(req: LoginRequest): Promise<LoginResult>;
  me(token: string): Promise<AuthUser | null>;
  logout(token: string): Promise<void>;

  // ── Category hierarchy ──────────────────────────────
  getMainCategories(): Promise<MainCategory[]>;
  getSubCategories(mainCatCode: string): Promise<SubCategory[]>;
  getMidCategories(subCatCode: string): Promise<MidCategory[]>;
  getPartTypes(midCatCode: string): Promise<PartType[]>;

  /**
   * Motor parts don't have a `parttype` row; they are defined directly as
   * `partspec` rows in Motor_Core.db keyed by `part_type` = 'Servo' | 'BLDC' |
   * 'Stepper' | 'Geard'. The category tree therefore skips the mid level
   * for the MOTOR branch and calls this method to populate a SubCategory's
   * leaves directly. Returns PartType-shaped rows so the UI can treat them
   * uniformly with standard part types.
   */
  getMotorPartsBySub(subCatCode: string): Promise<PartType[]>;

  // ── Spec / dimension ────────────────────────────────
  getPartSpec(partCode: string): Promise<PartSpec | null>;
  getDimensionMeta(partCode: string): Promise<DimensionMeta[]>;
  getDimensionKeyOptions(partCode: string): Promise<DimensionKeyOption[]>;

  /**
   * Resolve a linked part by its display name OR part code. Used when
   * parsing the "연결부품명" option — the string in there is the
   * free-form label a data author entered (e.g. "축 그리기" / "오일 씰").
   * Falls back to a partCode lookup.
   */
  findPartSpecByNameOrCode(nameOrCode: string): Promise<PartSpec | null>;

  /**
   * Look up a single dimension row given a (partCode, keyValues) selection.
   * Used both by normal selection flow and by order-code search.
   */
  findDimension(
    partCode: string,
    keyValues: Record<string, string>,
  ): Promise<PartDimension | null>;

  /** Order-code search. Expects "PARTCODE|K1|K2..." */
  searchByOrderCode(orderCode: string): Promise<{
    spec: PartSpec;
    dimension: PartDimension;
    meta: DimensionMeta[];
  } | null>;

  // ── Download ────────────────────────────────────────
  download(req: DownloadRequest): Promise<DownloadResult>;
}

export function buildOrderCode(
  partCode: string,
  keyValues: Record<string, string>,
): OrderCode {
  const keys = Object.keys(keyValues).sort();
  const parts = keys.map((k) => keyValues[k]);
  return {
    value: [partCode, ...parts].join('|'),
    partCode,
    keyValues,
  };
}

export function parseOrderCode(value: string): { partCode: string; rest: string[] } {
  const [partCode, ...rest] = value.split('|');
  return { partCode, rest };
}
