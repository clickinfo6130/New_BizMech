/**
 * BizMech ↔ PartManager viewer bridge
 * ─────────────────────────────────────────────
 * The original partRenderer.js / partRenderer2D.js were written for
 * WebView2 embedded in the WPF PartManager app. They:
 *   · read messages via `window.onCSharpMessage(msg)`
 *   · send messages via `window.chrome.webview.postMessage(msg)`
 *
 * In our React web app the viewer runs inside an <iframe>. This script
 * shims both sides of that contract to use window.postMessage instead,
 * so the renderer code can stay 100 % untouched and continue to be
 * maintained by the PartManager team.
 *
 * Protocol with the React parent:
 *   parent → iframe  { type:'setModel', partCode, dimensions, linkedParts, viewType }
 *                    { type:'setView',  viewType }
 *                    { type:'setOption', option, value }
 *                    { type:'resize' }
 *   iframe → parent  { type:'ready' }          (once the renderer calls sendToCSharp({type:'ready'}))
 *                    { type:'log', message }   (from logToCSharp)
 *                    … any other native-side payloads
 *
 * This file must be loaded BEFORE the renderer scripts.
 */
(function () {
  if (typeof window === 'undefined') return;

  // 1) Fake WebView2 host so sendToCSharp → parent.postMessage
  if (!window.chrome) window.chrome = {};
  if (!window.chrome.webview) {
    window.chrome.webview = {
      postMessage: function (msg) {
        try {
          window.parent.postMessage(msg, '*');
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn('[bridge] postMessage failed', e);
        }
      },
      addEventListener: function () {},
      removeEventListener: function () {},
    };
  }

  // 2) Route parent → iframe messages to the existing onCSharpMessage handler.
  window.addEventListener('message', function (e) {
    const d = e && e.data;
    if (!d || typeof d !== 'object') return;

    // Normalise our friendly types back to the original "command" schema
    // the renderer expects.
    if (d.type === 'setModel') {
      callHandler({
        command: 'updateModel',
        partCode: d.partCode,
        dimensions: d.dimensions || {},
        linkedParts: d.linkedParts || [],
        viewType: d.viewType,
      });
    } else if (d.type === 'setView') {
      callHandler({ command: 'setView', view: d.viewType });
    } else if (d.type === 'setOption') {
      callHandler({ command: 'setOption', option: d.option, value: d.value });
    } else if (d.type === 'resize') {
      callHandler({ command: 'resize' });
    } else if (d.command) {
      // already a native-schema message — pass through
      callHandler(d);
    }
  });

  function callHandler(payload) {
    try {
      if (typeof window.onCSharpMessage === 'function') {
        window.onCSharpMessage(payload);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[bridge] onCSharpMessage threw', err);
    }
  }
})();
