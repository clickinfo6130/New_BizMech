/**
 * Head-variant registry — maps a `BoltHeadKind` enum to the head
 * module that knows how to draw it.
 *
 * Enum values match the C++ source's `BoltHeadType` (see
 * Source/NewCreateBoltClass.h). When porting a new variant, add:
 *
 *   1. A module under `parts/bolt/heads/<name>.ts` exporting `<NAME>_HEAD`.
 *   2. A new enum entry here.
 *   3. A row in HEAD_IMPL below.
 *   4. (Optional) A partCode → head-kind mapping in `parts/bolt/index.ts`.
 */
import type { BoltDims } from '../dimensions.js';
import type { StepBuilder } from '../../../core/step.js';
import type { DxfBuilder } from '../../../core/dxf.js';

import { HEX_HEAD } from './hex.js';
import { COUNTERSUNK_HEAD } from './countersunk.js';
import { CHEESE_HEAD } from './cheese.js';
import { SQUARE_HEAD } from './square.js';
import { PAN_HEAD } from './pan.js';
import { BUTTON_HEAD } from './button.js';
import { ROUND_HEAD } from './round.js';
import { HEX_FLANGE_HEAD } from './hex-flange.js';
import { SEMS_HEAD } from './sems.js';
import { SOCKET_HEAD } from './socket.js';

/**
 * Enum of every head variant the PartManager C++ source defines. Some
 * are implemented (see `HEAD_IMPL`), some will arrive in later phases
 * — attempting to generate one that isn't yet registered throws a
 * structured error that lists what IS available.
 */
export type BoltHeadKind =
  // Implemented — Phase 1.5
  | 'Hex'
  | 'HexFlange'
  | 'Socket'
  | 'Button'
  | 'Countersunk'
  | 'Pan'
  | 'Round'
  | 'Cheese'
  | 'Square'
  | 'Sems'
  // Pending — require custom shaft geometry (Phase 2+)
  | 'TSlot'
  | 'Eye'
  | 'Wing'
  | 'UBolt'
  | 'Stud'
  | 'Hinge'
  | 'Knock'
  | 'Shoulder'
  | 'Turnbuckle'
  | 'Anchor'
  | 'Foundation'
  | 'Piping';

export interface HeadImpl {
  stepFaces(b: StepBuilder, dims: BoltDims): string[];
  dxfProfile(b: DxfBuilder, dims: BoltDims): void;
}

export const HEAD_IMPL: Partial<Record<BoltHeadKind, HeadImpl>> = {
  Hex: HEX_HEAD,
  Countersunk: COUNTERSUNK_HEAD,
  Cheese: CHEESE_HEAD,
  Square: SQUARE_HEAD,
  Pan: PAN_HEAD,
  Button: BUTTON_HEAD,
  Round: ROUND_HEAD,
  HexFlange: HEX_FLANGE_HEAD,
  Sems: SEMS_HEAD,
  Socket: SOCKET_HEAD,
  // Not yet implemented — TSlot, Eye, Wing, UBolt, Stud, Hinge, Knock,
  // Shoulder, Turnbuckle, Anchor, Foundation, Piping — require custom
  // shaft geometry (e.g. Stud has no head; UBolt is a bent rod; TSlot
  // has a rectangular ledge head) and will be ported with their own
  // full dims specs, not just a new head module.
};

/** Resolve the head implementation for a kind; throws if unregistered. */
export function headImpl(kind: BoltHeadKind): HeadImpl {
  const impl = HEAD_IMPL[kind];
  if (!impl) {
    const available = Object.keys(HEAD_IMPL).join(', ');
    throw new Error(
      `Bolt head variant "${kind}" not implemented yet. ` +
        `Available variants: ${available}. Add a module under ` +
        `parts/bolt/heads/ and register it in heads/index.ts.`,
    );
  }
  return impl;
}

/** All currently implemented head variants — used by /diag/cad. */
export function listImplementedHeads(): BoltHeadKind[] {
  return Object.keys(HEAD_IMPL) as BoltHeadKind[];
}
