/**
 * linkedParts — TypeScript port of PartManager's DynamicUIManager
 * parse routines for the two special options:
 *
 *   · "연결부품명"    : pipe-separated list of linked part names
 *                      e.g. "축 그리기|오일 씰"  →  ["축 그리기", "오일 씰"]
 *
 *   · "영향받는 옵션" : @-separated pairs, each pipe-separated main|linked
 *                      e.g. "내경|축 지름@내경|내경"
 *                      →    [{main:"내경", linked:"축 지름"},
 *                            {main:"내경", linked:"내경"}]
 *
 * Options are detected by exact Korean label match — matches the C#
 * `IsLinkedPartNameOption` / `IsAffectedOptionOption` helpers in
 * PartSpecModels.cs.
 */
import type { LinkedPartInfo, LinkedPartPair, PartOption, PartSpec } from '@/types';

export const LINKED_PART_NAME_LABEL = '연결부품명';
export const AFFECTED_OPTION_LABEL = '영향받는 옵션';
export const RADIO_BUTTON_MARKER = '(라디오 버튼)';

/**
 * Port of `DynamicUIManager.StripOptionSuffix` (line 3662).
 * Removes the display-only suffixes `(라디오 버튼)` and `(전체동일)` from
 * an option name, used for stable matching and cleaner labels.
 */
export function stripOptionSuffix(name: string | undefined | null): string {
  if (!name) return '';
  return name
    .replace(/\s*\(\s*라디오\s*버튼\s*\)\s*/gi, '')
    .replace(/\s*\(\s*전체동일\s*\)\s*/gi, '')
    .trim();
}

/**
 * Returns the paired main-option name for a given linked option, or null
 * if the option isn't driven by the main part.
 *
 * C# reference: `OnLinkedControlSelectionChanged` (line 1343) — if an
 * option's base name equals any `pair.linked`, the user's change is
 * blocked and the value is immediately synced from the main part.
 */
export function getLinkedOptionLockSource(
  option: PartOption,
  pairs: LinkedPartPair[],
): string | null {
  const base = stripOptionSuffix(option.name).toLowerCase();
  if (!base) return null;
  for (const p of pairs) {
    if (stripOptionSuffix(p.linked).toLowerCase() === base) {
      return p.main;
    }
  }
  return null;
}

/**
 * Pick the AffectedPairs that belong to a specific linked part.
 *
 * In the spec JSON, `영향받는 옵션` stores all pairs in a flat array but
 * the position of each pair matches the position of the linked-part name
 * in `연결부품명`. For example:
 *
 *   연결부품명    : "축 그리기|오일 씰"         → names[0]=축그리기, names[1]=오일씰
 *   영향받는 옵션 : "내경|축 지름@내경|내경"    → pairs[0]=(내경,축지름), pairs[1]=(내경,내경)
 *
 * So `축 그리기` should receive ONLY `pairs[0]`, and `오일 씰` should receive
 * ONLY `pairs[1]`. The global "apply all pairs to all linked parts" approach
 * is a bug because it cross-contaminates the lock/sync logic.
 *
 * Degenerate cases we tolerate:
 *   · pairs.length === names.length        → strict positional 1:1 (primary case)
 *   · pairs.length === 1, names.length > 1 → replicate single pair to all names
 *   · pairs.length !== names.length        → return pairs[idx] if it exists
 *
 * Port of the behaviour around `SwitchLinkedPartToAbsIndex` /
 * `_linkedPartInfo.ActiveIndex` in DynamicUIManager.cs.
 */
export function getPairsForLinkedName(
  info: LinkedPartInfo,
  linkedName: string,
): LinkedPartPair[] {
  const idx = info.names.indexOf(linkedName);
  if (idx < 0) return [];
  const n = info.names.length;
  const p = info.pairs.length;
  if (p === n) return [info.pairs[idx]];
  if (p === 1 && n > 1) return info.pairs.slice();
  return info.pairs[idx] ? [info.pairs[idx]] : [];
}

export function isLinkedPartNameOption(o: PartOption): boolean {
  return o.name?.trim() === LINKED_PART_NAME_LABEL;
}

export function isAffectedOptionOption(o: PartOption): boolean {
  return o.name?.trim() === AFFECTED_OPTION_LABEL;
}

export function isRadioButtonOption(o: PartOption): boolean {
  return !!o.name && o.name.includes(RADIO_BUTTON_MARKER);
}

/** Return true when this option is a UI-hidden metadata option. */
export function isMetaOption(o: PartOption): boolean {
  return isLinkedPartNameOption(o) || isAffectedOptionOption(o);
}

/**
 * Extract LinkedPartInfo from a spec by finding the two special options.
 * Returns `null` when the spec has no linked parts at all.
 */
export function parseLinkedPartInfo(spec: PartSpec | null): LinkedPartInfo | null {
  if (!spec) return null;
  const series = spec.series[0];
  if (!series) return null;

  const names = new Set<string>();
  const pairs: LinkedPartPair[] = [];

  for (const opt of series.options) {
    if (isLinkedPartNameOption(opt)) {
      // Parse every value's name to collect all possible linked part names.
      // In PartManager the current value is used, but we collect all to
      // be resilient to user toggles.
      for (const v of opt.values) {
        const raw = (v.name ?? '').trim();
        if (!raw) continue;
        raw.split('|').forEach((n) => {
          const s = n.trim();
          if (s) names.add(s);
        });
      }
    }

    if (isAffectedOptionOption(opt)) {
      for (const v of opt.values) {
        const raw = (v.name ?? '').trim();
        if (!raw) continue;
        for (const chunk of raw.split('@')) {
          const parts = chunk.trim().split('|');
          if (parts.length >= 2) {
            pairs.push({ main: parts[0].trim(), linked: parts[1].trim() });
          }
        }
      }
    }
  }

  if (!names.size && !pairs.length) return null;

  return {
    names: Array.from(names),
    pairs,
  };
}
