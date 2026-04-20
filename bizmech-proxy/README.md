# BizMech Proxy

Node.js REST proxy that bridges the React frontend to the PostgreSQL
Spec database at `192.168.0.17`. Temporary until the Java backend is
deployed — see [`openapi.yaml`](./openapi.yaml) for the endpoint contract
the Java team should implement.

## Quick start

```bash
# 1. install
cd bizmech-proxy
npm install

# 2. configure (copy .env.example → .env and fill in the values)
#    .env is gitignored; never commit real credentials

# 3. run
npm run dev     # hot-reload via tsx watch
# or
npm start       # one-shot
```

On success you should see:

```
  BizMech Proxy listening on http://localhost:8080
  CORS origin: http://localhost:5173
  Postgres: OK — connected to <db> — PostgreSQL 14.x
```

Visit <http://localhost:8080/health> to verify.

## Environment variables

| Name | Default | Purpose |
|---|---|---|
| `PORT` | `8080` | HTTP port |
| `CORS_ORIGIN` | `http://localhost:5173` | Comma-separated allowed origins |
| `PG_HOST` | `192.168.0.17` | Postgres host |
| `PG_PORT` | `5432` | Postgres port |
| `PG_USER` | — | Postgres user |
| `PG_PASSWORD` | — | Postgres password |
| **`PG_DATABASES`** | `Standard_Core,Motor_Core` | ★ Comma list of registered DBs — add new categories here |
| **`PG_PRIMARY_DB`** | `Standard_Core` | DB that holds maincategory / subcategory / midcategory / parttype |
| `PG_DB_ALIASES` | `std:Standard_Core,motor:Motor_Core` | Friendly aliases for `/diag/*?db=std` |
| `PG_POOL_MAX` | `10` | Max pool connections (per DB) |
| `PG_SSL` | `false` | `true` to enable SSL |
| `LOG_LEVEL` | `pretty` | `pretty` \| `silent` \| `raw` |

## Adding a new category database

To add `Cylinder_Core`, `LmGuide_Core`, etc. without touching code, see
**[`docs/ADD_NEW_DATABASE.md`](docs/ADD_NEW_DATABASE.md)** — a 5-step
walkthrough (`CREATE DATABASE` → schema migration → data load → register
in `Standard_Core.maincategory` → bump `PG_DATABASES`).

## Finding the DB name

The spec docs don't list the actual Postgres database name. Try common
candidates in `.env`:

```
PG_DATABASE=spec
# or
PG_DATABASE=specdb
# or
PG_DATABASE=partmanager
# or
PG_DATABASE=postgres       # then use schema-qualified queries
```

If the first attempt fails with `database does not exist`, connect with
`psql` and list available databases:

```bash
psql -h 192.168.0.17 -U clickinfo -d postgres -c "\l"
```

## Connecting the frontend to this proxy

In `BizMech-web/.env.local` (copy from `.env.example`):

```
VITE_API_MODE=http
VITE_API_BASE_URL=http://localhost:8080/api
```

Restart the Vite dev server. The frontend now talks to Postgres via this
proxy instead of the bundled SQLite mock.

## Endpoints

See [`openapi.yaml`](./openapi.yaml) for the full contract. Summary:

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/auth/login` | Placeholder login (no real backing store) |
| GET | `/api/auth/me` | Whoami |
| POST | `/api/auth/logout` | Invalidate |
| GET | `/api/categories/main` | Top-level categories (STANDARD / MOTOR only) |
| GET | `/api/categories/sub` | Subcategories |
| GET | `/api/categories/mid` | Mid categories |
| GET | `/api/parttypes` | Part types under a mid category |
| GET | `/api/motor/parts` | Motor parts under a motor subcategory |
| GET | `/api/parts/:code/spec` | Spec JSON for a part |
| GET | `/api/parts/:code/dimension-meta` | Dimensionmeta rows |
| GET | `/api/parts/:code/dimension-keys` | Dimensionkeyoption rows |
| POST | `/api/parts/:code/dimension/find` | Resolve partdimension row by keyValues |
| GET | `/api/parts/find?q=` | Look up by name or partCode (linked parts) |
| GET | `/api/search?orderCode=` | Order-code search |
| POST | `/api/download` | Placeholder CAD download |
| GET | `/health` | Connectivity check |

## Handover to the Java team

1. Share [`openapi.yaml`](./openapi.yaml) with the Java developer.
2. They generate server stubs (e.g. `openapi-generator-cli generate
   -i openapi.yaml -g spring -o java-backend`) or implement by hand.
3. Every JSON shape must match the TypeScript types in
   `BizMech-web/src/types/index.ts`.
4. When the Java backend is live, the frontend flips
   `VITE_API_BASE_URL` to point at it — no code changes needed.

## Security

- **Never** commit `.env` (it's gitignored).
- Rotate `PG_PASSWORD` regularly.
- Restrict `CORS_ORIGIN` to known frontend hosts in production.
- Run behind a TLS-terminating reverse proxy (nginx / Caddy) before
  exposing beyond a LAN.
- The `/api/download` route currently serves a placeholder text file;
  do not deploy as-is to production.
