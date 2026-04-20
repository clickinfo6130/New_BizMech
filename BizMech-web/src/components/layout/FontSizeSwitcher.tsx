import { Type } from 'lucide-react';
import { useUIStore, type FontScale } from '@/store/uiStore';
import { cn } from '@/utils/cn';

const LEVELS: { key: FontScale; label: string; labelSize: string }[] = [
  { key: 'sm', label: 'A', labelSize: 'text-[10px]' },
  { key: 'md', label: 'A', labelSize: 'text-[12px]' },
  { key: 'lg', label: 'A', labelSize: 'text-[13px]' },
  { key: 'xl', label: 'A', labelSize: 'text-[15px]' },
];

export function FontSizeSwitcher() {
  const scale = useUIStore((s) => s.fontScale);
  const setScale = useUIStore((s) => s.setFontScale);

  return (
    <div className="hidden items-center gap-1 rounded-full border border-slate-200 bg-white px-1 py-0.5 shadow-sm md:flex">
      <Type className="ml-1 h-3 w-3 text-slate-400" />
      {LEVELS.map((lvl) => (
        <button
          key={lvl.key}
          type="button"
          onClick={() => setScale(lvl.key)}
          title={`font scale: ${lvl.key}`}
          className={cn(
            'flex h-5 w-5 items-center justify-center rounded-full font-bold leading-none transition',
            lvl.labelSize,
            scale === lvl.key
              ? 'bg-brand-600 text-white shadow-sm'
              : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700',
          )}
        >
          {lvl.label}
        </button>
      ))}
    </div>
  );
}
