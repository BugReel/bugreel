/**
 * Public share-page routes — /share/ canonical, /report/ legacy alias.
 *
 * Since extension 1.7.5 the canonical public share path is /share/{share_token}.
 * /report/ stays alive for backward compat with already-shared links — anyone
 * who copied a /report/ URL into Slack/email last year should still land on
 * the page. Both paths must:
 *   1. Serve report.html for share_token (UUID) lookups
 *   2. 301-redirect /{prefix}/{recording_id} → /{prefix}/{share_token}
 *      (don't cross prefixes — preserve referrer/analytics signals)
 *   3. Be reachable without authentication
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { cleanupTestData } from '../setup.js';
import { initDB, getDB } from '../../db.js';

let server, baseUrl;

beforeAll(async () => {
  initDB();

  // Seed a recording with a known share_token
  const db = getDB();
  db.prepare(
    `INSERT OR REPLACE INTO recordings (id, author, share_token, status, video_filename)
     VALUES (?, ?, ?, 'uploaded', 'video.webm')`
  ).run('REC-SHARE-TEST-001', 'tester', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');

  // Spin up the same /share/ + /report/ handler as server/index.js, in
  // isolation so we don't pull in pipeline/ffmpeg/multer side effects.
  const app = express();
  const path = await import('path');
  const url = await import('url');
  const __filename = url.fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const dashboardDir = path.join(__dirname, '..', '..', '..', 'dashboard');

  app.get('*', (req, res) => {
    if (req.path.startsWith('/share/') || req.path.startsWith('/report/')) {
      const prefix = req.path.startsWith('/share/') ? '/share/' : '/report/';
      const rawId = req.path.replace(prefix, '').replace(/\/$/, '');
      if (rawId) {
        const paramId = decodeURIComponent(rawId);
        const rec = getDB().prepare('SELECT id, share_token FROM recordings WHERE id = ?').get(paramId);
        if (rec && rec.share_token) {
          return res.redirect(301, `${prefix}${encodeURIComponent(rec.share_token)}`);
        }
      }
      return res.sendFile(path.join(dashboardDir, 'report.html'));
    }
    res.status(404).send('not found');
  });

  await new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  try { getDB().close(); } catch {}
  cleanupTestData();
});

describe('share/report public routes', () => {
  it('GET /share/{share_token} serves report.html (200)', async () => {
    const res = await fetch(`${baseUrl}/share/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toMatch(/<html|<!DOCTYPE/i);
  });

  it('GET /report/{share_token} also serves report.html (200, legacy alias)', async () => {
    const res = await fetch(`${baseUrl}/report/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toMatch(/<html|<!DOCTYPE/i);
  });

  it('GET /share/{recording_id} 301s to /share/{share_token}', async () => {
    const res = await fetch(`${baseUrl}/share/REC-SHARE-TEST-001`, { redirect: 'manual' });
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe('/share/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  });

  it('GET /report/{recording_id} 301s to /report/{share_token} (no cross-prefix)', async () => {
    // Redirect target must keep /report/ — don't cross prefixes — so
    // analytics referrers and link-preview caches stay consistent.
    const res = await fetch(`${baseUrl}/report/REC-SHARE-TEST-001`, { redirect: 'manual' });
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe('/report/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  });

  it('GET /share/unknown-token serves report.html (404 handled client-side)', async () => {
    const res = await fetch(`${baseUrl}/share/00000000-0000-0000-0000-000000000000`);
    expect(res.status).toBe(200);
  });
});
