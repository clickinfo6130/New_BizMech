/**
 * Motor family — single entry point for every motor partCode the proxy
 * supports. Currently scoped to SGM-7 (Yaskawa Sigma-7 servo). Other
 * motor types (Stepper / BLDC / DD / Linear / Spindle / Fan / etc.)
 * remain unimplemented in C++ per the user's note ("아직 c++ 프로그램이
 * 마무리가 되지 않았기에"); when those finish, add their generators in
 * sibling files and register the partCodes in `KIND_OF_CODE` below.
 *
 * Architecture mirrors the bearing family:
 *   · One `BearingKind`-equivalent enum (`MotorKind`) maps each
 *     partCode to a generator.
 *   · `generateMotor` is the registered family entry point.
 *   · OCCT backend is the only path supported (no hand-written
 *     fallback yet — motor geometry is too varied to ship a sensible
 *     degraded version).
 */
import type { CadGenerateRequest, CadGenerateResult } from '../../types.js';
import { LOCAL_FORMATS } from '../../types.js';
import { registerFamily } from '../registry.js';
import { resolveBomMetadata } from '../../core/bom-meta.js';
import { embedBomInStep } from '../../core/step-bom.js';
import { resetOcct } from '../../core/occt.js';
import { resolveMotorDims } from './dimensions.js';
import { buildSgm7StepViaOcct } from './step-occt-sgm7.js';

const USE_OCCT = (process.env.CAD_BACKEND ?? 'hand').toLowerCase() === 'occt';

type MotorKind = 'Sgm7';

const KIND_OF_CODE: Record<string, MotorKind> = {
  // SGM-7 — Yaskawa Sigma-7 servo motor (square frame). Only motor
  // currently supported; other motor types stay deferred until C++ work
  // wraps for them.
  'SGM-7': 'Sgm7',
  SGM7: 'Sgm7',
};

const MOTOR_CODES = Object.keys(KIND_OF_CODE);

function applyBom(req: CadGenerateRequest, result: CadGenerateResult): CadGenerateResult {
  if (result.format !== 'STEP') return result;
  const bom = resolveBomMetadata(req);
  const text = result.bytes.toString('utf8');
  const next = embedBomInStep(text, bom);
  if (next === text) return result;
  return { ...result, bytes: Buffer.from(next, 'utf8') };
}

export async function generateMotor(
  req: CadGenerateRequest,
): Promise<CadGenerateResult> {
  if (!(LOCAL_FORMATS as readonly string[]).includes(req.format)) {
    throw new Error(
      `Motor: format ${req.format} is not produced locally; route through CAD Exchanger.`,
    );
  }

  const code = req.partCode.toUpperCase();
  const kind = KIND_OF_CODE[code];
  if (!kind) {
    throw new Error(
      `Motor: partCode "${req.partCode}" not mapped to a motor kind. ` +
        `Edit parts/motor/index.ts KIND_OF_CODE to register it. ` +
        `Currently supported: ${MOTOR_CODES.join(', ')}.`,
    );
  }

  if (req.format !== 'STEP') {
    throw new Error(
      `Motor: format ${req.format} not yet implemented (STEP only). ` +
        `partCode=${req.partCode}`,
    );
  }
  if (!USE_OCCT) {
    throw new Error(
      `Motor: hand-written fallback not implemented; OCCT backend required. ` +
        `Set CAD_BACKEND=occt.`,
    );
  }

  const dims = resolveMotorDims(req, req.partCode);

  try {
    const result =
      kind === 'Sgm7'
        ? await buildSgm7StepViaOcct(req, dims)
        : (() => {
            throw new Error(
              `Motor: kind "${kind}" recognised but no generator wired up.`,
            );
          })();
    return applyBom(req, result);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(
      `[motor/occt] ${req.partCode} (${kind}) failed: ${(e as Error).message}. ` +
        `Resetting OCCT runtime.`,
    );
    resetOcct();
    throw e;
  }
}

registerFamily({
  name: 'motor',
  codes: MOTOR_CODES,
  generate: generateMotor,
});
