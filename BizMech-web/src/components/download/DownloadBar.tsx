/**
 * DownloadBar — compact horizontal strip under the preview.
 * Replaces the tall DownloadPanel for the new 2-column layout.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, FileDown } from 'lucide-react';

import { getPartApi } from '@/services/api/factory';
import { useSelectionStore } from '@/store/selectionStore';
import type { DownloadFormat } from '@/types';
import { cn } from '@/utils/cn';

const FORMATS: DownloadFormat[] = ['STEP', 'DWG', 'IGES', 'STL'];

export function DownloadBar() {
  const { t } = useTranslation();
  const partCode = useSelectionStore((s) => s.partCode);
  const dimension = useSelectionStore((s) => s.dimension);
  const [busy, setBusy] = useState<DownloadFormat | null>(null);

  async function handleDownload(format: DownloadFormat) {
    if (!partCode || !dimension) return;
    setBusy(format);
    try {
      const res = await getPartApi().download({
        partCode,
        keyComposite: dimension.keyComposite,
        format,
      });
      const a = document.createElement('a');
      a.href = res.url;
      a.download = res.fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(res.url), 2000);
    } finally {
      setBusy(null);
    }
  }

  const disabled = !partCode || !dimension;

  return (
    <div className="flex items-center gap-3 p-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-accent-500 text-white shadow-sm">
        <Download className="h-4 w-4" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="text-xs font-semibold text-slate-800">{t('download.title')}</div>
        <div className="truncate text-[10px] text-slate-400">
          {disabled ? t('download.nothing') : dimension?.keyComposite}
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        {FORMATS.map((fmt) => (
          <button
            key={fmt}
            type="button"
            disabled={disabled || busy !== null}
            onClick={() => handleDownload(fmt)}
            className={cn(
              'group flex items-center gap-1.5 rounded-lg border border-surface-border bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-600 shadow-sm transition',
              'hover:-translate-y-px hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 hover:shadow',
              'disabled:pointer-events-none disabled:opacity-40',
              busy === fmt && 'bg-brand-600 text-white',
            )}
          >
            <FileDown className={cn('h-3.5 w-3.5', busy === fmt ? 'text-white' : 'text-brand-600')} />
            {fmt}
          </button>
        ))}
      </div>
    </div>
  );
}
