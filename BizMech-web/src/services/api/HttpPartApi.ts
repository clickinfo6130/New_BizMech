/**
 * HttpPartApi — Java backend (REST) implementation stub.
 *
 * Wire this up once the Java backend is deployed. Endpoint paths below are
 * proposed contracts — adjust to whatever the backend team commits to.
 * All response shapes MUST match @/types.
 */
import axios, { AxiosInstance } from 'axios';

import type { IPartApi } from './IPartApi';
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
  PartType,
  SubCategory,
} from '@/types';

/** Read the token that zustand's `persist('bizmech.auth')` put in localStorage. */
function readPersistedToken(): string | null {
  try {
    const raw = localStorage.getItem('bizmech.auth');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { state?: { token?: string } };
    return parsed?.state?.token ?? null;
  } catch {
    return null;
  }
}

export class HttpPartApi implements IPartApi {
  private http: AxiosInstance;

  constructor(baseURL: string) {
    this.http = axios.create({
      baseURL,
      timeout: 15000,
    });
    // ★ The bearer token is persisted by the zustand auth store via its
    //   `persist` middleware under the key `bizmech.auth` as a JSON blob
    //   shaped like `{"state":{"token":"...","user":{...}},"version":0}`.
    //   We MUST parse that structure here — reading a plain
    //   `localStorage.getItem('bizmech.token')` would always return null
    //   and every authenticated request would fire anonymously.
    this.http.interceptors.request.use((cfg) => {
      const token = readPersistedToken();
      if (token && cfg.headers) cfg.headers.Authorization = `Bearer ${token}`;
      return cfg;
    });
  }

  // ── Auth ─────────────────────────────────────────────
  async login(req: LoginRequest): Promise<LoginResult> {
    const { data } = await this.http.post<LoginResult>('/auth/login', req);
    return data;
  }
  async me(): Promise<AuthUser | null> {
    try {
      const { data } = await this.http.get<AuthUser>('/auth/me');
      return data;
    } catch {
      return null;
    }
  }
  async logout(): Promise<void> {
    await this.http.post('/auth/logout').catch(() => undefined);
  }

  // ── Category hierarchy ──────────────────────────────
  async getMainCategories(): Promise<MainCategory[]> {
    const { data } = await this.http.get<MainCategory[]>('/categories/main');
    return data;
  }
  async getSubCategories(mainCatCode: string): Promise<SubCategory[]> {
    const { data } = await this.http.get<SubCategory[]>(`/categories/sub`, {
      params: { mainCatCode },
    });
    return data;
  }
  async getMidCategories(subCatCode: string): Promise<MidCategory[]> {
    const { data } = await this.http.get<MidCategory[]>(`/categories/mid`, {
      params: { subCatCode },
    });
    return data;
  }
  async getPartTypes(midCatCode: string): Promise<PartType[]> {
    const { data } = await this.http.get<PartType[]>(`/parttypes`, {
      params: { midCatCode },
    });
    return data;
  }

  async getMotorPartsBySub(subCatCode: string): Promise<PartType[]> {
    const { data } = await this.http.get<PartType[]>(`/motor/parts`, {
      params: { subCatCode },
    });
    return data;
  }

  // ── Spec / dimension ────────────────────────────────
  async getPartSpec(partCode: string): Promise<PartSpec | null> {
    const { data } = await this.http.get<PartSpec>(`/parts/${partCode}/spec`);
    return data;
  }
  async findPartSpecByNameOrCode(nameOrCode: string): Promise<PartSpec | null> {
    const { data } = await this.http.get<PartSpec | null>(`/parts/find`, {
      params: { q: nameOrCode },
    });
    return data;
  }
  async getDimensionMeta(partCode: string): Promise<DimensionMeta[]> {
    const { data } = await this.http.get<DimensionMeta[]>(`/parts/${partCode}/dimension-meta`);
    return data;
  }
  async getDimensionKeyOptions(partCode: string): Promise<DimensionKeyOption[]> {
    const { data } = await this.http.get<DimensionKeyOption[]>(
      `/parts/${partCode}/dimension-keys`,
    );
    return data;
  }
  async findDimension(
    partCode: string,
    keyValues: Record<string, string>,
  ): Promise<PartDimension | null> {
    const { data } = await this.http.post<PartDimension | null>(
      `/parts/${partCode}/dimension/find`,
      { keyValues },
    );
    return data;
  }
  async searchByOrderCode(orderCode: string) {
    const { data } = await this.http.get(`/search`, { params: { orderCode } });
    return data as {
      spec: PartSpec;
      dimension: PartDimension;
      meta: DimensionMeta[];
    } | null;
  }

  // ── Download ────────────────────────────────────────
  async download(req: DownloadRequest): Promise<DownloadResult> {
    // Explicitly forward extraDimensions — axios drops undefined props so
    // passing the request as-is is safe, but keep it readable.
    const { data } = await this.http.post<DownloadResult>('/download', {
      partCode: req.partCode,
      keyComposite: req.keyComposite,
      format: req.format,
      locale: req.locale,
      extraDimensions: req.extraDimensions,
    });
    return data;
  }
}
