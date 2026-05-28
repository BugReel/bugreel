import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import { cleanupTestData } from '../setup.js';
import { initDB, getDB } from '../../db.js';
import {
  passwordCheckAPI,
  passwordCheckPage,
  passwordCheckData,
} from '../../middleware/password-check.js';

beforeAll(() => {
  initDB();
});

afterAll(() => {
  try { getDB().close(); } catch {}
  cleanupTestData();
});

// scrypt salt:hash, same scheme as routes/password.js
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function createProtectedRecording() {
  const db = getDB();
  const id = 'rec-pw-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
  const shareToken = crypto.randomUUID();
  db.prepare(`
    INSERT INTO recordings (id, author, status, share_token, password_hash)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, 'test-author', 'complete', shareToken, hashPassword('secret'));
  return { id, shareToken };
}

function makeRes() {
  return {
    statusCode: null,
    body: null,
    sent: null,
    status(c) { this.statusCode = c; return this; },
    json(o) { this.body = o; return this; },
    send(s) { this.sent = s; return this; },
  };
}

// The synthetic user authGuard injects for anonymous visitors behind the
// auth proxy (TRUST_PROXY_AUTH=true). It must NOT defeat the password gate.
const SYNTHETIC_USER = { id: 'proxy-user', role: 'admin', synthetic: true };
const REAL_USER = { id: 'real-user', role: 'admin' };

describe('password-check middleware — synthetic proxy user must not bypass', () => {
  it('passwordCheckAPI: blocks synthetic user on protected recording (by id)', () => {
    const { id } = createProtectedRecording();
    let nextCalled = false;
    const res = makeRes();
    passwordCheckAPI(
      { method: 'GET', path: `/api/recordings/${id}`, headers: {}, user: SYNTHETIC_USER },
      res,
      () => { nextCalled = true; },
    );
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.body.password_protected).toBe(true);
  });

  it('passwordCheckAPI: gates the by-token endpoint (was previously exempt)', () => {
    const { shareToken } = createProtectedRecording();
    let nextCalled = false;
    const res = makeRes();
    passwordCheckAPI(
      { method: 'GET', path: `/api/recordings/by-token/${shareToken}`, headers: {}, user: SYNTHETIC_USER },
      res,
      () => { nextCalled = true; },
    );
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(403);
  });

  it('passwordCheckAPI: lets a real authenticated user through', () => {
    const { id } = createProtectedRecording();
    let nextCalled = false;
    passwordCheckAPI(
      { method: 'GET', path: `/api/recordings/${id}`, headers: {}, user: REAL_USER },
      makeRes(),
      () => { nextCalled = true; },
    );
    expect(nextCalled).toBe(true);
  });

  it('passwordCheckPage: serves the password prompt to synthetic user on /share/', () => {
    const { shareToken } = createProtectedRecording();
    let nextCalled = false;
    const res = makeRes();
    passwordCheckPage(
      { method: 'GET', path: `/share/${shareToken}`, headers: {}, user: SYNTHETIC_USER },
      res,
      () => { nextCalled = true; },
    );
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(200);
    expect(res.sent).toContain('verify-password');
  });

  it('passwordCheckPage: lets a real authenticated user through on /share/', () => {
    const { shareToken } = createProtectedRecording();
    let nextCalled = false;
    passwordCheckPage(
      { method: 'GET', path: `/share/${shareToken}`, headers: {}, user: REAL_USER },
      makeRes(),
      () => { nextCalled = true; },
    );
    expect(nextCalled).toBe(true);
  });

  it('passwordCheckData: blocks synthetic user, allows real user', () => {
    const { id } = createProtectedRecording();

    let blockedNext = false;
    const res = makeRes();
    passwordCheckData(
      { method: 'GET', path: `/${id}/video.webm`, headers: {}, user: SYNTHETIC_USER },
      res,
      () => { blockedNext = true; },
    );
    expect(blockedNext).toBe(false);
    expect(res.statusCode).toBe(403);

    let allowedNext = false;
    passwordCheckData(
      { method: 'GET', path: `/${id}/video.webm`, headers: {}, user: REAL_USER },
      makeRes(),
      () => { allowedNext = true; },
    );
    expect(allowedNext).toBe(true);
  });
});
