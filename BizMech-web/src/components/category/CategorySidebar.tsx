/**
 * CategorySidebar — nested, lazily-loaded category tree.
 *
 *   MainCategory (STANDARD / MOTOR)
 *     └─ SubCategory
 *         ├─ MidCategory            (standard parts only)
 *         │    └─ PartType          ← leaf that drives selection store
 *         └─ (motor) PartType list  (via getMotorPartsBySub)
 *
 * Each node keeps local expanded state in a Zustand-free React state, so
 * opening a MOTOR → SERVO branch doesn't close the STANDARD → BOLT branch.
 *
 * Children fetch lazily with React Query. Expanding a node fires the query
 * for its children the first time.
 */
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  ChevronRight,
  ChevronDown,
  ArrowUp,
  Cog,
  Folder,
  FolderOpen,
  Layers,
  Box,
  Zap,
} from 'lucide-react';

import { getPartApi } from '@/services/api/factory';
import { useSelectionStore } from '@/store/selectionStore';
import { Spinner } from '@/components/ui/Spinner';
import { cn } from '@/utils/cn';
import type { SupportedLang } from '@/i18n';
import type { MainCategory, PartType, SubCategory } from '@/types';

// ─────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────

function useLangName() {
  const { i18n } = useTranslation();
  const lng = (i18n.resolvedLanguage ?? 'ko') as SupportedLang;
  return (nameKr: string, name: string) =>
    lng === 'ko' ? nameKr || name : name || nameKr;
}

// ─────────────────────────────────────────────────────────
// Root
// ─────────────────────────────────────────────────────────

export function CategorySidebar() {
  const { t } = useTranslation();
  const api = getPartApi();
  const mainQ = useQuery({
    queryKey: ['mainCategories'],
    queryFn: () => api.getMainCategories(),
  });

  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    // open STANDARD by default
    'main:STANDARD': true,
  });
  const toggle = (key: string) =>
    setExpanded((s) => ({ ...s, [key]: !s[key] }));

  // Scroll container — tracked so we can show a "back to top" button and
  // animate it back when the list is long (e.g. bearing sub-list).
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showTopBtn, setShowTopBtn] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => setShowTopBtn(el.scrollTop > 240);
    el.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div className="relative flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-surface-border px-4 py-3">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-brand-500 to-accent-500 text-white shadow-sm">
          <Layers className="h-3.5 w-3.5" />
        </div>
        <h3 className="text-sm font-semibold text-slate-800">{t('category.title')}</h3>
        {mainQ.isFetching && <Spinner className="ml-auto" />}
      </div>

      <div ref={scrollRef} className="scroll-thin flex-1 overflow-y-auto py-2">
        {mainQ.isLoading && <LoadingRow indent={0} />}
        {(mainQ.data ?? []).map((main) => (
          <MainNode
            key={main.code}
            main={main}
            expanded={expanded}
            toggle={toggle}
          />
        ))}
      </div>

      {showTopBtn && (
        <button
          type="button"
          onClick={() =>
            scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
          }
          className="absolute bottom-3 right-3 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-brand-600 text-white shadow-elevated transition hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-400"
          aria-label={t('category.backToTop', { defaultValue: '상단으로' })}
          title={t('category.backToTop', { defaultValue: '상단으로' })}
        >
          <ArrowUp className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Main category (STANDARD / MOTOR)
// ─────────────────────────────────────────────────────────

function MainNode({
  main,
  expanded,
  toggle,
}: {
  main: MainCategory;
  expanded: Record<string, boolean>;
  toggle: (key: string) => void;
}) {
  const pick = useLangName();
  const api = getPartApi();
  const key = `main:${main.code}`;
  const open = !!expanded[key];

  const subsQ = useQuery({
    queryKey: ['subCategories', main.code],
    queryFn: () => api.getSubCategories(main.code),
    enabled: open,
  });

  const Icon = main.code === 'MOTOR' ? Zap : Cog;

  return (
    <div>
      <TreeRow
        indent={0}
        open={open}
        onToggle={() => toggle(key)}
        hasChildren
        icon={
          <Icon
            className={cn(
              'h-4 w-4',
              main.code === 'MOTOR' ? 'text-amber-500' : 'text-brand-600',
            )}
          />
        }
        label={pick(main.nameKr, main.name)}
        sub={main.code}
        variant="main"
      />
      {open && (
        <div>
          {subsQ.isLoading && <LoadingRow indent={1} />}
          {(subsQ.data ?? []).map((sub) => (
            <SubNode
              key={sub.code}
              main={main}
              sub={sub}
              expanded={expanded}
              toggle={toggle}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Sub category (split: STANDARD keeps mid level, MOTOR flattens it)
// ─────────────────────────────────────────────────────────

function SubNode({
  main,
  sub,
  expanded,
  toggle,
}: {
  main: MainCategory;
  sub: SubCategory;
  expanded: Record<string, boolean>;
  toggle: (key: string) => void;
}) {
  const pick = useLangName();
  const api = getPartApi();
  const key = `sub:${sub.code}`;
  const open = !!expanded[key];
  const isMotor = main.code === 'MOTOR';

  // STANDARD path → load mid categories
  const midsQ = useQuery({
    queryKey: ['midCategories', sub.code],
    queryFn: () => api.getMidCategories(sub.code),
    enabled: open && !isMotor,
  });

  // MOTOR path → load parts directly
  const motorPartsQ = useQuery({
    queryKey: ['motorParts', sub.code],
    queryFn: () => api.getMotorPartsBySub(sub.code),
    enabled: open && isMotor,
  });

  return (
    <div>
      <TreeRow
        indent={1}
        open={open}
        onToggle={() => toggle(key)}
        hasChildren
        icon={open ? <FolderOpen className="h-4 w-4 text-slate-400" /> : <Folder className="h-4 w-4 text-slate-400" />}
        label={pick(sub.nameKr, sub.name)}
        variant="sub"
      />
      {open && (
        <div>
          {(midsQ.isLoading || motorPartsQ.isLoading) && <LoadingRow indent={2} />}

          {/* STANDARD: mids */}
          {!isMotor &&
            (midsQ.data ?? []).map((mid) => (
              <MidNode
                key={mid.code}
                mid={mid}
                expanded={expanded}
                toggle={toggle}
              />
            ))}

          {/* MOTOR: flat parts */}
          {isMotor &&
            (motorPartsQ.data ?? []).map((p) => <PartLeaf key={p.code} part={p} indent={2} />)}

          {/* empty state */}
          {!isMotor && midsQ.data && midsQ.data.length === 0 && <EmptyRow indent={2} />}
          {isMotor && motorPartsQ.data && motorPartsQ.data.length === 0 && <EmptyRow indent={2} />}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Mid category → PartType children (STANDARD only)
// ─────────────────────────────────────────────────────────

function MidNode({
  mid,
  expanded,
  toggle,
}: {
  mid: { code: string; name: string; nameKr: string };
  expanded: Record<string, boolean>;
  toggle: (key: string) => void;
}) {
  const pick = useLangName();
  const api = getPartApi();
  const key = `mid:${mid.code}`;
  const open = !!expanded[key];

  const ptQ = useQuery({
    queryKey: ['partTypes', mid.code],
    queryFn: () => api.getPartTypes(mid.code),
    enabled: open,
  });

  return (
    <div>
      <TreeRow
        indent={2}
        open={open}
        onToggle={() => toggle(key)}
        hasChildren
        icon={<Box className="h-3.5 w-3.5 text-slate-400" />}
        label={pick(mid.nameKr, mid.name)}
        variant="mid"
      />
      {open && (
        <div>
          {ptQ.isLoading && <LoadingRow indent={3} />}
          {(ptQ.data ?? []).map((p) => <PartLeaf key={p.code} part={p} indent={3} />)}
          {ptQ.data && ptQ.data.length === 0 && <EmptyRow indent={3} />}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Leaf — a PartType that actually drives the selection store
// ─────────────────────────────────────────────────────────

function PartLeaf({ part, indent }: { part: PartType; indent: number }) {
  const pick = useLangName();
  const activePart = useSelectionStore((s) => s.partCode);
  const setPart = useSelectionStore((s) => s.setPart);
  const active = activePart === part.code;
  const btnRef = useRef<HTMLButtonElement>(null);

  // Keep the active item in view (e.g. after OrderCode search navigates
  // into a deep category branch, or on reload with persisted selection).
  useEffect(() => {
    if (active) {
      btnRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [active]);

  return (
    <button
      ref={btnRef}
      type="button"
      onClick={() => setPart(part.code)}
      className={cn(
        'group flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] transition',
        indentPadding(indent),
        active
          ? 'bg-gradient-to-r from-brand-50 to-transparent font-semibold text-brand-800'
          : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900',
      )}
    >
      <span
        className={cn(
          'h-1.5 w-1.5 rounded-full transition',
          active ? 'bg-brand-500 shadow-[0_0_0_3px_rgba(52,97,245,0.15)]' : 'bg-slate-300 group-hover:bg-slate-400',
        )}
      />
      <span className="min-w-0 flex-1 truncate">{pick(part.nameKr, part.name)}</span>
      <span
        className={cn(
          'ml-auto shrink-0 rounded-full px-2 py-0.5 font-mono text-[9px] tracking-wider transition',
          active ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-400 group-hover:bg-slate-200',
        )}
      >
        {part.code}
      </span>
    </button>
  );
}

// ─────────────────────────────────────────────────────────
// Shared primitives
// ─────────────────────────────────────────────────────────

function indentPadding(level: number) {
  const classes = ['pl-3', 'pl-6', 'pl-9', 'pl-12', 'pl-14'];
  return classes[Math.min(level, classes.length - 1)];
}

function TreeRow({
  indent,
  open,
  onToggle,
  hasChildren,
  icon,
  label,
  sub,
  variant,
}: {
  indent: number;
  open?: boolean;
  onToggle?: () => void;
  hasChildren?: boolean;
  icon: React.ReactNode;
  label: string;
  sub?: string;
  variant: 'main' | 'sub' | 'mid';
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        'group flex w-full items-center gap-1.5 text-left transition',
        indentPadding(indent),
        variant === 'main' && 'py-2 text-[13px] font-bold uppercase tracking-wider text-slate-800 hover:bg-slate-100',
        variant === 'sub' && 'py-1.5 text-[12.5px] font-semibold text-slate-700 hover:bg-slate-50',
        variant === 'mid' && 'py-1 text-[12px] font-medium text-slate-600 hover:bg-slate-50',
      )}
    >
      {hasChildren ? (
        open ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        )
      ) : (
        <span className="h-3.5 w-3.5 shrink-0" />
      )}
      <span className="flex h-5 w-5 shrink-0 items-center justify-center">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {sub && variant === 'main' && (
        <span className="ml-auto rounded-full bg-slate-100 px-1.5 py-0.5 font-mono text-[9px] tracking-wider text-slate-400 group-hover:bg-slate-200">
          {sub}
        </span>
      )}
    </button>
  );
}

function LoadingRow({ indent }: { indent: number }) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 py-1.5 text-xs text-slate-400',
        indentPadding(indent),
      )}
    >
      <Spinner className="h-3 w-3" />
      <span>loading…</span>
    </div>
  );
}

function EmptyRow({ indent }: { indent: number }) {
  return (
    <div className={cn('py-1.5 text-[11px] text-slate-300', indentPadding(indent))}>—</div>
  );
}
