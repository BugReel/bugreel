import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDB, getDB } from './db.js';
import { config } from './config.js';
import uploadRouter from './routes/upload.js';
import chunkedUploadRouter from './routes/chunked-upload.js';
import recordingsRouter from './routes/recordings.js';
import cardsRouter from './routes/cards.js';
import keyframesRouter from './routes/keyframes.js';
import analyticsRouter from './routes/analytics.js';
import videoCommentsRouter from './routes/video-comments.js';
import settingsRouter, { getBrandingConfig } from './routes/settings.js';
import { renderSharePage } from './services/share-meta.js';
import embedRouter from './routes/embed.js';
import { retryStuckRecordings } from './services/pipeline.js';
import { startCleanupTimer } from './services/chunked-upload.js';
import { authGuard, authRouter, handleLegacyLogin, handleLogout } from './auth.js';
import { handleGetLicense } from './license.js';
import passwordRouter from './routes/password.js';
import ctaRouter from './routes/cta.js';
import feedbackRouter from './routes/feedback.js';
import { passwordCheckPage, passwordCheckAPI, passwordCheckData } from './middleware/password-check.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dashboardDir = path.join(__dirname, '..', 'dashboard');

const app = express();

app.use(express.json({ limit: '50mb' }));

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
app.use('/api', chunkedUploadRouter);
app.use('/api', recordingsRouter);
app.use('/api', cardsRouter);
app.use('/api', keyframesRouter);
app.use('/api', analyticsRouter);
app.use('/api', videoCommentsRouter);
app.use('/api', settingsRouter);
app.use('/api', passwordRouter);
app.use('/api', ctaRouter);
app.use('/api', feedbackRouter);

// Serve extension files for download
app.use('/extension', express.static(path.join(__dirname, '..', 'extension')));

// Static: dashboard assets (css, js)
app.use(express.static(dashboardDir));

// Static: dashboard assets ALSO mounted at /share/ and /report/ so report.html
// (loaded at /share/{token}) can use relative ./css/ and ./js/ paths that
// resolve into the same physical assets without leaving the public prefix.
// This matters in front-of-proxy deployments where /css/ at the root might
// not be exposed (e.g. an upstream gateway that only forwards /share/* to
// this server). Mount before the SPA catch-all so /share/css/style.css
// serves the file, and only /share/{anything-else} falls through to
// report.html.
app.use('/share', express.static(dashboardDir));
app.use('/report', express.static(dashboardDir));

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
  if (req.path.startsWith('/share/') || req.path.startsWith('/report/')) {
    // Public share page (/share/) — canonical since 1.7.5. Old /report/
    // links still work for already-shared URLs, no redirect (avoids breaking
    // analytics referrers and chat-app link previews on existing sends).
    //
    // If accessed by recording ID, redirect to share_token URL on the same
    // prefix the user came in on. If accessed by share_token (UUID) or
    // unknown value, serve the page normally — report.html handles 404.
    const prefix = req.path.startsWith('/share/') ? '/share/' : '/report/';
    const rawId = req.path.replace(prefix, '').replace(/\/$/, '');
    if (rawId) {
      const paramId = decodeURIComponent(rawId);
      const db = getDB();
      const recording = db.prepare('SELECT * FROM recordings WHERE id = ?').get(paramId)
        || db.prepare('SELECT * FROM recordings WHERE share_token = ?').get(paramId);
      if (recording && recording.share_token && recording.id === paramId) {
        // Accessed by raw recording ID — canonicalize to the share_token URL.
        return res.redirect(301, `${prefix}${encodeURIComponent(recording.share_token)}`);
      }
      // Server-render per-recording OG/Twitter meta tags into report.html so
      // chat-app link previews (Telegram, Slack, iMessage, WhatsApp) show the
      // recording's real title/thumbnail instead of the generic "BugReel"
      // shell — those crawlers read <head> as delivered, before any client
      // JS runs. Password-protected recordings never reach this point for an
      // unauthenticated visitor: passwordCheckPage (mounted above) already
      // intercepted the request and served the password prompt instead.
      if (recording) {
        try {
          const card = db.prepare('SELECT title, summary FROM cards WHERE recording_id = ?').get(recording.id);
          let thumbnailFrameFilename = null;
          if (!recording.thumbnail_filename) {
            const anyFrame = db.prepare('SELECT filename FROM frames WHERE recording_id = ? AND filename IS NOT NULL ORDER BY time_seconds LIMIT 1').get(recording.id);
            thumbnailFrameFilename = anyFrame?.filename || null;
          }
          const html = renderSharePage({
            recording,
            card,
            branding: getBrandingConfig(),
            dashboardDir,
            dashboardUrl: config.dashboardUrl,
            req,
            shareToken: paramId,
            thumbnailFrameFilename,
          });
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          return res.send(html);
        } catch (err) {
          console.warn(`[share-meta] falling back to static report.html for ${paramId}: ${err.message}`);
        }
      }
    }
    return res.sendFile(path.join(dashboardDir, 'report.html'));
  }
  if (req.path === '/cards') {
    return res.sendFile(path.join(dashboardDir, 'cards.html'));
  }
  if (req.path === '/analytics') {
    return res.sendFile(path.join(dashboardDir, 'analytics.html'));
  }
  if (req.path === '/record') {
    return res.sendFile(path.join(dashboardDir, 'record.html'));
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
  // Start chunked upload cleanup timer
  startCleanupTimer();
});
