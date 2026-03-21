import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDB, getDB } from './db.js';
import { config } from './config.js';
import uploadRouter from './routes/upload.js';
import recordingsRouter from './routes/recordings.js';
import cardsRouter from './routes/cards.js';
import keyframesRouter from './routes/keyframes.js';
import analyticsRouter from './routes/analytics.js';
import videoCommentsRouter from './routes/video-comments.js';
import settingsRouter from './routes/settings.js';
import embedRouter from './routes/embed.js';
import { retryStuckRecordings } from './services/pipeline.js';
import { authGuard, authRouter, handleLegacyLogin, handleLogout } from './auth.js';
import { handleGetLicense } from './license.js';
import passwordRouter from './routes/password.js';
import { passwordCheckPage, passwordCheckAPI, passwordCheckData } from './middleware/password-check.js';

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

// Embed routes (public, no auth required, allow iframe embedding)
app.use(embedRouter);

// Auth: legacy login/logout routes (before guard middleware)
app.post('/login', handleLegacyLogin);
app.post('/logout', handleLogout);

// Auth guard middleware (authenticate + enforce on protected routes)
app.use(authGuard);

// Auth API routes (login, register, invite, me, users, etc.)
app.use('/api', authRouter);

// License route
app.get('/api/license', handleGetLicense);

// Password protection: API-level check (before recording data routes)
app.use(passwordCheckAPI);

// API routes
app.use('/api', uploadRouter);
app.use('/api', recordingsRouter);
app.use('/api', cardsRouter);
app.use('/api', keyframesRouter);
app.use('/api', analyticsRouter);
app.use('/api', videoCommentsRouter);
app.use('/api', settingsRouter);
app.use('/api', passwordRouter);

// Serve extension files for download
app.use('/extension', express.static(path.join(__dirname, '..', 'extension')));

// Static: dashboard assets (css, js)
app.use(express.static(dashboardDir));

// Static: recordings data (video, frames) — with password protection
app.use('/data', passwordCheckData, express.static(config.dataDir));

// SPA routing: serve HTML pages for dashboard routes
app.get('/login', (req, res) => {
  return res.sendFile(path.join(dashboardDir, 'login.html'));
});

// Password protection: page-level check for /report/:id
app.use(passwordCheckPage);

app.get('*', (req, res) => {
  if (req.path.startsWith('/recording/')) {
    return res.sendFile(path.join(dashboardDir, 'recording.html'));
  }
  if (req.path.startsWith('/card/')) {
    return res.sendFile(path.join(dashboardDir, 'card.html'));
  }
  if (req.path.startsWith('/report/')) {
    // Public report page: if accessed by recording ID, redirect to share_token URL.
    // If accessed by share_token (UUID) or unknown value, serve the page normally.
    const rawId = req.path.replace('/report/', '').replace(/\/$/, '');
    if (rawId) {
      const paramId = decodeURIComponent(rawId);
      const db = getDB();
      // Check if this looks like a recording ID (not a UUID share_token)
      const recording = db.prepare('SELECT id, share_token FROM recordings WHERE id = ?').get(paramId);
      if (recording && recording.share_token) {
        // Redirect from enumerable ID to non-guessable share_token
        return res.redirect(301, `/report/${encodeURIComponent(recording.share_token)}`);
      }
      // If looked up by share_token, or recording not found — serve page normally
      // (report.html JS will handle the 404 display)
    }
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
  if (req.path === '/settings-page') {
    return res.sendFile(path.join(dashboardDir, 'settings-page.html'));
  }
  res.sendFile(path.join(dashboardDir, 'index.html'));
});

// Init DB and start
initDB();

// Sync tracker settings from DB to config (so youtrack.js picks them up)
try {
  const db = getDB();
  const getSetting = (key) => { const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key); return r?.value || ''; };
  const dbType = getSetting('tracker_type');
  if (dbType && dbType !== 'none') {
    config.youtrack.url = getSetting('tracker_url') || config.youtrack.url;
    config.youtrack.token = getSetting('tracker_token') || config.youtrack.token;
    config.youtrack.project = getSetting('tracker_project') || config.youtrack.project;
    console.log(`[settings] Tracker config loaded from DB: ${dbType} → ${config.youtrack.url}`);
  }
} catch (e) { /* settings table may not exist yet */ }

app.listen(config.port, config.host, () => {
  console.log(`BugReel running on ${config.host}:${config.port}`);
  // Retry any stuck/incomplete recordings from previous runs
  retryStuckRecordings();
});
