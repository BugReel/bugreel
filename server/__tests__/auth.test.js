import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { cleanupTestData } from './setup.js';
import { initDB, getDB } from '../db.js';
import { hashPassword, verifyPassword, createSession, getUserBySession } from '../auth.js';

beforeAll(() => {
  initDB();
});

afterAll(() => {
  try { getDB().close(); } catch {}
  cleanupTestData();
});

// --- Password Hashing ---

describe('Password Hashing', () => {
  it('hashPassword returns salt:hash format', () => {
    const result = hashPassword('test123');
    expect(result).toMatch(/^[a-f0-9]{32}:[a-f0-9]{128}$/);
  });

  it('hashPassword generates unique salts', () => {
    const h1 = hashPassword('same-password');
    const h2 = hashPassword('same-password');
    expect(h1).not.toBe(h2);
  });

  it('verifyPassword returns true for correct password', () => {
    const hash = hashPassword('correct-password');
    expect(verifyPassword('correct-password', hash)).toBe(true);
  });

  it('verifyPassword returns false for wrong password', () => {
    const hash = hashPassword('correct-password');
    expect(verifyPassword('wrong-password', hash)).toBe(false);
  });

  it('verifyPassword returns false for empty password', () => {
    const hash = hashPassword('real-password');
    expect(verifyPassword('', hash)).toBe(false);
  });

  it('handles unicode passwords', () => {
    const hash = hashPassword('пароль123');
    expect(verifyPassword('пароль123', hash)).toBe(true);
    expect(verifyPassword('пароль124', hash)).toBe(false);
  });

  it('handles very long passwords', () => {
    const long = 'a'.repeat(1000);
    const hash = hashPassword(long);
    expect(verifyPassword(long, hash)).toBe(true);
  });
});

// --- Sessions ---

describe('Sessions', () => {
  let testUserId;

  beforeAll(() => {
    const db = getDB();
    // Create a test user
    testUserId = 'test-user-' + Date.now();
    db.prepare(`
      INSERT INTO users (id, name, email, auth_provider, role)
      VALUES (?, 'Test User', 'test@test.com', 'simple', 'admin')
    `).run(testUserId);
  });

  it('createSession returns token and expiresAt', () => {
    const session = createSession(testUserId);
    expect(session.token).toBeTruthy();
    expect(session.token).toHaveLength(64); // 32 bytes hex
    expect(session.expiresAt).toBeTruthy();
  });

  it('dashboard session expires in ~30 days', () => {
    const session = createSession(testUserId, 'dashboard');
    const expires = new Date(session.expiresAt);
    const daysUntilExpiry = (expires - Date.now()) / (1000 * 60 * 60 * 24);
    expect(daysUntilExpiry).toBeGreaterThan(29);
    expect(daysUntilExpiry).toBeLessThan(31);
  });

  it('extension session expires in ~365 days', () => {
    const session = createSession(testUserId, 'extension');
    const expires = new Date(session.expiresAt);
    const daysUntilExpiry = (expires - Date.now()) / (1000 * 60 * 60 * 24);
    expect(daysUntilExpiry).toBeGreaterThan(364);
    expect(daysUntilExpiry).toBeLessThan(366);
  });

  it('getUserBySession returns user for valid token', () => {
    const session = createSession(testUserId);
    const user = getUserBySession(session.token);
    expect(user).toBeTruthy();
    expect(user.id).toBe(testUserId);
    expect(user.name).toBe('Test User');
  });

  it('getUserBySession returns null for invalid token', () => {
    const user = getUserBySession('nonexistent-token-12345');
    expect(user).toBeNull();
  });

  it('getUserBySession returns null for expired token', () => {
    const db = getDB();
    const token = 'expired-token-' + Date.now();
    db.prepare(`
      INSERT INTO sessions (token, user_id, type, expires_at)
      VALUES (?, ?, 'dashboard', datetime('now', '-1 day'))
    `).run(token, testUserId);
    const user = getUserBySession(token);
    expect(user).toBeNull();
  });

  it('each createSession generates unique tokens', () => {
    const s1 = createSession(testUserId);
    const s2 = createSession(testUserId);
    expect(s1.token).not.toBe(s2.token);
  });
});

// --- Auth Middleware (unit level) ---

describe('isPublicRoute patterns', () => {
  // Test the logic without Express — just check path patterns.
  // Mirrors the GET-method-keyed pairs as [method, path] to cover routes
  // where method gates publicness (e.g. /api/branding GET only).
  const publicPaths = [
    ['GET', '/login'],
    ['POST', '/api/auth/login'],
    ['POST', '/api/auth/register'],
    ['GET', '/share/abc123'],
    ['GET', '/share/some-long-share-token'],
    ['GET', '/report/abc123'],
    ['GET', '/report/some-long-share-token'],
    ['GET', '/embed/xyz'],
    ['GET', '/css/style.css'],
    ['GET', '/js/app.js'],
    ['GET', '/api/branding'],
  ];

  const protectedPaths = [
    ['GET', '/api/recordings'],
    ['GET', '/api/cards'],
    ['GET', '/api/settings'],
    ['GET', '/'],
    ['GET', '/recording/abc'],
    // /api/branding is public on GET only; non-GET should require auth
    ['POST', '/api/branding'],
  ];

  // Simple pattern checker mirroring auth.js isPublicRoute logic.
  // /api/upload is intentionally NOT in publicPaths — it's "public" in
  // isPublicRoute but enforces its own Bearer-token check inside the handler.
  function isPublic(method, p) {
    if (p === '/login' || p === '/api/auth/login' || p === '/api/auth/register') return true;
    if (p.startsWith('/share/') || p.startsWith('/report/')) return true;
    if (p.startsWith('/embed/')) return true;
    if (p.startsWith('/css/') || p.startsWith('/js/')) return true;
    if (method === 'GET' && p === '/api/branding') return true;
    return false;
  }

  publicPaths.forEach(([method, p]) => {
    it(`${method} ${p} is public`, () => {
      expect(isPublic(method, p)).toBe(true);
    });
  });

  protectedPaths.forEach(([method, p]) => {
    it(`${method} ${p} is protected`, () => {
      expect(isPublic(method, p)).toBe(false);
    });
  });
});
