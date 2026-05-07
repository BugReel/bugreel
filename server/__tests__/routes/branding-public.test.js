/**
 * GET /api/branding must be reachable without authentication.
 *
 * The anonymous share page (/share/{token}) fetches /api/branding to populate
 * the document title and header logo. If the auth guard 401s this endpoint
 * for anonymous viewers, the tab title is stuck on the framework default
 * (e.g. "BugReel") instead of the deployment's brand name. Regression check
 * for the bug surfaced 2026-05-06 on skrini.ru in incognito mode.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { cleanupTestData } from '../setup.js';
import { initDB, getDB } from '../../db.js';
import { authGuard } from '../../auth.js';
import settingsRouter from '../../routes/settings.js';

let server, baseUrl;

beforeAll(async () => {
  initDB();

  // Seed brand name + logo so the response payload is non-empty
  const db = getDB();
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('branding_name', 'TestBrand');
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('branding_logo_url', 'https://example.com/logo.png');

  const app = express();
  app.use(express.json());
  app.use(authGuard);
  app.use('/api', settingsRouter);

  await new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  try {
    const db = getDB();
    db.prepare("DELETE FROM settings WHERE key IN ('branding_name', 'branding_logo_url')").run();
    db.close();
  } catch {}
  cleanupTestData();
});

describe('GET /api/branding (public)', () => {
  it('responds 200 to anonymous requests (no Authorization header)', async () => {
    const res = await fetch(`${baseUrl}/api/branding`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe('TestBrand');
    expect(body.logo_url).toBe('https://example.com/logo.png');
  });

  it('still returns the public branding shape (name, logo_url, logo_link) — not raw branding_* keys', async () => {
    // Field names are flat ({name, logo_url}) so report.html can read them
    // directly. /api/settings exposes the raw branding_* keys but is owner-only.
    const res = await fetch(`${baseUrl}/api/branding`);
    const body = await res.json();
    expect(body).toHaveProperty('name');
    expect(body).toHaveProperty('logo_url');
    expect(body).toHaveProperty('logo_link');
    expect(body).not.toHaveProperty('branding_name');
    expect(body).not.toHaveProperty('branding_logo_url');
  });
});
