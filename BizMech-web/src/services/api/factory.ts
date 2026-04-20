/**
 * Single factory that yields the IPartApi implementation for this build.
 * Controlled by VITE_API_MODE ('mock' | 'http'). Default = 'mock'.
 */
import type { IPartApi } from './IPartApi';
import { MockPartApi } from './MockPartApi';
import { HttpPartApi } from './HttpPartApi';

const mode = (import.meta.env.VITE_API_MODE ?? 'mock').toString().toLowerCase();
const baseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').toString();

let instance: IPartApi | null = null;

export function getPartApi(): IPartApi {
  if (instance) return instance;
  if (mode === 'http' && baseUrl) {
    instance = new HttpPartApi(baseUrl);
  } else {
    instance = new MockPartApi();
  }
  return instance;
}

/** For tests only — replace the global singleton. */
export function __setPartApi(api: IPartApi) {
  instance = api;
}
