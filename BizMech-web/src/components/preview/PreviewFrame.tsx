/**
 * PreviewFrame — iframe wrapper around the original PartManager viewers
 * (/viewers/viewer2D.html and /viewers/viewer.html).
 *
 * Communication (postMessage):
 *   React → iframe : { type:'setModel',  partCode, dimensions, linkedParts, viewType, dimMeta }
 *                    { type:'setView',   viewType }
 *                    { type:'setOption', option:'dimPanel', value:boolean }   // dim reference panel toggle
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
 *
 * ★ dimMeta is the `{ field_name → display_name }` map that powers the
 *   좌상단 "치수 정보" reference panel. The renderer tolerates an empty
 *   map (panel still shows abbreviations + values, display-name column
 *   becomes "—"), so it's safe to always send even while the meta query
 *   is loading.
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
  /** `{ fieldName → Korean displayName }` — powers the reference panel. */
  dimMeta?: Record<string, string>;
  /** Toggle the 좌상단 dimension reference panel on/off. */
  showDimPanel?: boolean;
}

export function PreviewFrame({
  mode,
  partCode,
  dimensions,
  viewType,
  dimMeta,
  showDimPanel,
}: Props) {
  const ref = useRef<HTMLIFrameElement>(null);
  const readyRef = useRef(false);
  // ★ Queue ALL messages posted before the iframe signals ready. The
  //   previous single-slot design dropped any message that arrived after
  //   setModel (notably setOption{dimPanel}), so the dim reference panel
  //   would flip back to OFF every time the user switched 2D↔3D —
  //   because the mode switch re-mounts the iframe and the renderer's
  //   internal showDimPanel defaults to false until setOption arrives.
  const pendingRef = useRef<unknown[]>([]);

  /**
   * Send a message to the iframe, or queue it if the iframe hasn't
   * signaled `ready` yet. Queued messages flush in arrival order once
   * the handshake completes.
   */
  const postOrQueue = (payload: unknown) => {
    if (!ref.current?.contentWindow) {
      pendingRef.current.push(payload);
      return;
    }
    if (readyRef.current) {
      ref.current.contentWindow.postMessage(payload, '*');
    } else {
      pendingRef.current.push(payload);
    }
  };

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
    // Reset handshake + queue when the iframe src changes (mode switch
    // remounts the iframe, but we want explicit init on every new
    // document load).
    readyRef.current = false;
    pendingRef.current = [];

    function onMessage(e: MessageEvent) {
      if (!ref.current || e.source !== ref.current.contentWindow) return;
      const data = e.data as { type?: string; msg?: string; message?: string } | null;
      if (!data || typeof data !== 'object') return;
      if (data.type === 'ready') {
        readyRef.current = true;
        if (ref.current.contentWindow && pendingRef.current.length) {
          for (const p of pendingRef.current) {
            ref.current.contentWindow.postMessage(p, '*');
          }
          pendingRef.current = [];
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
    postOrQueue({
      type: 'setModel',
      partCode,
      dimensions,
      linkedParts: linkedPartsData,
      viewType: viewType ?? (mode === '2d' ? 'Front2D' : 'ISO'),
      dimMeta: dimMeta ?? {},
    });
    // postOrQueue is a stable helper; excluded from deps to avoid thrash.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partCode, dimensions, viewType, mode, linkedPartsData, dimMeta]);

  // Toggle the dim panel without re-rendering the model. Goes through
  // the same queue as setModel so the panel state survives the iframe
  // remount that happens on 2D↔3D switch — without this the panel
  // flipped OFF and the user had to re-check every time.
  useEffect(() => {
    postOrQueue({ type: 'setOption', option: 'dimPanel', value: !!showDimPanel });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showDimPanel, mode]);

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
