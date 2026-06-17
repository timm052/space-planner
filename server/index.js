import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedIfEmpty } from './db.js';
import projectsRouter from './routes/projects.js';
import spacesRouter from './routes/spaces.js';
import adjacenciesRouter from './routes/adjacencies.js';
import snapshotsRouter from './routes/snapshots.js';
import imagesRouter from './routes/images.js';
import settingsRouter from './routes/settings.js';
import proxyRouter from './routes/proxy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json({ limit: '25mb' })); // background images arrive as data URLs

seedIfEmpty();

// Mount all API routes under /api.
// projects router uses relative '/' and '/:id' so mount at /api/projects.
// All other routers include the full resource path so they mount at /api.
app.use('/api/projects', projectsRouter);
app.use('/api', spacesRouter);
app.use('/api', adjacenciesRouter);
app.use('/api', snapshotsRouter);
app.use('/api', imagesRouter);
app.use('/api', settingsRouter);
app.use('/api', proxyRouter);

// Central error handler — catches anything thrown by route handlers.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// ---------- Static (production) ----------
if (process.env.NODE_ENV === 'production') {
  const dist = path.join(__dirname, '..', 'dist');
  app.use(express.static(dist));
  app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

export { app };

// Only start listening when run directly (node server/index.js), not when
// imported by tests (which start their own ephemeral-port server).
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const PORT =
    process.env.API_PORT ||
    (process.env.NODE_ENV === 'production' && process.env.PORT) ||
    3001;
  app.listen(PORT, () => {
    console.log(`BriefTrack API listening on http://localhost:${PORT}`);
  });
}
