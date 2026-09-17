import path from 'path';
import { getDB } from '../db.js';
import { config } from '../config.js';
import { getBrandingConfig } from './settings.js';
import { renderSharePage } from '../services/share-meta.js';

/**
 * Handles the /share/{id} and /report/{id} public routes: 301-canonicalizes
 * recording-ID URLs to their share_token, server-renders per-recording OG/
 * Twitter meta tags (see share-meta.js), and falls back to the static
 * report.html for unknown tokens or on render failure.
 *
 * Factored out of server/index.js's app.get('*') catch-all so tests can
 * exercise the exact same code path instead of a duplicated fixture — see
 * server/__tests__/routes/share-routes.test.js.
 *
 * @param {string} dashboardDir - absolute path to dashboard/
 * @returns {(req, res) => void} express handler; assumes req.path already
 *   matched /share/ or /report/.
 */
export function createSharePageHandler(dashboardDir) {
  return function sharePageHandler(req, res) {
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
      // unauthenticated visitor: passwordCheckPage (mounted above in
      // server/index.js) already intercepted the request and served the
      // password prompt instead.
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
  };
}
