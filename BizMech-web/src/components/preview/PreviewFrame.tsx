/**
 * PreviewFrame — iframe wrapper around the original PartManager viewers
 * (/viewers/viewer2D.html and /viewers/viewer.html).
 *
 * Communication (postMessage):
 *   React → iframe : { type:'setModel', partCode, dimensions, linkedParts, viewType }
 *                    { type:'setView',  viewType }
 *   iframe → React : { type:'ready' }
 *                    { type:'log', msg }
 *
 * The original viewers dispatch onCSharpMessage() via WebView2's native
 * bridge. `public/viewers/js/bridge.js` shims that to postMessage so
 * React can drive them.
 *
 * ★ linkedParts is populated from spec's "연결부품명" / "영향받는 옵션"
 *   metadata parsed by utils/linkedParts.ts. For each linked part name we
 *   asynchronously resolve its dimensions from the affected-pair mapping
 *   against the currently-selected main dimensions.
 */
import { useEffect, useMemo, useRef } from 'react';

import { useSelectionStore } from '@/store/selectionStore';
import { getPairsForLinkedName } from '@/utils/linkedParts';
import { mapColumnToKey } from '@/utils/dimensionMap';
import type { LinkedPartInfo, PartDimension, PartSpec } from '@/types';

interface ViewerLinkedPart {
  partCode: string;
  partName: string;
  partType: string;
  dimensions: Record<string, number | string>;
  isDrawEnabled: boolean;
}

interface Props {
  mode: '2d' | '3d';
  partCode: string | null;
  dimensions: Record<string, number | string>;
  viewType?: 'Front2D' | 'Side2D' | 'Top2D' | 'ISO';
}

export function PreviewFrame({ mode, partCode, dimensions, viewType }: Props) {
  const ref = useRef<HTMLIFrameElement>(null);
  const readyRef = useRef(false);
  const pendingRef = useRef<unknown | null>(null);

  const linkedInfo = useSelectionStore((s) => s.linkedInfo);
  const dimension = useSelectionStore((s) => s.dimension);
  const drawEnabled = useSelectionStore((s) => s.linkedDrawEnabled);
  const linkedSpecs = useSelectionStore((s) => s.linkedSpecs);
  const linkedOptions = useSelectionStore((s) => s.linkedOptions);

  // ★ Memoize to prevent new array references on every render which would
  //   otherwise refire the postMessage effect on every React render cycle.
  const linkedPartsData = useMemo(() => {
    const all = resolveLinkedParts(linkedInfo, dimension, linkedSpecs, linkedOptions);
    return all.filter((p) => drawEnabled[p.partName] === true);
  }, [linkedInfo, dimension, linkedSpecs, linkedOptions, drawEnabled]);

  const src = mode === '2d' ? '/viewers/viewer2D.html' : '/viewers/viewer.html';

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (!ref.current || e.source !== ref.current.contentWindow) return;
      const data = e.data as { type?: string; msg?: string; message?: string } | null;
      if (!data || typeof data !== 'object') return;
      if (data.type === 'ready') {
        readyRef.current = true;
        if (pendingRef.current && ref.current.contentWindow) {
          ref.current.contentWindow.postMessage(pendingRef.current, '*');
          pendingRef.current = null;
        }
      } else if (data.type === 'log') {
        // eslint-disable-next-line no-console
        console.debug(`[viewer:${mode}]`, data.msg ?? data.message);
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [mode]);

  // Push model updates to the iframe whenever inputs change.
  useEffect(() => {
    if (!partCode) return;
    const payload = {
      type: 'setModel',
      partCode,
      dimensions,
      linkedParts: linkedPartsData,
      viewType: viewType ?? (mode === '2d' ? 'Front2D' : 'ISO'),
    };
    if (!ref.current?.contentWindow) return;
    if (readyRef.current) {
      ref.current.contentWindow.postMessage(payload, '*');
    } else {
      pendingRef.current = payload;
    }
  }, [partCode, dimensions, viewType, mode, linkedPartsData]);

  return (
    <iframe
      ref={ref}
      src={src}
      title={`preview-${mode}`}
      className="h-full w-full rounded-b-xl border-0 bg-slate-50"
      sandbox="allow-scripts allow-same-origin"
    />
  );
}

// ─────────────────────────────────────────────────────────
// resolveLinkedParts
// Assembles the ViewerLinkedPart array from the store:
//   · Use pre-fetched linkedSpecs from the selection store
//   · Seed each linked part's dims from main-part AffectedPair propagation
//   · Layer the user's own linked option selections on top
// Pure function — wrapped in useMemo by callers for stable references.
// ─────────────────────────────────────────────────────────

function resolveLinkedParts(
  info: LinkedPartInfo | null,
  mainDimension: PartDimension | null,
  linkedSpecs: Record<string, PartSpec>,
  linkedOptions: Record<string, Record<number, string>>,
): ViewerLinkedPart[] {
  if (!info) return [];
  const mainDims = mainDimension?.dimensionData ?? {};

  return info.names
    .map((name) => {
      const spec = linkedSpecs[name];
      if (!spec) return null;

      const ldims: Record<string, number | string> = {};

      // 1) Propagate main dims via AffectedPairs, using ONLY the pairs
      //    positionally assigned to this linked part.
      const pairsForThis = getPairsForLinkedName(info, name);
      for (const pair of pairsForThis) {
        const key = Object.keys(mainDims).find(
          (k) =>
            k.trim() === pair.main.trim() ||
            k.toUpperCase() === pair.main.toUpperCase(),
        );
        if (key != null) {
          ldims[pair.linked] = mainDims[key];
          ldims[pair.linked.toUpperCase()] = mainDims[key];
          const alias = mapColumnToKey(pair.linked);
          if (alias) ldims[alias] = mainDims[key];
        }
      }

      // 2) Layer the user's explicit linked-option value.names on top
      //    (resolved from linkedOptions → value.enumid → value.name).
      const opts = linkedOptions[name] ?? {};
      const series = spec.series[0];
      if (series) {
        for (const opt of series.options) {
          const enumId = opts[opt.id] ?? opt.defaultValue;
          const v = opt.values.find(
            (vv) => String(vv.enumid) === String(enumId),
          );
          if (v?.name) {
            ldims[opt.name] = v.name;
            const alias = mapColumnToKey(opt.name);
            if (alias && !(alias in ldims)) ldims[alias] = v.name;
          }
        }
      }

      return {
        partCode: spec.partCode,
        partName: name,
        partType: spec.partType,
        dimensions: ldims,
        isDrawEnabled: true,
      } as ViewerLinkedPart;
    })
    .filter((p): p is ViewerLinkedPart => p !== null);
}
