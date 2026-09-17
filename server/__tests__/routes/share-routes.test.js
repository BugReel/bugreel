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
 *
 * Uses the real handler from server/routes/share-page.js (the same one
 * server/index.js's catch-all delegates to) rather than a re-implemented
 * fixture, so every branch it takes — including the og:image fallback via
 * `frames` — is the branch production actually runs.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { cleanupTestData } from '../setup.js';
import { initDB, getDB } from '../../db.js';
import { createSharePageHandler } from '../../routes/share-page.js';

let server, baseUrl;
const FRAME_TOKEN = 'ffffffff-1111-2222-3333-444444444444';
const THUMB_TOKEN = 'tttttttt-1111-2222-3333-444444444444';
const XSS_TOKEN = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeef';

beforeAll(async () => {
  initDB();

  const db = getDB();
  db.prepare(
    `INSERT OR REPLACE INTO recordings (id, author, share_token, status, video_filename, ai_title, ai_summary, ai_type)
     VALUES (?, ?, ?, 'uploaded', 'video.webm', ?, ?, ?)`
  ).run(
    'REC-SHARE-TEST-001', 'tester', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    'Login button does nothing', 'Clicking Login on the homepage produces no visible reaction.', 'bug'
  );

  // No thumbnail_filename, no frames row — og:image must be omitted rather
  // than a broken/guessed URL.
  db.prepare(
    `INSERT OR REPLACE INTO recordings (id, author, share_token, status, video_filename, ai_title, ai_summary, ai_type)
     VALUES (?, ?, ?, 'uploaded', 'video.webm', ?, ?, ?)`
  ).run(
    'REC-NO-THUMB-001', 'tester', 'nnnnnnnn-1111-2222-3333-444444444444',
    'No thumbnail recording', 'A recording with no thumbnail and no frames.', 'bug'
  );

  // No thumbnail_filename, but a frames row exists — og:image must build
  // from the earliest frame (server/routes/share-page.js's fallback query).
  db.prepare(
    `INSERT OR REPLACE INTO recordings (id, author, share_token, status, video_filename, ai_title, ai_summary, ai_type)
     VALUES (?, ?, ?, 'uploaded', 'video.webm', ?, ?, ?)`
  ).run(
    'REC-FRAME-001', 'tester', FRAME_TOKEN,
    'Recording with frame fallback', 'Uses a frame as the preview image.', 'bug'
  );
  db.prepare(
    `INSERT INTO frames (recording_id, time_seconds, filename) VALUES (?, ?, ?)`
  ).run('REC-FRAME-001', 2.5, 'frame-002.jpg');

  // thumbnail_filename set directly on the recording — takes precedence over
  // any frames row.
  db.prepare(
    `INSERT OR REPLACE INTO recordings (id, author, share_token, status, video_filename, ai_title, ai_summary, ai_type, thumbnail_filename)
     VALUES (?, ?, ?, 'uploaded', 'video.webm', ?, ?, ?, ?)`
  ).run(
    'REC-THUMB-001', 'tester', THUMB_TOKEN,
    'Recording with explicit thumbnail', 'Uses thumbnail_filename directly.', 'bug', 'thumb.jpg'
  );

  // Title containing a JS string-replace special pattern — must not splice
  // the rest of report.html into <head> (see share-meta.js absoluteUrl doc /
  // blocker on `.replace()` with a string replacement).
  db.prepare(
    `INSERT OR REPLACE INTO recordings (id, author, share_token, status, video_filename, ai_title, ai_summary, ai_type)
     VALUES (?, ?, ?, 'uploaded', 'video.webm', ?, ?, ?)`
  ).run(
    'REC-XSS-001', 'tester', XSS_TOKEN,
    "Crash on $' input", 'Title contains a $-prefixed replace pattern.', 'bug'
  );

  // Spin up the real handler in isolation so we don't pull in
  // pipeline/ffmpeg/multer side effects from the rest of server/index.js.
  const app = express();
  const path = await import('path');
  const url = await import('url');
  const __filename = url.fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const dashboardDir = path.join(__dirname, '..', '..', '..', 'dashboard');
  const sharePageHandler = createSharePageHandler(dashboardDir);

  app.get('*', (req, res) => {
    if (req.path.startsWith('/share/') || req.path.startsWith('/report/')) {
      return sharePageHandler(req, res);
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

  it('GET /share/{share_token} renders per-recording OG/Twitter meta tags server-side', async () => {
    const res = await fetch(`${baseUrl}/share/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee`);
    expect(res.status).toBe(200);
    const html = await res.text();

    // Title comes from ai_title (recording.ai_type is a BUG_LIKE type here,
    // so the card would win if one existed — no card was seeded, so ai_title
    // is the fallback, matching resolveShareContent()'s precedence).
    expect(html).toContain('<title>Login button does nothing — BugReel</title>');
    expect(html).toContain('<meta property="og:title" content="Login button does nothing">');
    expect(html).toContain('<meta property="og:description" content="Clicking Login on the homepage produces no visible reaction.">');
    expect(html).toContain('<meta property="og:site_name" content="BugReel">');
    expect(html).toContain('property="og:url" content="http://');
    expect(html).toContain('/share/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"');
    expect(html).toContain('<meta name="twitter:title" content="Login button does nothing">');
    // No thumbnail_filename and no frames row seeded for this recording — no
    // og:image should be emitted rather than a broken/guessed URL.
    expect(html).not.toContain('og:image');
  });

  it('GET /share/{share_token} omits og:image when there is no thumbnail and no frames', async () => {
    const res = await fetch(`${baseUrl}/share/nnnnnnnn-1111-2222-3333-444444444444`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toContain('og:image');
    expect(html).toContain('<meta name="twitter:card" content="summary">');
  });

  it('GET /share/{share_token} builds og:image from the earliest frame when thumbnail_filename is unset', async () => {
    const res = await fetch(`${baseUrl}/share/${FRAME_TOKEN}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(`<meta property="og:image" content="http://127.0.0.1`);
    expect(html).toContain(`/data/REC-FRAME-001/frames/frame-002.jpg"`);
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
  });

  it('GET /share/{share_token} builds og:image from thumbnail_filename when set', async () => {
    const res = await fetch(`${baseUrl}/share/${THUMB_TOKEN}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(`/data/REC-THUMB-001/frames/thumb.jpg"`);
  });

  it('GET /share/{share_token} escapes a title containing $-prefixed replace patterns', async () => {
    const res = await fetch(`${baseUrl}/share/${XSS_TOKEN}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(`<title>Crash on $' input — BugReel</title>`);
    // The rest of the template must survive intact — a string-replacer bug
    // would splice a $`/$'/$& match into the output and corrupt this.
    expect(html).toMatch(/<script/);
    expect(html).toMatch(/id="content"|id="app"/);
  });

  it('GET /share/{share_token} still ships the client-side app (script tags, report container)', async () => {
    const res = await fetch(`${baseUrl}/share/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee`);
    const html = await res.text();
    // Meta injection must not drop the rest of the SPA shell — the page
    // still needs to boot and render interactively for a human visitor.
    expect(html).toMatch(/<script/);
    expect(html).toMatch(/id="content"|id="app"/);
  });
});
