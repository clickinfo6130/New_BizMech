/**
 * BizMech Proxy — Express HTTP server that bridges the React frontend to
 * the PostgreSQL Spec database at 192.168.0.17.
 *
 * Temporary until the Java backend is deployed. The endpoint contract
 * here is the authoritative source for the Java team — see openapi.yaml.
 */
import 'dotenv/config';
import express from 'express';
import cors from 'cors';

import { listDatabases, ping, primaryDbName, shutdown } from './db.js';
import authRouter from './routes/auth.js';
import categoriesRouter from './routes/categories.js';
import partsRouter from './routes/parts.js';
import searchRouter from './routes/search.js';
import downloadRouter from './routes/download.js';
import diagRouter from './routes/diag.js';

const {
  PORT = '8080',
  CORS_ORIGIN = 'http://localhost:5173',
  LOG_LEVEL = 'pretty',
} = process.env;

const app = express();
app.disable('x-powered-by');

app.use(
  cors({
    origin: CORS_ORIGIN.split(',').map((s) => s.trim()),
    credentials: false,
  }),
);
app.use(express.json({ limit: '1mb' }));

// Tiny request log
if (LOG_LEVEL !== 'silent') {
  app.use((req, _res, next) => {
    // eslint-disable-next-line no-console
    console.log(`→ ${req.method} ${req.originalUrl}`);
    next();
  });
}

// ── Health ───────────────────────────────────────
app.get('/health', async (_req, res) => {
  const p = await ping();
  res.status(p.ok ? 200 : 503).json({
    service: 'bizmech-proxy',
    version: '0.3.0',
    primary: primaryDbName(),
    databases: listDatabases(),
    db: p,
    time: new Date().toISOString(),
  });
});

// ── Routes ───────────────────────────────────────
app.use('/api/auth', authRouter);
app.use('/api', categoriesRouter);
app.use('/api', partsRouter);
app.use('/api', searchRouter);
app.use('/api', downloadRouter);
app.use('/', diagRouter);

// ── 404 / error handler ──────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'not_found', path: req.originalUrl });
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    // eslint-disable-next-line no-console
    console.error('[proxy] error:', err);
    res.status(500).json({ error: 'internal', message: err.message });
  },
);

// ── Boot ─────────────────────────────────────────
const port = Number(PORT);
app.listen(port, async () => {
  // eslint-disable-next-line no-console
  console.log('');
  // eslint-disable-next-line no-console
  console.log(`  BizMech Proxy listening on http://localhost:${port}`);
  // eslint-disable-next-line no-console
  console.log(`  CORS origin: ${CORS_ORIGIN}`);
  // eslint-disable-next-line no-console
  console.log(
    `  Registered DBs (${listDatabases().length}): ${listDatabases().join(', ')}  ` +
      `[primary=${primaryDbName()}]`,
  );
  const p = await ping();
  for (const r of p.results) {
    const pad = ' '.repeat(Math.max(0, 14 - r.db.length));
    // eslint-disable-next-line no-console
    console.log(`  Postgres [${r.db}]${pad}${r.status}`);
  }
  // eslint-disable-next-line no-console
  console.log('');
});

// Graceful shutdown — close every pool on SIGTERM / SIGINT.
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.once(sig, () => {
    // eslint-disable-next-line no-console
    console.log(`\n[proxy] ${sig} received — closing pools…`);
    void shutdown().finally(() => process.exit(0));
  });
}
