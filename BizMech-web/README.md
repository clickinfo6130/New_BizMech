# BizMech (Web)

**BizMech** is the web edition of the PartManager CAD-plugin tool. Users browse
a mechanical-part catalog, pick spec/option/dimension values, preview the
result in 2D & 3D, and download CAD files (STEP / DWG / IGES / STL).

This repository is the **frontend** only. A Java + PostgreSQL backend is
planned; the frontend ships with a drop-in mock implementation (sql.js)
that reads the real `Standard_Core.db` / `Motor_Core.db` files shipped from
PartManager, so you can run the whole app offline.

## Tech stack

| Layer | Choice |
|---|---|
| Build / dev | Vite 5 |
| Framework | React 18 + TypeScript |
| Styling | Tailwind CSS 3 (shadcn-style primitives in `src/components/ui`) |
| State | Zustand |
| Data fetching | TanStack Query |
| Routing | React Router v6 |
| i18n | react-i18next (ko / en / ja / zh) |
| Mock DB | sql.js (SQLite → WebAssembly) |
| HTTP client | Axios (used only in `HttpPartApi`) |
| 2D preview | `public/viewers/viewer2D.html` + `partRenderer2D.js` (reused as-is) |
| 3D preview | `public/viewers/viewer.html` + `partRenderer.js` (three.js, reused as-is) |

## Architecture

```
┌───────────────────────────────────────────────────────────┐
│  React UI (pages, components, stores)                     │
└──────────────────────┬────────────────────────────────────┘
                       │ IPartApi
┌──────────────────────▼────────────────────────────────────┐
│  Services layer — swap via VITE_API_MODE                   │
│   · MockPartApi   → sql.js reads /public/data/*.db         │
│   · HttpPartApi   → Axios → Java REST                      │
└──────────────────────┬────────────────────────────────────┘
                       │
             Java backend (future) + PostgreSQL
```

`IPartApi` (`src/services/api/IPartApi.ts`) is the hard contract. When the
Java team starts work, they implement exactly those endpoints and the
frontend flips `VITE_API_MODE=http` — no UI code changes.

### The 2D / 3D viewers

The original PartManager viewers were built for WebView2 inside a WPF host.
We copy them verbatim into `public/viewers/` and add
`public/viewers/js/bridge.js`, a tiny shim that:

1. fakes `window.chrome.webview.postMessage` → `parent.postMessage`
2. forwards parent `postMessage` events to `window.onCSharpMessage`

React talks to the iframes via:

```ts
// parent → iframe
iframe.contentWindow.postMessage({
  type: 'setModel',
  partCode: 'HBOLT',
  dimensions: { M: 10, Length_max: 40, ... },
  viewType: 'Front2D',
}, '*');
```

This keeps the 5 900 lines of renderer code untouched and lets the
PartManager team keep maintaining a single codebase.

## Directory layout

```
BizMech-web/
├─ public/
│  ├─ viewers/                ← 2D/3D viewer assets (drop-in from PartManager)
│  └─ data/                   ← SQLite files used by MockPartApi
├─ src/
│  ├─ components/
│  │  ├─ category/            ← 4-level category tree
│  │  ├─ spec/                ← DynamicSpecForm
│  │  ├─ dimension/           ← cascading key dropdowns
│  │  ├─ preview/             ← iframe wrapper + tabs
│  │  ├─ download/            ← STEP/DWG/IGES/STL buttons
│  │  ├─ layout/              ← TopBar, AppLayout, LangSwitcher
│  │  └─ ui/                  ← Button, Card, Input, Select, Spinner
│  ├─ pages/                  ← LoginPage, MainPage, OrderCodeSearchPage, …
│  ├─ services/api/           ← IPartApi + Mock/Http implementations + factory
│  ├─ store/                  ← Zustand stores (auth, selection)
│  ├─ i18n/                   ← react-i18next setup + 4 locale files
│  ├─ types/                  ← shared domain types (mirror the DB)
│  └─ utils/
└─ package.json
```

## Getting started

```bash
# install
npm install

# dev server (http://localhost:5173, LAN-accessible for mobile testing)
npm run dev

# type-check
npm run lint

# production build
npm run build
npm run preview
```

### Environment variables

Copy `.env.example` → `.env`:

| Var | Meaning |
|---|---|
| `VITE_API_MODE` | `mock` (default, sql.js) or `http` (Java backend) |
| `VITE_API_BASE_URL` | backend base URL when `VITE_API_MODE=http` |
| `VITE_DEFAULT_LANG` | `ko` \| `en` \| `ja` \| `zh` |

## Wiring the Java backend

Once the backend is ready:

1. Flip `VITE_API_MODE=http` and point `VITE_API_BASE_URL` at it.
2. Implement the routes expected by `HttpPartApi` (`src/services/api/HttpPartApi.ts`):
   - `POST /auth/login`, `GET /auth/me`, `POST /auth/logout`
   - `GET /categories/main`, `GET /categories/sub?mainCatCode=…`, `GET /categories/mid?subCatCode=…`
   - `GET /parttypes?midCatCode=…`
   - `GET /parts/:partCode/spec`
   - `GET /parts/:partCode/dimension-meta`
   - `GET /parts/:partCode/dimension-keys`
   - `POST /parts/:partCode/dimension/find` with body `{keyValues}`
   - `GET /search?orderCode=…`
   - `POST /download` with body `DownloadRequest`
3. The JSON shapes MUST match the types in `src/types/index.ts`.

That's it — no UI code to change.

## Licensing / attribution

`public/viewers/js/partRenderer.js`, `partRenderer2D.js`, `three.module.js`,
`OrbitControls.js`, `CSS2DRenderer.js` and the accompanying CSS are reused
from the PartManager project. They retain their original ownership and
license.
