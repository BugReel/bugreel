// SCOPE_BY_USER is evaluated when recordings.js is loaded. ES-module imports
// hoist above top-level statements, so we must set the env var first AND defer
// the recordings.js load until inside beforeAll via dynamic import.
process.env.TRUST_PROXY_AUTH = 'true';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import crypto from 'crypto';
import { cleanupTestData } from '../setup.js';
import { initDB, getDB } from '../../db.js';

let server, baseUrl;

beforeAll(async () => {
  initDB();
  const { default: recordingsRouter } = await import('../../routes/recordings.js');
  const app = express();
  app.use(express.json());
  // Minimal stand-in for authenticateRequest — trust X-User-Id directly,
  // auto-create the user row, exactly like the Cloud Layer reverse proxy does.
  app.use((req, _res, next) => {
    const uid = req.headers['x-user-id'];
    if (uid) {
      const db = getDB();
      let user = db.prepare('SELECT * FROM users WHERE id = ?').get(uid);
      if (!user) {
        db.prepare(
          "INSERT OR IGNORE INTO users (id, name, email, auth_provider, role) VALUES (?, ?, ?, 'proxy', 'admin')"
        ).run(uid, req.headers['x-user-name'] || 'User', `${uid}@proxy.local`);
        user = db.prepare('SELECT * FROM users WHERE id = ?').get(uid);
      }
      req.user = user;
    }
    next();
  });
  app.use('/api', recordingsRouter);

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

function insertRecording(userId, label, transcript = null) {
  const db = getDB();
  const id = `rec-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const shareToken = crypto.randomUUID();
  db.prepare(
    `INSERT INTO recordings (id, author, user_id, status, share_token, transcript_json)
     VALUES (?, ?, ?, 'complete', ?, ?)`
  ).run(id, userId ? `display-${label}` : 'Guest', userId, shareToken, transcript);
  return { id, shareToken };
}

describe('Recordings — owner isolation (proxy mode)', () => {
  let alice, bob, aliceRec, bobRec, legacyRec;

  beforeAll(() => {
    alice = 'user-alice-' + Date.now();
    bob = 'user-bob-' + Date.now();
    aliceRec = insertRecording(alice, 'alice', JSON.stringify({
      text: 'hi there',
      words: [
        { word: 'hi', start: 0, end: 0.5 },
        { word: 'there', start: 0.5, end: 1.0 },
      ],
    }));
    bobRec = insertRecording(bob, 'bob');
    legacyRec = insertRecording(null, 'legacy');
  });

  it('LIST returns only the requesting user\'s recordings', async () => {
    const r = await fetch(`${baseUrl}/api/recordings`, { headers: { 'X-User-Id': alice } });
    expect(r.status).toBe(200);
    const body = await r.json();
    const ids = body.recordings.map((x) => x.id);
    expect(ids).toContain(aliceRec.id);
    expect(ids).not.toContain(bobRec.id);
    expect(ids).not.toContain(legacyRec.id);
  });

  it('LIST rejects unauthenticated callers in proxy mode', async () => {
    const r = await fetch(`${baseUrl}/api/recordings`);
    expect(r.status).toBe(401);
  });

  it('GET /:id by id requires ownership (404 for non-owner)', async () => {
    const ok = await fetch(`${baseUrl}/api/recordings/${aliceRec.id}`, {
      headers: { 'X-User-Id': alice },
    });
    expect(ok.status).toBe(200);

    const denied = await fetch(`${baseUrl}/api/recordings/${aliceRec.id}`, {
      headers: { 'X-User-Id': bob },
    });
    expect(denied.status).toBe(404);
  });

  it('GET /by-token/:token works for any caller (public share)', async () => {
    const r = await fetch(`${baseUrl}/api/recordings/by-token/${aliceRec.shareToken}`, {
      headers: { 'X-User-Id': bob },
    });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.recording.id).toBe(aliceRec.id);
  });

  it('GET /:id resolves share_token without auth (legacy /report path)', async () => {
    const r = await fetch(`${baseUrl}/api/recordings/${aliceRec.shareToken}`);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.recording.id).toBe(aliceRec.id);
  });

  it('GET /:id/subtitles.vtt: share_token = public, id = owner-only', async () => {
    const pub = await fetch(`${baseUrl}/api/recordings/${aliceRec.shareToken}/subtitles.vtt`);
    expect(pub.status).toBe(200);

    const denied = await fetch(`${baseUrl}/api/recordings/${aliceRec.id}/subtitles.vtt`, {
      headers: { 'X-User-Id': bob },
    });
    expect(denied.status).toBe(404);

    const owner = await fetch(`${baseUrl}/api/recordings/${aliceRec.id}/subtitles.vtt`, {
      headers: { 'X-User-Id': alice },
    });
    expect(owner.status).toBe(200);
  });

  it('PUT /:id/transcript denies non-owners', async () => {
    const r = await fetch(`${baseUrl}/api/recordings/${aliceRec.id}/transcript`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-User-Id': bob },
      body: JSON.stringify({ words: [{ word: 'evil', start: 0, end: 1 }] }),
    });
    expect(r.status).toBe(404);
  });

  it('PUT /:id/context denies non-owners', async () => {
    const r = await fetch(`${baseUrl}/api/recordings/${aliceRec.id}/context`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-User-Id': bob },
      body: JSON.stringify({ url_events: [] }),
    });
    expect(r.status).toBe(404);
  });

  it('DELETE /:id denies non-owners and leaves the row intact', async () => {
    const r = await fetch(`${baseUrl}/api/recordings/${aliceRec.id}`, {
      method: 'DELETE',
      headers: { 'X-User-Id': bob },
    });
    expect(r.status).toBe(404);
    const still = getDB().prepare('SELECT id FROM recordings WHERE id = ?').get(aliceRec.id);
    expect(still).toBeTruthy();
  });

  it('legacy NULL-user_id recordings are invisible after migration', async () => {
    const r = await fetch(`${baseUrl}/api/recordings/${legacyRec.id}`, {
      headers: { 'X-User-Id': alice },
    });
    expect(r.status).toBe(404);
  });
});
