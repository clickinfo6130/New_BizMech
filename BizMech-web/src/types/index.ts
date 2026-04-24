/**
 * BizMech shared domain types.
 * These mirror the schema of Standard_Core.db / Motor_Core.db so that
 * the Java backend can implement IPartApi and return the same shapes.
 */

export type Locale = 'ko' | 'en' | 'ja' | 'zh';

// ─────────────────────────────────────────────────────────
// Category hierarchy: main → sub → mid → partType
// ─────────────────────────────────────────────────────────

export interface MainCategory {
  code: string;
  name: string;
  nameKr: string;
  isStandard: boolean;
  colorCode?: string | null;
  sortOrder: number;
  dbFileName: string; // 'standard_core.db' | 'motor_core.db'
}

export interface SubCategory {
  code: string;
  name: string;
  nameKr: string;
  mainCatCode: string;
  isVendor: boolean;
  sortOrder: number;
}

export interface MidCategory {
  code: string;
  name: string;
  nameKr: string;
  subCatCode: string;
  sortOrder: number;
}

export interface PartType {
  code: string;
  name: string;
  nameKr: string;
  midCatCode: string;
  cmdCode?: string | null;
  hasSeries: boolean;
  sortOrder: number;
}

// ─────────────────────────────────────────────────────────
// Spec — dynamic form definition (partspec.spec_data JSON)
// ─────────────────────────────────────────────────────────

export interface PartSpec {
  id: number;
  partType: string;
  partCode: string;
  partName: string;
  series: PartSeriesSpec[];
}

export interface PartSeriesSpec {
  id: number;
  name: string;
  cmd: string;
  options: PartOption[];
}

export interface PartOption {
  id: number;
  name: string;
  defaultValue: string;
  isActive: boolean;
  /** Raw `type` field from the spec JSON (COMBOBOX | RADIO | EDITBOX …) */
  type?: string;
  values: PartOptionValue[];
}

export interface PartOptionValue {
  enumid: number | string;
  name: string;
  desc?: string;
  /** Parent option IDs this value depends on (see utils/specFilter.ts). */
  filter?: string[] | string;
  /** Allowed combinations of parent enum IDs. */
  filter_Values?: string[][] | unknown;
}

// ─────────────────────────────────────────────────────────
// Linked parts — parsed from the `연결부품명` / `영향받는 옵션`
// special options in a spec, used to drive the 2D/3D viewer.
// ─────────────────────────────────────────────────────────

export interface LinkedPartPair {
  /** Option name on the main part, e.g. "내경". */
  main: string;
  /** Option name on the linked part, e.g. "축 지름". */
  linked: string;
}

export interface LinkedPartInfo {
  /** Raw names from `연결부품명`, e.g. ["축 그리기", "오일 씰"]. */
  names: string[];
  /** Affected-option pairs parsed from `영향받는 옵션`. */
  pairs: LinkedPartPair[];
}

// ─────────────────────────────────────────────────────────
// Dimension — concrete part row
// ─────────────────────────────────────────────────────────

export interface DimensionMeta {
  partCode: string;
  fieldName: string;
  displayName: string;
  displayNameEn?: string;
  dataType: string; // TEXT | DECIMAL | INTEGER
  unit?: string;
  isKeyField: boolean;
  displayOrder: number;
}

export interface DimensionKeyOption {
  partCode: string;
  keyFieldName: string;
  keyLevel: number;
  keyValue: string;
  parentKey?: string | null;
}

export interface PartDimension {
  id: number;
  partCode: string;
  keyComposite: string; // e.g. "HBOLT|KS B 1002|M10"
  keyValues: Record<string, string>;
  dimensionData: Record<string, number | string>;
}

// ─────────────────────────────────────────────────────────
// Order code — user-facing selection representation
// ─────────────────────────────────────────────────────────

export interface OrderCode {
  /** canonical string: partCode + '|' + key1 + '|' + key2 ... */
  value: string;
  partCode: string;
  keyValues: Record<string, string>;
}

// ─────────────────────────────────────────────────────────
// Download
// ─────────────────────────────────────────────────────────

export type DownloadFormat = 'STEP' | 'DXF' | 'DWG' | 'IGES' | 'STL' | 'IPT' | 'SLDPRT' | 'Z3';

/** Whether a format is generated locally (OCCT/DXF writer) or needs the CAD Exchanger API. */
export type DownloadBackend = 'local' | 'exchanger';

export interface DownloadRequest {
  partCode: string;
  keyComposite: string;
  format: DownloadFormat;
  locale?: Locale;
  /**
   * User-selected dimension overrides — values the user typed into
   * EDITBOX / LISTBOX controls that aren't stored in the DB row. Keyed
   * by the option's raw name (e.g. "전체길이", "L", "유효길이"). The
   * proxy merges these on top of the DB-derived dimensions before the
   * generator resolves aliases, so a user-changed length yields a file
   * with the new length.
   */
  extraDimensions?: Record<string, number | string>;
}

export interface DownloadResult {
  fileName: string;
  mimeType: string;
  /** URL the browser fetches — proxy-served hash URL or data-URL. */
  url: string;
  /** Stable cache hash — same selection + format returns the same hash. */
  hash?: string;
  /** File size in bytes (compressed / wire size for the returned URL). */
  sizeBytes?: number;
  /** Whether the cache served this request (true = milliseconds, false = generated). */
  fromCache?: boolean;
  /** Generation time on the server in milliseconds (only meaningful when fromCache=false). */
  generatedMs?: number;
  /** Which backend produced the file (OCCT/DXF writer vs CAD Exchanger). */
  backend?: DownloadBackend;
}

// ─────────────────────────────────────────────────────────
// Auth
// ─────────────────────────────────────────────────────────

export interface AuthUser {
  id: string;
  name: string;
  email?: string;
  roles: string[];
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResult {
  token: string;
  user: AuthUser;
}
