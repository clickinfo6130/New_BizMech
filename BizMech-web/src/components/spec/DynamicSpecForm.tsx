/**
 * DynamicSpecForm — the main part and all of its linked parts are rendered
 * through a single tabbed form.
 *
 * Architecture (port of PartManager DynamicUIManager):
 *
 *   useEffect: fetch main partspec / meta on partCode change
 *   useEffect: parse linkedInfo (연결부품명 / 영향받는 옵션) → store
 *   useEffect: eagerly prefetch every linked part's spec   (BuildLinkedPartUI)
 *   useEffect: whenever main's specOptions change, propagate matching
 *              values to each linked part's options via AffectedPairs
 *              (SyncLinkedPartOption)
 *   useEffect: whenever resolvedKeyValues change, call findDimension on
 *              the main part
 *   useEffect: auto-correct main options that fall out of range when a
 *              parent option changes (filter logic)
 *
 * Body:
 *   activeTab === 'main'  → MainTabBody   (full form)
 *   activeTab === <name>  → LinkedTabBody (full form for that linked part)
 */
import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Sliders, MousePointerSquareDashed, Link2, Info, Lock } from 'lucide-react';

import { getPartApi } from '@/services/api/factory';
import { useSelectionStore } from '@/store/selectionStore';
import { Select } from '@/components/ui/Select';
import { Spinner } from '@/components/ui/Spinner';
import { SpecTabs } from '@/components/spec/SpecTabs';
import { cn } from '@/utils/cn';
import {
  filterExcludeValues,
  getFilteredValues,
  isOptionVisible,
  type SelectedPath,
} from '@/utils/specFilter';
import { findOptionForKeyField } from '@/utils/keyFieldMatcher';
import {
  getLinkedOptionLockSource,
  getPairsForLinkedName,
  isMetaOption,
  isRadioButtonOption,
  parseLinkedPartInfo,
  RADIO_BUTTON_MARKER,
  stripOptionSuffix,
} from '@/utils/linkedParts';
import { determineControlType } from '@/utils/controlType';
import { Input } from '@/components/ui/Input';
import type {
  PartOption,
  PartOptionValue,
  PartSeriesSpec,
  PartSpec,
} from '@/types';

export function DynamicSpecForm() {
  const { t } = useTranslation();
  const api = getPartApi();

  const partCode = useSelectionStore((s) => s.partCode);
  const spec = useSelectionStore((s) => s.spec);
  const meta = useSelectionStore((s) => s.meta);
  const specOptions = useSelectionStore((s) => s.specOptions);
  const setSpec = useSelectionStore((s) => s.setSpec);
  const setSpecOption = useSelectionStore((s) => s.setSpecOption);
  const setLinkedInfo = useSelectionStore((s) => s.setLinkedInfo);
  const setDimension = useSelectionStore((s) => s.setDimension);
  const activeTab = useSelectionStore((s) => s.activeSpecTab);
  const linkedInfo = useSelectionStore((s) => s.linkedInfo);
  const linkedSpecs = useSelectionStore((s) => s.linkedSpecs);
  const setLinkedSpec = useSelectionStore((s) => s.setLinkedSpec);
  const setLinkedOption = useSelectionStore((s) => s.setLinkedOption);

  // ── Load main part's spec + meta ────────────────
  const specQ = useQuery({
    queryKey: ['partSpec', partCode],
    queryFn: async () => {
      if (!partCode) return null;
      const [spec, meta] = await Promise.all([
        api.getPartSpec(partCode),
        api.getDimensionMeta(partCode),
      ]);
      return { spec, meta };
    },
    enabled: !!partCode,
  });

  useEffect(() => {
    if (!specQ.data) return;
    setSpec(specQ.data.spec, specQ.data.meta ?? []);
    setLinkedInfo(parseLinkedPartInfo(specQ.data.spec));
  }, [specQ.data, setSpec, setLinkedInfo]);

  // ── Eagerly prefetch every linked part's spec ────
  useEffect(() => {
    if (!linkedInfo) return;
    let cancelled = false;
    (async () => {
      for (const name of linkedInfo.names) {
        if (linkedSpecs[name]) continue;
        try {
          const s = await api.findPartSpecByNameOrCode(name);
          if (s && !cancelled) setLinkedSpec(name, s);
        } catch {
          /* ignore */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // linkedSpecs intentionally excluded — otherwise we loop forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkedInfo, api, setLinkedSpec]);

  // ── Build main selectedPath ─────────────────────
  const firstSeries = spec?.series[0];
  const selectedPath = useMemo<SelectedPath>(() => {
    const out: SelectedPath = {};
    if (!firstSeries) return out;
    for (const opt of firstSeries.options) {
      const raw = specOptions[opt.id] ?? opt.defaultValue ?? '';
      const num = Number(raw);
      if (!Number.isNaN(num)) out[opt.id] = num;
    }
    return out;
  }, [firstSeries, specOptions]);

  // ── Main dimension-key resolution ────────────────
  const keyFieldNames = useMemo(
    () => meta.filter((m) => m.isKeyField).map((m) => m.fieldName),
    [meta],
  );

  const resolvedKeyValues = useMemo<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    if (!firstSeries || !keyFieldNames.length) return out;
    for (const field of keyFieldNames) {
      const opt = findOptionForKeyField(firstSeries.options, field);
      if (!opt) continue;
      const kind = determineControlType(opt.type);

      // For EDITBOX / R_EDITBOX the stored value IS the key value itself —
      // no enumid → value.name lookup to perform.
      if (kind === 'EDITBOX' || kind === 'R_EDITBOX') {
        const raw = specOptions[opt.id] ?? opt.defaultValue ?? '';
        if (raw !== '') out[field] = String(raw);
        continue;
      }

      // COMBOBOX / LISTBOX / RADIO — resolve enumid → value.name.
      const enumIdRaw = specOptions[opt.id] ?? opt.defaultValue ?? '';
      const filtered = filterExcludeValues(getFilteredValues(opt, selectedPath));
      const value =
        filtered.find((v) => String(v.enumid) === String(enumIdRaw)) ?? filtered[0];
      if (value?.name) out[field] = String(value.name);
    }
    return out;
  }, [firstSeries, keyFieldNames, specOptions, selectedPath]);

  useEffect(() => {
    if (!partCode) return;
    if (!Object.keys(resolvedKeyValues).length) return;
    let cancelled = false;
    void (async () => {
      const dim = await api.findDimension(partCode, resolvedKeyValues);
      if (!cancelled) setDimension(dim);
    })();
    return () => {
      cancelled = true;
    };
  }, [partCode, resolvedKeyValues, api, setDimension]);

  // ── Auto-correct out-of-range main selections ────
  // Only COMBOBOX/LISTBOX/RADIO selections have enumids that can go
  // "out of range" after a parent option filters the values. EDITBOX /
  // CHECKBOX / R_EDITBOX values are free text / booleans — the user's
  // input must be preserved verbatim.
  useEffect(() => {
    if (!firstSeries) return;
    for (const opt of firstSeries.options) {
      if (isMetaOption(opt)) continue;
      const kind = determineControlType(opt.type);
      if (kind === 'EDITBOX' || kind === 'R_EDITBOX' || kind === 'CHECKBOX') continue;
      if (!isOptionVisible(opt, selectedPath)) continue;
      const current = specOptions[opt.id];
      if (current == null || current === '') continue;
      const stillOk = filterExcludeValues(
        getFilteredValues(opt, selectedPath),
      ).some((v) => String(v.enumid) === String(current));
      if (!stillOk) {
        const first = filterExcludeValues(getFilteredValues(opt, selectedPath))[0];
        if (first) setSpecOption(opt.id, String(first.enumid));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPath, firstSeries]);

  const dimension = useSelectionStore((s) => s.dimension);

  // ── SyncLinkedPartOption: main → linked propagation ────
  //
  // C# reference: DynamicUIManager.SyncLinkedPartOption (line 1965) +
  //               OnLinkedControlSelectionChanged (line 1343).
  //
  // For every AffectedPair we resolve:
  //   MAIN_VALUE_NAME = (priority order)
  //     1. current value of the main-part option whose name matches pair.main
  //     2. partdimension.dimension_data[pair.main] (e.g. "d1" field)
  //     3. resolvedKeyValues[pair.main] (e.g. "호칭")
  //
  // Then for EVERY linked option whose stripped name equals pair.linked we
  // find the enumid whose value.name matches MAIN_VALUE_NAME:
  //   · exact string compare
  //   · stripOptionSuffix compare
  //   · numeric tolerance compare (handles "3" ↔ "3.00" ↔ "3.0")
  //
  // Fallback: first available value so the preview always has SOMETHING.
  useEffect(() => {
    if (!firstSeries || !linkedInfo?.pairs.length) return;

    function findLinkedOptionsByBaseName(opts: PartOption[], pairLinked: string) {
      const target = stripOptionSuffix(pairLinked).toLowerCase();
      return opts.filter(
        (o) => stripOptionSuffix(o.name).toLowerCase() === target,
      );
    }

    /** Resolve the current main-part value string for a given pair.main. */
    function resolveMainValue(pairMain: string): string | null {
      // 1) Direct spec option — use the value actually rendered in the UI.
      const mainOpt = findOptionForKeyField(firstSeries!.options, pairMain);
      if (mainOpt) {
        const filtered = filterExcludeValues(
          getFilteredValues(mainOpt, selectedPath),
        );
        const enumId = specOptions[mainOpt.id] ?? mainOpt.defaultValue ?? '';
        const val =
          filtered.find((v) => String(v.enumid) === String(enumId)) ??
          filtered[0];
        if (val?.name != null && String(val.name).trim() !== '') {
          return String(val.name).trim();
        }
      }
      // 2) Partdimension.dimension_data (e.g. "d1" → "3").
      if (dimension?.dimensionData) {
        const wanted = stripOptionSuffix(pairMain).toLowerCase();
        const key = Object.keys(dimension.dimensionData).find(
          (k) => stripOptionSuffix(k).toLowerCase() === wanted,
        );
        if (key != null) {
          const v = dimension.dimensionData[key];
          if (v != null && String(v) !== '') return String(v);
        }
      }
      // 3) resolvedKeyValues (dim key field like 호칭).
      const krKey = Object.keys(resolvedKeyValues).find(
        (k) =>
          stripOptionSuffix(k).toLowerCase() ===
          stripOptionSuffix(pairMain).toLowerCase(),
      );
      if (krKey && resolvedKeyValues[krKey]) return resolvedKeyValues[krKey];
      return null;
    }

    /** Find the value on a linked option that matches `target` (name OR numerically). */
    function findLinkedValue(linkedOpt: PartOption, target: string) {
      const tTrim = target.trim();
      const tStripped = stripOptionSuffix(tTrim).toLowerCase();
      const tNum = parseFloat(tTrim);

      // a) exact name
      let hit = linkedOpt.values.find(
        (v) => String(v.name ?? '').trim() === tTrim,
      );
      if (hit) return hit;

      // b) stripped-suffix / case-insensitive name
      hit = linkedOpt.values.find(
        (v) => stripOptionSuffix(String(v.name ?? '')).toLowerCase() === tStripped,
      );
      if (hit) return hit;

      // c) numeric tolerance (covers "3" vs "3.00")
      if (!Number.isNaN(tNum)) {
        hit = linkedOpt.values.find((v) => {
          const n = parseFloat(String(v.name ?? ''));
          return !Number.isNaN(n) && Math.abs(n - tNum) < 1e-6;
        });
        if (hit) return hit;
      }
      return null;
    }

    for (const linkedName of linkedInfo.names) {
      const linkedSpec = linkedSpecs[linkedName];
      if (!linkedSpec) continue;
      const linkedSeries = linkedSpec.series[0];
      if (!linkedSeries) continue;

      // ★ positional pair mapping — each linked part only consumes its own
      //   pairs (축 그리기 → pairs[0], 오일 씰 → pairs[1], …).
      const pairsForThis = getPairsForLinkedName(linkedInfo, linkedName);
      if (!pairsForThis.length) {
        // eslint-disable-next-line no-console
        console.debug(`[sync] no positional pair for linked="${linkedName}"`);
        continue;
      }

      for (const pair of pairsForThis) {
        const mainValueName = resolveMainValue(pair.main);
        if (mainValueName == null) {
          // eslint-disable-next-line no-console
          console.debug(
            `[sync] ${linkedName}: main value not found for "${pair.main}"`,
          );
          continue;
        }

        const linkedOpts = findLinkedOptionsByBaseName(
          linkedSeries.options,
          pair.linked,
        );
        if (!linkedOpts.length) {
          // eslint-disable-next-line no-console
          console.debug(
            `[sync] ${linkedName}: no linked option named "${pair.linked}"`,
          );
          continue;
        }

        for (const linkedOpt of linkedOpts) {
          const matched =
            findLinkedValue(linkedOpt, mainValueName) ?? linkedOpt.values[0];
          if (!matched) continue;
          setLinkedOption(linkedName, linkedOpt.id, String(matched.enumid));
          // eslint-disable-next-line no-console
          console.debug(
            `[sync] ${linkedName}.${linkedOpt.name} ← main.${pair.main}="${mainValueName}" (enum=${matched.enumid}, name="${matched.name}")`,
          );
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    specOptions,
    linkedInfo,
    linkedSpecs,
    firstSeries,
    dimension,
    resolvedKeyValues,
    selectedPath,
  ]);

  // ── empty state ─────────────────────────────────
  if (!partCode) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center">
        <div className="max-w-[220px]">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-50 to-accent-50 ring-1 ring-brand-100">
            <MousePointerSquareDashed className="h-7 w-7 text-brand-500" />
          </div>
          <div className="text-sm font-semibold text-slate-700">{t('spec.title')}</div>
          <div className="mt-1 text-xs text-slate-500">{t('spec.empty')}</div>
        </div>
      </div>
    );
  }

  // ── loading ─────────────────────────────────────
  if (specQ.isLoading || !spec || !firstSeries) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-slate-500">
        <Spinner />
        {t('common.loading')}
      </div>
    );
  }

  // Split spec options into [dim-key controls] + [other controls].
  const allUIOptions = firstSeries.options
    .filter((o) => !isMetaOption(o))
    .filter((o) => isOptionVisible(o, selectedPath));

  const keyFieldOptions: PartOption[] = [];
  const otherOptions: PartOption[] = [];
  const usedKeyOptionIds = new Set<number>();
  for (const field of keyFieldNames) {
    const opt = findOptionForKeyField(allUIOptions, field);
    if (opt && !usedKeyOptionIds.has(opt.id)) {
      keyFieldOptions.push(opt);
      usedKeyOptionIds.add(opt.id);
    }
  }
  for (const opt of allUIOptions) {
    if (!usedKeyOptionIds.has(opt.id)) otherOptions.push(opt);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-surface-border bg-gradient-to-r from-white via-white to-brand-50/30 px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-brand-500 to-accent-500 text-white shadow-sm">
            <Sliders className="h-3.5 w-3.5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-800">{t('spec.title')}</h3>
            <div className="text-[11px] text-slate-400">{spec.partName}</div>
          </div>
        </div>
        <span className="rounded-full bg-brand-50 px-2.5 py-1 font-mono text-[10px] font-semibold text-brand-700 ring-1 ring-brand-100">
          {spec.partCode}
        </span>
      </div>

      <SpecTabs mainLabel={spec.partName} />

      <div className="scroll-thin flex-1 overflow-y-auto">
        {activeTab === 'main' ? (
          <MainTabBody
            series={firstSeries}
            keyFieldOptions={keyFieldOptions}
            otherOptions={otherOptions}
            specOptions={specOptions}
            selectedPath={selectedPath}
            onChange={setSpecOption}
            hasKeyFields={keyFieldNames.length > 0}
          />
        ) : (
          <LinkedTabBody partName={activeTab} />
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Main tab body — the full form for the primary part.
// ─────────────────────────────────────────────────────────

function MainTabBody({
  series,
  keyFieldOptions,
  otherOptions,
  specOptions,
  selectedPath,
  onChange,
  hasKeyFields,
}: {
  series: PartSeriesSpec;
  keyFieldOptions: PartOption[];
  otherOptions: PartOption[];
  specOptions: Record<number, string>;
  selectedPath: SelectedPath;
  onChange: (id: number, value: string) => void;
  hasKeyFields: boolean;
}) {
  const { t } = useTranslation();

  return (
    <div className="space-y-4 p-4">
      {series.cmd && series.name && (
        <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
          {series.cmd}
        </div>
      )}

      {hasKeyFields && keyFieldOptions.length > 0 && (
        <Section title={t('spec.dimensions')} variant="accent">
          {keyFieldOptions.map((opt) => (
            <OptionRow
              key={opt.id}
              option={opt}
              values={filterExcludeValues(getFilteredValues(opt, selectedPath))}
              current={specOptions[opt.id] ?? opt.defaultValue}
              onChange={(v) => onChange(opt.id, v)}
            />
          ))}
        </Section>
      )}

      <Section title={t('spec.title')}>
        {otherOptions.map((opt) => (
          <OptionRow
            key={opt.id}
            option={opt}
            values={filterExcludeValues(getFilteredValues(opt, selectedPath))}
            current={specOptions[opt.id] ?? opt.defaultValue}
            onChange={(v) => onChange(opt.id, v)}
          />
        ))}
      </Section>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Linked tab body — renders the linked part's own spec form.
// Radio groups go first (matches PartManager's BuildLinkedPartUI pinned
// layout), then the remaining controls.
// ─────────────────────────────────────────────────────────

function LinkedTabBody({ partName }: { partName: string }) {
  const { t } = useTranslation();
  const api = getPartApi();

  const linkedSpec = useSelectionStore((s) => s.linkedSpecs[partName]);
  const linkedOpts = useSelectionStore((s) => s.linkedOptions[partName] ?? {});
  const setLinkedOption = useSelectionStore((s) => s.setLinkedOption);
  const drawEnabled = useSelectionStore(
    (s) => s.linkedDrawEnabled[partName] ?? false,
  );
  const setDrawEnabled = useSelectionStore((s) => s.setLinkedDrawEnabled);
  const linkedInfo = useSelectionStore((s) => s.linkedInfo);

  // Fallback fetch — in case prefetch in the parent hasn't run yet.
  const linkedSpecQ = useQuery({
    queryKey: ['linkedSpecFallback', partName],
    queryFn: () => api.findPartSpecByNameOrCode(partName),
    enabled: !!partName && !linkedSpec,
  });

  const effectiveSpec: PartSpec | null = linkedSpec ?? linkedSpecQ.data ?? null;
  const series = effectiveSpec?.series[0];

  // Build the linked selectedPath from stored options + defaults.
  const selectedPath = useMemo<SelectedPath>(() => {
    const out: SelectedPath = {};
    if (!series) return out;
    for (const opt of series.options) {
      const raw = linkedOpts[opt.id] ?? opt.defaultValue ?? '';
      const num = Number(raw);
      if (!Number.isNaN(num)) out[opt.id] = num;
    }
    return out;
  }, [series, linkedOpts]);

  // Only this linked part's own pairs (positional association).
  const myPairs = linkedInfo ? getPairsForLinkedName(linkedInfo, partName) : [];

  // Keep linked options in range when parents change.
  // ★ Locked (affected-by-main) options are NEVER auto-corrected —
  //    their value is owned by the main-part sync effect.
  // ★ EDITBOX/CHECKBOX values are free-form, also never auto-corrected.
  useEffect(() => {
    if (!series) return;
    for (const opt of series.options) {
      if (isMetaOption(opt)) continue;
      const kind = determineControlType(opt.type);
      if (kind === 'EDITBOX' || kind === 'R_EDITBOX' || kind === 'CHECKBOX') continue;
      if (!isOptionVisible(opt, selectedPath)) continue;
      if (myPairs.length && getLinkedOptionLockSource(opt, myPairs)) continue;
      const current = linkedOpts[opt.id];
      if (current == null || current === '') continue;
      const stillOk = filterExcludeValues(
        getFilteredValues(opt, selectedPath),
      ).some((v) => String(v.enumid) === String(current));
      if (!stillOk) {
        const first = filterExcludeValues(getFilteredValues(opt, selectedPath))[0];
        if (first) setLinkedOption(partName, opt.id, String(first.enumid));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPath, series, myPairs]);

  // ── UI: Draw toggle — always visible ────────────
  const drawToggle = (
    <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-surface-border bg-white p-3 transition hover:bg-slate-50">
      <input
        type="checkbox"
        checked={drawEnabled}
        onChange={(e) => setDrawEnabled(partName, e.target.checked)}
        className="h-4 w-4 accent-brand-600"
      />
      <div className="flex-1">
        <div className="text-sm font-semibold text-slate-800">{t('spec.draw')}</div>
        <div className="text-[11px] text-slate-500">
          체크 시 이 연결부품을 2D/3D 프리뷰에 포함하여 렌더링합니다.
        </div>
      </div>
    </label>
  );

  // ── loading / not found ─────────────────────────
  if (linkedSpecQ.isLoading && !effectiveSpec) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-slate-500">
        <Spinner />
        loading linked spec…
      </div>
    );
  }

  if (!effectiveSpec || !series) {
    return (
      <div className="space-y-4 p-4">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <div className="mb-1 font-semibold">연결부품을 찾을 수 없습니다</div>
          <div className="text-xs">
            DB에서 "{partName}"에 매칭되는 partspec이 없습니다. 이름이 정확한지 또는
            DB에 등록되어 있는지 확인하세요.
          </div>
        </div>
        {drawToggle}
      </div>
    );
  }

  // Split visible options: radio first, then the rest.
  const visibleOptions = series.options
    .filter((o) => !isMetaOption(o))
    .filter((o) => isOptionVisible(o, selectedPath));

  const radioOptions = visibleOptions.filter(
    (o) => isRadioButtonOption(o) || (o.type ?? '').toUpperCase().startsWith('RADIO'),
  );
  const otherOptions = visibleOptions.filter(
    (o) => !(isRadioButtonOption(o) || (o.type ?? '').toUpperCase().startsWith('RADIO')),
  );

  return (
    <div className="space-y-4 p-4">
      {/* Linked-part identity */}
      <div className="rounded-xl border border-brand-100 bg-brand-50/40 p-3">
        <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-brand-700">
          <Link2 className="h-3 w-3" />
          {t('spec.linkedTitle')}
        </div>
        <div className="flex items-center gap-2">
          <div className="text-base font-semibold text-slate-800">{partName}</div>
          <span className="rounded bg-white px-1.5 py-0.5 font-mono text-[10px] text-brand-700 ring-1 ring-brand-100">
            {effectiveSpec.partCode}
          </span>
        </div>
        {effectiveSpec.partName !== partName && (
          <div className="mt-0.5 text-[11px] text-slate-500">{effectiveSpec.partName}</div>
        )}
      </div>

      {drawToggle}

      {/* Radio groups — pinned first */}
      {radioOptions.length > 0 && (
        <Section title="Type" variant="accent">
          {radioOptions.map((opt) => {
            const lockSource = myPairs.length
              ? getLinkedOptionLockSource(opt, myPairs)
              : null;
            return (
              <OptionRow
                key={opt.id}
                option={opt}
                values={filterExcludeValues(getFilteredValues(opt, selectedPath))}
                current={linkedOpts[opt.id] ?? opt.defaultValue}
                onChange={(v) => setLinkedOption(partName, opt.id, v)}
                locked={!!lockSource}
                lockSource={lockSource}
              />
            );
          })}
        </Section>
      )}

      {/* Other controls */}
      {otherOptions.length > 0 && (
        <Section title={t('spec.title')}>
          {otherOptions.map((opt) => {
            const lockSource = myPairs.length
              ? getLinkedOptionLockSource(opt, myPairs)
              : null;
            return (
              <OptionRow
                key={opt.id}
                option={opt}
                values={filterExcludeValues(getFilteredValues(opt, selectedPath))}
                current={linkedOpts[opt.id] ?? opt.defaultValue}
                onChange={(v) => setLinkedOption(partName, opt.id, v)}
                locked={!!lockSource}
                lockSource={lockSource}
              />
            );
          })}
        </Section>
      )}

      {/* AffectedPairs reference — only the pairs that apply to THIS linked part */}
      {myPairs.length > 0 && (
        <div className="rounded-xl border border-surface-border bg-white p-3">
          <div className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
            <Info className="h-3 w-3" />
            영향받는 옵션 매핑
          </div>
          <div className="space-y-1">
            {myPairs.map((p, i) => (
              <div key={i} className="flex items-center gap-2 font-mono text-[11px]">
                <span className="rounded bg-slate-100 px-2 py-0.5 text-slate-700">{p.main}</span>
                <span className="text-slate-300">→</span>
                <span className="rounded bg-brand-50 px-2 py-0.5 text-brand-700">
                  {p.linked}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-2 text-[10px] text-slate-400">
            주 부품의 왼쪽 필드가 변경되면 연결부품의 오른쪽 필드에 자동 동기화됩니다.
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Shared form primitives
// ─────────────────────────────────────────────────────────

function Section({
  title,
  variant,
  children,
}: {
  title: string;
  variant?: 'accent';
  children: React.ReactNode;
}) {
  return (
    <div>
      <div
        className={cn(
          'mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider',
          variant === 'accent' ? 'text-brand-700' : 'text-slate-500',
        )}
      >
        <span
          className={cn(
            'h-1 w-1 rounded-full',
            variant === 'accent' ? 'bg-brand-500' : 'bg-slate-400',
          )}
        />
        {title}
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function OptionRow({
  option,
  values,
  current,
  onChange,
  locked,
  lockSource,
}: {
  option: PartOption;
  values: PartOptionValue[];
  current: string;
  onChange: (v: string) => void;
  /** When true, the control is read-only — the value is driven by the main part. */
  locked?: boolean;
  /** Display name of the main-part option this is synced from (for the hint text). */
  lockSource?: string | null;
}) {
  const cleanName = (option.name ?? '').replace(RADIO_BUTTON_MARKER, '').trim();

  // ★ Determine the control kind. `(라디오 버튼)` name marker always wins
  //   over the raw type — matches IsRadioButtonOption in PartSpecModels.cs.
  const controlKind = isRadioButtonOption(option)
    ? 'RADIO'
    : determineControlType(option.type);

  // Lock badge — shown to the right of the option title.
  const lockBadge = locked ? (
    <span
      title={lockSource ? `주 부품의 '${lockSource}'에서 동기화됨` : '주 부품에서 동기화됨'}
      className="ml-1 inline-flex items-center gap-0.5 rounded-full bg-amber-50 px-1.5 py-[1px] text-[9px] font-semibold text-amber-700 ring-1 ring-amber-200"
    >
      <Lock className="h-2.5 w-2.5" />
      동기화
    </span>
  ) : null;

  const Label = () => (
    <label className="label flex items-center whitespace-pre-line leading-tight">
      <span className="flex-1">{cleanName}</span>
      {lockBadge}
    </label>
  );

  const lockHint =
    locked && lockSource ? (
      <LockHint source={lockSource} currentLabel={getCurrentValueLabel(values, current)} />
    ) : null;

  // ─── CHECKBOX ─────────────────────────────────────
  if (controlKind === 'CHECKBOX') {
    const isChecked = /^true$/i.test(String(current).trim());
    return (
      <label
        className={cn(
          'flex cursor-pointer items-center gap-2 rounded-lg border border-surface-border bg-white p-2.5',
          locked && 'cursor-not-allowed bg-amber-50/60 border-amber-200',
        )}
      >
        <input
          type="checkbox"
          checked={isChecked}
          disabled={locked}
          onChange={(e) => onChange(e.target.checked ? 'true' : 'false')}
          className="h-3.5 w-3.5 accent-brand-600"
        />
        <span className="flex flex-1 items-center text-xs font-medium text-slate-700">
          <span className="flex-1">{cleanName}</span>
          {lockBadge}
        </span>
      </label>
    );
  }

  // ─── EDITBOX / R_EDITBOX ──────────────────────────
  if (controlKind === 'EDITBOX' || controlKind === 'R_EDITBOX') {
    const readOnly = controlKind === 'R_EDITBOX' || locked;
    return (
      <div>
        <Label />
        <Input
          type="number"
          inputMode="decimal"
          step="any"
          value={current ?? ''}
          placeholder={option.defaultValue || '0'}
          readOnly={readOnly}
          disabled={locked}
          onChange={(e) => !readOnly && onChange(e.target.value)}
          className={cn(
            controlKind === 'R_EDITBOX' && 'bg-slate-50 text-slate-500',
            locked &&
              'cursor-not-allowed border-amber-200 bg-amber-50/60 text-amber-900 focus:border-amber-300 focus:ring-amber-100',
          )}
        />
        {lockHint}
      </div>
    );
  }

  // ─── empty values dead-end (no options to show) ───
  if (!values.length) {
    return (
      <div>
        <Label />
        <div className="rounded-lg border border-dashed border-slate-200 px-3 py-2 text-xs text-slate-400">
          —
        </div>
      </div>
    );
  }

  // ─── RADIO ───────────────────────────────────────
  if (controlKind === 'RADIO') {
    return (
      <div>
        <Label />
        <div
          className={cn(
            'flex flex-wrap gap-1 rounded-lg p-1 ring-1 ring-inset',
            locked
              ? 'cursor-not-allowed bg-amber-50/50 ring-amber-100'
              : 'bg-slate-100/80 ring-slate-200',
          )}
        >
          {values.map((v) => {
            const active = String(v.enumid) === String(current);
            return (
              <button
                key={`${option.id}-${v.enumid}`}
                type="button"
                disabled={locked}
                onClick={() => !locked && onChange(String(v.enumid))}
                className={cn(
                  'rounded-md px-3 py-1.5 text-xs font-semibold transition',
                  active
                    ? locked
                      ? 'bg-white text-amber-700 shadow-sm ring-1 ring-amber-200'
                      : 'bg-white text-brand-700 shadow-sm ring-1 ring-brand-100'
                    : 'text-slate-500',
                  !locked && 'hover:text-slate-800',
                  locked && 'cursor-not-allowed opacity-70',
                )}
              >
                {v.name || v.desc || String(v.enumid)}
              </button>
            );
          })}
        </div>
        {lockHint}
      </div>
    );
  }

  // ─── LISTBOX ─────────────────────────────────────
  // Rendered as a multi-row list (like PartManager) so long enumerations
  // (e.g. HBOLT 사이즈 with 71 values) are scrollable at a glance.
  if (controlKind === 'LISTBOX') {
    return (
      <div>
        <Label />
        <select
          size={Math.min(7, Math.max(4, values.length))}
          value={current}
          disabled={locked}
          onChange={(e) => onChange(e.target.value)}
          className={cn(
            'w-full rounded-lg border border-surface-border bg-white px-2 py-1 text-sm text-slate-800 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100',
            locked &&
              'cursor-not-allowed border-amber-200 bg-amber-50/60 text-amber-900',
          )}
        >
          {values.map((v) => (
            <option key={`${option.id}-${v.enumid}`} value={String(v.enumid)}>
              {v.name || v.desc || String(v.enumid)}
            </option>
          ))}
        </select>
        {lockHint}
      </div>
    );
  }

  // ─── COMBOBOX (default) ──────────────────────────
  return (
    <div>
      <Label />
      <Select
        value={current}
        disabled={locked}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          locked &&
            'cursor-not-allowed border-amber-200 bg-amber-50/60 text-amber-900 focus:border-amber-300 focus:ring-amber-100',
        )}
      >
        {values.map((v) => (
          <option key={`${option.id}-${v.enumid}`} value={String(v.enumid)}>
            {v.name || v.desc || String(v.enumid)}
          </option>
        ))}
      </Select>
      {lockHint}
    </div>
  );
}

function getCurrentValueLabel(
  values: PartOptionValue[],
  currentEnumId: string,
): string {
  const v = values.find((x) => String(x.enumid) === String(currentEnumId));
  return v ? String(v.name ?? v.desc ?? v.enumid) : '';
}

function LockHint({
  source,
  currentLabel,
}: {
  source: string;
  currentLabel: string;
}) {
  return (
    <div className="mt-1 flex items-center gap-1 text-[10px] text-amber-700">
      <Lock className="h-2.5 w-2.5" />
      <span>
        주 부품의 <span className="font-semibold">{source}</span>
        {currentLabel && (
          <>
            {' '}
            값 <span className="font-mono font-semibold">{currentLabel}</span> 으로 고정
          </>
        )}
      </span>
    </div>
  );
}
