/**
 * CAD worker — thin dispatcher over the parts registry.
 *
 * The actual generator modules live under `parts/*`. Each family's
 * `index.ts` calls `registerFamily(...)` at import time, and this
 * file just finds the right family for a partCode and invokes it.
 *
 * If a family isn't found, we throw `UnsupportedPartError` with the
 * list of currently-registered codes — easy to read on the /diag/cad
 * endpoint or in a crash log.
 */

import type { CadGenerateRequest, CadGenerateResult } from './types.js';
import { LOCAL_FORMATS } from './types.js';
import { findFamily, listSupportedCodes } from './parts/registry.js';
// Side-effect import — loads every parts/* family and calls
// registerFamily(...) at module init time. Keeping this import here
// (not in registry.ts) avoids a circular init order where a family's
// registerFamily call would run before registry's own module-level
// state was constructed. Do not remove.
import './parts/index.js';

export class UnsupportedPartError extends Error {
  constructor(partCode: string, supported: string[]) {
    super(
      `No generator registered for partCode="${partCode}". ` +
        `Registered families cover: ${supported.join(', ') || '(none)'}. ` +
        `Add a parts/* module or extend an existing family's codes list.`,
    );
    this.name = 'UnsupportedPartError';
  }
}

export class UnsupportedLocalFormatError extends Error {
  constructor(format: string) {
    super(
      `Format ${format} is not produced locally. Supported local formats: ${LOCAL_FORMATS.join(
        ', ',
      )}.`,
    );
    this.name = 'UnsupportedLocalFormatError';
  }
}

export async function generateLocal(req: CadGenerateRequest): Promise<CadGenerateResult> {
  if (!(LOCAL_FORMATS as readonly string[]).includes(req.format)) {
    throw new UnsupportedLocalFormatError(req.format);
  }
  const family = findFamily(req.partCode);
  if (!family) {
    throw new UnsupportedPartError(req.partCode, listSupportedCodes());
  }
  // `await` works on both sync and async returns (Promise<T> or T).
  return await family.generate(req);
}

export function supportedParts(): string[] {
  return listSupportedCodes();
}
