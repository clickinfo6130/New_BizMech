/**
 * CAD Exchanger adapter — Phase 2 placeholder.
 *
 * The production implementation sends our generated STEP bytes to the
 * Cad Exchanger Cloud API (https://cadexchanger.com/products/cloud/)
 * and receives the requested native format back (DWG, IPT, SLDPRT, Z3).
 *
 * For Phase 1 we keep the function signature in place so the orchestrator
 * (download.ts) can route correctly; calls into Phase-2-only formats
 * return a structured "not-configured" error that the frontend surfaces
 * as "준비 중" rather than a 500. This keeps the UI honest without
 * requiring an API key during MVP.
 */
import type { CadFormat, CadGenerateResult } from '../types.js';
import { FORMAT_EXT, FORMAT_MIME } from '../types.js';

export interface ExchangerConvertRequest {
  stepBytes: Buffer;
  targetFormat: CadFormat;
  /** Echoed into the file name. */
  partCode: string;
  /** Echoed into the file name. */
  keyComposite: string;
}

export interface ExchangerError {
  ok: false;
  code: 'not_configured' | 'http_error' | 'unsupported_format' | 'transport';
  message: string;
  /** When we'll support this — for UI hinting. */
  phase?: 'phase2' | 'future';
}

export type ExchangerResult =
  | { ok: true; result: CadGenerateResult }
  | ExchangerError;

function apiKey(): string | null {
  const k = process.env.CAD_EXCHANGER_API_KEY?.trim();
  return k && k.length > 0 ? k : null;
}

export function isExchangerConfigured(): boolean {
  return apiKey() !== null;
}

/**
 * Convert a STEP file to the target native format via CAD Exchanger.
 * Not implemented in Phase 1 — returns a structured not-configured error
 * if no API key is present.
 */
export async function convert(req: ExchangerConvertRequest): Promise<ExchangerResult> {
  if (!isExchangerConfigured()) {
    return {
      ok: false,
      code: 'not_configured',
      message:
        `${req.targetFormat} 변환은 CAD Exchanger API 연동이 필요합니다. ` +
        `환경변수 CAD_EXCHANGER_API_KEY 가 설정되지 않아 Phase 2 에서 활성화됩니다.`,
      phase: 'phase2',
    };
  }
  // Phase 2 implementation goes here:
  //   const res = await fetch('https://cloud.cadexchanger.com/v1/convert', { ... });
  //   return { ok: true, result: { bytes: Buffer.from(await res.arrayBuffer()), ... } };
  void req; // avoid unused-param warning until implementation lands
  void FORMAT_EXT;
  void FORMAT_MIME;
  return {
    ok: false,
    code: 'not_configured',
    message: 'CAD Exchanger integration not yet implemented.',
    phase: 'phase2',
  };
}
