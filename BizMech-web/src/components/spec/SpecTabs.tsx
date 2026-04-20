/**
 * SpecTabs — mirrors PartManager's top-of-form tab strip.
 *
 *   [ 주 부품 ]   [ 축 그리기 ☐ 작도 ]   [ 오일 씰 ☐ 작도 ]
 *      ▲active       ▲linked + checkbox
 *
 * The first tab is always the main part. Each subsequent tab represents
 * one linked part parsed from the spec (연결부품명). Clicking the tab
 * switches the form's content; clicking the embedded checkbox toggles
 * whether the linked part will be drawn in the preview (== PartManager's
 * "작도" flag) — default OFF.
 */
import { useTranslation } from 'react-i18next';

import { useSelectionStore } from '@/store/selectionStore';
import { cn } from '@/utils/cn';

interface Props {
  mainLabel: string;
}

export function SpecTabs({ mainLabel }: Props) {
  const linkedInfo = useSelectionStore((s) => s.linkedInfo);
  const activeTab = useSelectionStore((s) => s.activeSpecTab);
  const setActiveTab = useSelectionStore((s) => s.setActiveSpecTab);
  const drawEnabled = useSelectionStore((s) => s.linkedDrawEnabled);
  const setDrawEnabled = useSelectionStore((s) => s.setLinkedDrawEnabled);

  const hasLinked = !!linkedInfo && linkedInfo.names.length > 0;
  if (!hasLinked) return null;

  return (
    <div className="scroll-thin flex items-center gap-1.5 overflow-x-auto border-b border-surface-border bg-slate-50/70 px-3 py-2">
      <TabButton
        active={activeTab === 'main'}
        onClick={() => setActiveTab('main')}
      >
        <span className="mr-1 h-1.5 w-1.5 rounded-full bg-brand-500" />
        {mainLabel || '주 부품'}
      </TabButton>

      {linkedInfo!.names.map((name) => {
        const isActive = activeTab === name;
        const draw = drawEnabled[name] ?? false;
        return (
          <div
            key={name}
            className={cn(
              'flex shrink-0 items-center gap-1 rounded-lg border transition',
              isActive
                ? 'border-brand-200 bg-white shadow-sm'
                : 'border-transparent hover:border-slate-200',
            )}
          >
            <TabButton active={isActive} onClick={() => setActiveTab(name)} flat>
              {name}
            </TabButton>
            <DrawCheckbox
              checked={draw}
              onChange={(v) => setDrawEnabled(name, v)}
            />
          </div>
        );
      })}
    </div>
  );
}

function TabButton({
  active,
  flat,
  onClick,
  children,
}: {
  active: boolean;
  flat?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex shrink-0 items-center rounded-lg px-3 py-1.5 text-[12px] font-semibold transition',
        active
          ? flat
            ? 'text-brand-700'
            : 'bg-white text-brand-700 shadow-sm ring-1 ring-brand-100'
          : 'text-slate-500 hover:bg-white/70 hover:text-slate-800',
      )}
    >
      {children}
    </button>
  );
}

/** 작도 checkbox with Korean label. */
function DrawCheckbox({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <label className="mr-1 flex cursor-pointer items-center gap-1 pr-1 text-[11px] font-medium text-slate-600">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3 w-3 cursor-pointer accent-brand-600"
      />
      <span className={cn('transition', checked && 'text-brand-700')}>
        {t('spec.draw', { defaultValue: '작도' })}
      </span>
    </label>
  );
}
