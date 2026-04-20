/**
 * specFilter — 1:1 TypeScript port of
 * `PartManager.Services.JsonParserService.GetFilteredValues` (C# / WPF).
 *
 * Each OptionValue carries two parallel arrays:
 *   - `filter`         : parent option IDs whose selection constrains this value
 *   - `filter_Values`  : one or more acceptable combinations of parent enum IDs
 *
 * Special sentinels:
 *   - "-1" anywhere in either array means wildcard / unconstrained.
 *   - filter[0] is treated as the "radio" position — it must match exactly
 *     (matches the C# implementation note "filter_values의 첫 번째 위치
 *      (라디오 enumId)가 현재 라디오 선택값과 일치해야 유효").
 *
 * The `selectedPath` map is `optionId → selectedEnumId`, driven by the
 * DynamicSpecForm when the user changes any dropdown / radio.
 */
import type { PartOption, PartOptionValue } from '@/types';
import { determineControlType } from '@/utils/controlType';

/** selectedPath: optionId → currently selected enumid. */
export type SelectedPath = Record<number, number>;

/**
 * Return the values of `option` that are currently visible given the
 * user's `selectedPath`. Mirrors GetFilteredValues in JsonParserService.cs.
 */
export function getFilteredValues(
  option: PartOption,
  selectedPath: SelectedPath,
): PartOptionValue[] {
  if (!option?.values?.length) return [];

  // No parent selections yet → show everything (match C# behaviour).
  if (!selectedPath || Object.keys(selectedPath).length === 0) {
    return option.values.slice();
  }

  const out: PartOptionValue[] = [];
  for (const value of option.values) {
    const filter = toStringArray(value.filter);
    const filterValues = toNestedArray(value.filter_Values);

    // No filter constraint at all → always visible.
    if (!filter.length || !filterValues.length) {
      out.push(value);
      continue;
    }

    // Single wildcard.
    if (filter.length === 1 && filter[0] === '-1') {
      out.push(value);
      continue;
    }

    // Resolve the current selection for each parent option ID in `filter`.
    const currentSelection: string[] = filter.map((filterOptId) => {
      if (filterOptId === '-1') return '-1';
      const optId = Number(filterOptId);
      if (!Number.isNaN(optId) && selectedPath[optId] != null) {
        return String(selectedPath[optId]);
      }
      return '-1';
    });

    // Compare against each allowed combination.
    let matched = false;
    for (const combo of filterValues) {
      if (!combo || combo.length === 0) continue;

      // Single wildcard combination → always passes.
      if (combo.length === 1 && combo[0] === '-1') {
        matched = true;
        break;
      }

      // Case 1: same length — positional combination match.
      if (filter.length === combo.length) {
        // ★ Radio (position 0) must match exactly unless the combo wildcards it.
        const radioRequired = combo[0];
        const radioCurrent = currentSelection[0] ?? '-1';
        const radioOk =
          radioRequired === '-1' ||
          (radioCurrent !== '-1' && radioCurrent !== '' && radioRequired === radioCurrent);
        if (!radioOk) continue;

        if (matchesCombination(combo, currentSelection)) {
          matched = true;
          break;
        }
      }
      // Case 2: single-parent filter, combination is a whitelist of values.
      else if (filter.length === 1 && currentSelection.length === 1) {
        if (combo.includes(currentSelection[0])) {
          matched = true;
          break;
        }
      }
    }

    if (matched) out.push(value);
  }

  return out;
}

/**
 * Port of PartManager.UI.DynamicUIManager.UpdateAllControlEnableStates
 * (line 4375) — an option is hidden when:
 *
 *   1. option.isActive === false (honored by BuildUI),
 *   2. OR the control has enumerated choices (COMBOBOX / LISTBOX / RADIO)
 *      AND `FilterOutExcludeValues(GetFilteredValues(opt, selectedPath))`
 *      is empty. This covers both "series doesn't use this option"
 *      (empty values[] in the JSON) and "parent selection eliminates
 *      every value".
 *
 * EDITBOX / R_EDITBOX / CHECKBOX are free-form — their values[] is
 * intentionally empty and they must stay visible (matches PartManager:
 * those are never fed through UpdateAllControlEnableStates' gate).
 */
export function isOptionVisible(option: PartOption, selectedPath: SelectedPath): boolean {
  if (!option.isActive) return false;
  const kind = determineControlType(option.type);
  if (kind === 'EDITBOX' || kind === 'R_EDITBOX' || kind === 'CHECKBOX') {
    return true;
  }
  return filterExcludeValues(getFilteredValues(option, selectedPath)).length > 0;
}

/**
 * Port of `FilterOutExcludeValues` in DynamicUIManager.cs — strips
 * placeholder rows whose `name` is literally "X" (case-insensitive).
 * PartManager uses these as "excluded from UI" markers.
 */
export function filterExcludeValues(values: PartOptionValue[]): PartOptionValue[] {
  if (!values) return [];
  return values.filter((v) => {
    const n = (v.name ?? '').trim().toUpperCase();
    return n !== 'X';
  });
}

// ─────────────────────────────────────────────────────────
// helpers — tolerate the multiple shapes the JSON arrives in
// ─────────────────────────────────────────────────────────

function toStringArray(src: unknown): string[] {
  if (!src) return [];
  if (Array.isArray(src)) return src.map(String);
  if (typeof src === 'string') {
    // Some rows use a comma-separated string like "1,2".
    return src
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [String(src)];
}

function toNestedArray(src: unknown): string[][] {
  if (!src) return [];
  if (Array.isArray(src)) {
    return src.map((row) => toStringArray(row));
  }
  return [];
}

function matchesCombination(combo: string[], current: string[]): boolean {
  if (combo.length !== current.length) return false;
  for (let i = 0; i < combo.length; i++) {
    const fv = combo[i];
    const cv = current[i];
    // Wildcard on the filter side — any value passes.
    if (fv === '-1') continue;
    // Wildcard on the current side means "not yet selected" — fail.
    if (cv === '-1') return false;
    if (fv !== cv) return false;
  }
  return true;
}
