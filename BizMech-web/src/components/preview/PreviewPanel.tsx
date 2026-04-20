import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Square, Eye } from 'lucide-react';

import { useSelectionStore } from '@/store/selectionStore';
import { PreviewFrame } from './PreviewFrame';
import {
  applyDimensionKeyMapping,
  mergeOptionsIntoDimensions,
  resolveLengthAndThread,
} from '@/utils/dimensionMap';
import { isMetaOption } from '@/utils/linkedParts';
import { determineControlType } from '@/utils/controlType';
import { cn } from '@/utils/cn';

type Mode = '2d' | '3d';
type View2D = 'Front2D' | 'Side2D' | 'Top2D';

export function PreviewPanel() {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>('2d');
  const [view2d, setView2d] = useState<View2D>('Front2D');

  const partCode = useSelectionStore((s) => s.partCode);
  const spec = useSelectionStore((s) => s.spec);
  const dimension = useSelectionStore((s) => s.dimension);
  const specOptions = useSelectionStore((s) => s.specOptions);

  // ★ Build the combined dimensions dict the iframe renderer receives.
  // Full port of PartManager's preview pipeline:
  //
  //   1. applyDimensionKeyMapping — partdimension.dimension_data (raw DB
  //      fields like M, H, B1(일반), Ls …) → renderer keys (d, k, s, b …).
  //      Without this, the renderer reads D=0 for every HBOLT and draws a
  //      default 10 mm bolt regardless of size selection.
  //
  //   2. mergeOptionsIntoDimensions — overlay every current spec-option
  //      value name (사이즈="M3", 전체길이="30", 머리형식="기본", …) AND
  //      its Korean→English alias (사이즈→d, 전체길이→L, …).
  //
  //   3. resolveLengthAndThread — pull user-selected 전체길이 to override
  //      L, and derive thread length `b` from the L range.
  //
  // Any spec-option change produces a fresh object reference here, which
  // re-triggers the postMessage effect in PreviewFrame even when the
  // underlying partdimension row is unchanged.
  const mergedDimensions = useMemo(() => {
    // Step 1 — raw DB dimension_data with DB→renderer key mapping.
    const mapped = applyDimensionKeyMapping(
      dimension?.dimensionData ?? {},
    );

    const firstSeries = spec?.series[0];
    if (!firstSeries) return mapped;

    // Step 2 — resolve every non-meta option's current value.
    // EDITBOX / R_EDITBOX store the raw typed value directly.
    // CHECKBOX stores "true"/"false" — pass through verbatim (renderer may
    // check for it by key name). COMBOBOX / LISTBOX / RADIO store an enumid
    // which we turn back into the matching value.name.
    const optionValues: Record<string, string | number> = {};
    for (const opt of firstSeries.options) {
      if (isMetaOption(opt)) continue;
      const kind = determineControlType(opt.type);
      const raw = specOptions[opt.id] ?? opt.defaultValue ?? '';

      if (kind === 'EDITBOX' || kind === 'R_EDITBOX' || kind === 'CHECKBOX') {
        if (raw !== '') optionValues[opt.name] = String(raw);
        continue;
      }

      const val = opt.values.find((v) => String(v.enumid) === String(raw));
      if (val?.name != null && String(val.name).trim() !== '') {
        optionValues[opt.name] = String(val.name);
      }
    }

    // Option values overlay the partdimension row (user 전체길이=30 beats
    // DB's L_min).
    const withOptions = mergeOptionsIntoDimensions(mapped, optionValues);

    // Step 3 — derive L and b.
    return resolveLengthAndThread(withOptions, optionValues);
  }, [dimension, spec, specOptions]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-surface-border bg-gradient-to-r from-white via-white to-brand-50/30 px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-brand-500 to-accent-500 text-white shadow-sm">
            <Eye className="h-3.5 w-3.5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-800">{t('preview.title')}</h3>
            {spec && <div className="text-[10px] text-slate-400">{spec.partName}</div>}
          </div>
        </div>

        <div className="flex items-center gap-1 rounded-xl bg-slate-100/80 p-1 backdrop-blur-sm ring-1 ring-inset ring-slate-200">
          <TabButton active={mode === '2d'} onClick={() => setMode('2d')} icon={<Square className="h-3.5 w-3.5" />}>
            {t('preview.2d')}
          </TabButton>
          <TabButton active={mode === '3d'} onClick={() => setMode('3d')} icon={<Box className="h-3.5 w-3.5" />}>
            {t('preview.3d')}
          </TabButton>
        </div>
      </div>

      {mode === '2d' && (
        <div className="flex items-center gap-1.5 border-b border-surface-border bg-slate-50/50 px-4 py-2">
          <ViewChip active={view2d === 'Front2D'} onClick={() => setView2d('Front2D')}>
            {t('preview.front')}
          </ViewChip>
          <ViewChip active={view2d === 'Side2D'} onClick={() => setView2d('Side2D')}>
            {t('preview.side')}
          </ViewChip>
          <ViewChip active={view2d === 'Top2D'} onClick={() => setView2d('Top2D')}>
            {t('preview.top')}
          </ViewChip>
        </div>
      )}

      <div className="relative flex-1 min-h-0 overflow-hidden bg-slate-900">
        {/* subtle grid pattern as decor behind the iframe */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.08]"
          style={{
            backgroundImage:
              'linear-gradient(rgba(148,163,184,0.4) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.4) 1px, transparent 1px)',
            backgroundSize: '24px 24px',
          }}
        />

        {!partCode && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500/20 to-accent-500/20 ring-1 ring-white/10">
                <Eye className="h-6 w-6 text-slate-400" />
              </div>
              <div className="text-sm text-slate-400">{t('preview.empty')}</div>
            </div>
          </div>
        )}

        {partCode && (
          <PreviewFrame
            key={`${mode}:${partCode}`}
            mode={mode}
            partCode={partCode}
            dimensions={mergedDimensions}
            viewType={mode === '2d' ? view2d : 'ISO'}
          />
        )}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition',
        active
          ? 'bg-white text-brand-700 shadow-sm ring-1 ring-brand-100'
          : 'text-slate-500 hover:text-slate-800',
      )}
    >
      {icon}
      {children}
    </button>
  );
}

function ViewChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full border px-3 py-1 text-[11px] font-semibold transition',
        active
          ? 'border-brand-500 bg-brand-500 text-white shadow-sm'
          : 'border-surface-border bg-white text-slate-500 hover:border-brand-200 hover:text-brand-700',
      )}
    >
      {children}
    </button>
  );
}
