/**
 * Main browser — shown next to the left CategorySidebar.
 *
 * Desktop grid (≥xl):
 *   ┌──────────────┬──────────────────────────────┐
 *   │ Spec panel   │ Preview                      │
 *   │ + dimensions │                              │
 *   │              ├──────────────────────────────┤
 *   │              │ Download bar                 │
 *   └──────────────┴──────────────────────────────┘
 *
 * Mobile/tablet: stacked (spec → preview → download).
 */
import { useTranslation } from 'react-i18next';
import { Sparkles } from 'lucide-react';

import { DynamicSpecForm } from '@/components/spec/DynamicSpecForm';
import { PreviewPanel } from '@/components/preview/PreviewPanel';
import { DownloadBar } from '@/components/download/DownloadBar';
import { Card } from '@/components/ui/Card';
import { useSelectionStore } from '@/store/selectionStore';

export function MainPage() {
  const { t } = useTranslation();
  const partCode = useSelectionStore((s) => s.partCode);

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col gap-3 p-3 lg:p-4">
      {/* header strip */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-bold text-slate-800">{t('nav.browse')}</h1>
          <p className="text-xs text-slate-500">{t('app.tagline')}</p>
        </div>
        {partCode && (
          <div className="flex items-center gap-2 rounded-full border border-brand-200 bg-brand-50 px-3 py-1.5 text-[11px] font-semibold text-brand-700">
            <Sparkles className="h-3.5 w-3.5" />
            {partCode}
          </div>
        )}
      </div>

      {/* content grid */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 xl:grid-cols-[minmax(320px,380px)_1fr]">
        {/* Spec + dimension */}
        <Card className="min-h-[480px] overflow-hidden xl:min-h-0">
          <DynamicSpecForm />
        </Card>

        {/* Preview + download in right column */}
        <div className="flex min-h-0 flex-col gap-3">
          <Card className="min-h-[420px] flex-1 overflow-hidden">
            <PreviewPanel />
          </Card>
          <Card className="shrink-0">
            <DownloadBar />
          </Card>
        </div>
      </div>
    </div>
  );
}
