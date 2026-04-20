/**
 * selectionStore — the single source of truth for the currently selected
 * category path, part, spec options and dimension key values.
 *
 * Downstream consumers:
 *   - CategorySidebar writes categoryPath, partCode
 *   - DynamicSpecForm writes options, auto-resolves dimension via key fields
 *   - SpecTabs toggles linkedDrawEnabled + activeSpecTab
 *   - PreviewPanel reads partCode + dimension
 *   - PreviewFrame reads linkedInfo + linkedDrawEnabled to feed the iframe
 *   - DownloadBar reads partCode + keyComposite
 */
import { create } from 'zustand';

import type {
  DimensionMeta,
  LinkedPartInfo,
  PartDimension,
  PartSpec,
} from '@/types';

export interface CategoryPath {
  main?: string;
  sub?: string;
  mid?: string;
}

interface SelectionState {
  categoryPath: CategoryPath;
  partCode: string | null;
  spec: PartSpec | null;
  meta: DimensionMeta[];
  /** User-chosen spec option values: optionId → enum/name */
  specOptions: Record<number, string>;
  /** User-chosen dimension key values: keyFieldName → keyValue */
  keyValues: Record<string, string>;
  /** Resolved dimension row (after findDimension) */
  dimension: PartDimension | null;
  /** Parsed from the special "연결부품명" / "영향받는 옵션" options. */
  linkedInfo: LinkedPartInfo | null;
  /** Per-linked-part "작도" (draw / include in CAD output) toggle. Defaults to false. */
  linkedDrawEnabled: Record<string, boolean>;
  /** Active spec-form tab: 'main' or a linked-part name. */
  activeSpecTab: string;
  /** Cached full PartSpec for each linked part name (pre-fetched). */
  linkedSpecs: Record<string, PartSpec>;
  /**
   * Per-linked-part option selection, `{ [linkedPartName]: { [optionId]: enumIdStr } }`.
   * The DynamicSpecForm's sync effect propagates main→linked values via
   * AffectedPairs, and the user can override them in the linked tab.
   */
  linkedOptions: Record<string, Record<number, string>>;

  setMain(code?: string): void;
  setSub(code?: string): void;
  setMid(code?: string): void;
  setPart(partCode: string | null): void;
  setSpec(spec: PartSpec | null, meta: DimensionMeta[]): void;
  setSpecOption(optionId: number, value: string): void;
  setKeyValue(field: string, value: string): void;
  setDimension(dim: PartDimension | null): void;
  setLinkedInfo(info: LinkedPartInfo | null): void;
  setLinkedDrawEnabled(name: string, enabled: boolean): void;
  setActiveSpecTab(tab: string): void;
  setLinkedSpec(name: string, spec: PartSpec): void;
  setLinkedOption(name: string, optionId: number, value: string): void;
  resetPart(): void;
}

export const useSelectionStore = create<SelectionState>((set) => ({
  categoryPath: {},
  partCode: null,
  spec: null,
  meta: [],
  specOptions: {},
  keyValues: {},
  dimension: null,
  linkedInfo: null,
  linkedDrawEnabled: {},
  activeSpecTab: 'main',
  linkedSpecs: {},
  linkedOptions: {},

  setMain: (code) =>
    set({
      categoryPath: { main: code },
      partCode: null,
      spec: null,
      keyValues: {},
      dimension: null,
      linkedInfo: null,
    }),
  setSub: (code) =>
    set((s) => ({
      categoryPath: { ...s.categoryPath, sub: code, mid: undefined },
      partCode: null,
      spec: null,
      keyValues: {},
      dimension: null,
      linkedInfo: null,
    })),
  setMid: (code) =>
    set((s) => ({
      categoryPath: { ...s.categoryPath, mid: code },
      partCode: null,
      spec: null,
      keyValues: {},
      dimension: null,
      linkedInfo: null,
    })),

  setPart: (partCode) =>
    set({
      partCode,
      spec: null,
      meta: [],
      specOptions: {},
      keyValues: {},
      dimension: null,
      linkedInfo: null,
    }),
  setSpec: (spec, meta) =>
    set({ spec, meta, specOptions: {}, keyValues: {}, dimension: null }),
  setSpecOption: (optionId, value) =>
    set((s) => ({ specOptions: { ...s.specOptions, [optionId]: value } })),
  setKeyValue: (field, value) =>
    set((s) => ({ keyValues: { ...s.keyValues, [field]: value } })),
  setDimension: (dimension) => set({ dimension }),
  setLinkedInfo: (linkedInfo) =>
    set({
      linkedInfo,
      // Reset draw flags + per-linked caches when the part changes.
      // Default draw = false (match PartManager).
      linkedDrawEnabled:
        linkedInfo?.names.reduce(
          (acc, n) => ({ ...acc, [n]: false }),
          {} as Record<string, boolean>,
        ) ?? {},
      linkedSpecs: {},
      linkedOptions: {},
      activeSpecTab: 'main',
    }),
  setLinkedDrawEnabled: (name, enabled) =>
    set((s) => ({ linkedDrawEnabled: { ...s.linkedDrawEnabled, [name]: enabled } })),
  setActiveSpecTab: (tab) => set({ activeSpecTab: tab }),
  setLinkedSpec: (name, spec) =>
    set((s) => ({ linkedSpecs: { ...s.linkedSpecs, [name]: spec } })),
  setLinkedOption: (name, optionId, value) =>
    set((s) => ({
      linkedOptions: {
        ...s.linkedOptions,
        [name]: { ...(s.linkedOptions[name] ?? {}), [optionId]: value },
      },
    })),

  resetPart: () =>
    set({
      partCode: null,
      spec: null,
      meta: [],
      specOptions: {},
      keyValues: {},
      dimension: null,
      linkedInfo: null,
      linkedDrawEnabled: {},
      activeSpecTab: 'main',
      linkedSpecs: {},
      linkedOptions: {},
    }),
}));
