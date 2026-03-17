import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDB } from './db.js';
import { config } from './config.js';
import uploadRouter from './routes/upload.js';
import recordingsRouter from './routes/recordings.js';
import cardsRouter from './routes/cards.js';
import keyframesRouter from './routes/keyframes.js';
import { retryStuckRecordings } from './services/pipeline.js';
import { authGuard, authRouter, handleLegacyLogin, handleLogout } from './auth.js';
import { handleGetLicense } from './license.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dashboardDir = path.join(__dirname, '..', 'dashboard');

const app = express();

app.use(express.json());

// CORS for extension
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Auth: legacy login/logout routes (before guard middleware)
app.post('/login', handleLegacyLogin);
app.post('/logout', handleLogout);

// Auth guard middleware (authenticate + enforce on protected routes)
app.use(authGuard);

// Auth API routes (login, register, invite, me, users, etc.)
app.use('/api', authRouter);

// License route
app.get('/api/license', handleGetLicense);

// API routes
app.use('/api', uploadRouter);
app.use('/api', recordingsRouter);
app.use('/api', cardsRouter);
app.use('/api', keyframesRouter);

// Serve extension files for download
app.use('/extension', express.static(path.join(__dirname, '..', 'extension')));

// Static: dashboard assets (css, js)
app.use(express.static(dashboardDir));

// Static: recordings data (video, frames)
app.use('/data', express.static(config.dataDir));

// SPA routing: serve HTML pages for dashboard routes
app.get('/login', (req, res) => {
  return res.sendFile(path.join(dashboardDir, 'login.html'));
});

app.get('*', (req, res) => {
  if (req.path.startsWith('/recording/')) {
    return res.sendFile(path.join(dashboardDir, 'recording.html'));
  }
  if (req.path.startsWith('/card/')) {
    return res.sendFile(path.join(dashboardDir, 'card.html'));
  }
  if (req.path.startsWith('/report/')) {
    return res.sendFile(path.join(dashboardDir, 'report.html'));
  }
  if (req.path === '/cards') {
    return res.sendFile(path.join(dashboardDir, 'cards.html'));
  }
  if (req.path === '/analytics') {
    return res.sendFile(path.join(dashboardDir, 'analytics.html'));
  }
  if (req.path === '/guide') {
    return res.sendFile(path.join(dashboardDir, 'guide.html'));
  }
  res.sendFile(path.join(dashboardDir, 'index.html'));
});

// Init DB and start
initDB();

app.listen(config.port, config.host, () => {
  console.log(`BugReel running on ${config.host}:${config.port}`);
  // Retry any stuck/incomplete recordings from previous runs
  retryStuckRecordings();
});
