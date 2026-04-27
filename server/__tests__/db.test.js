import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import { cleanupTestData } from './setup.js';
import { initDB, getDB, generateRecordingId } from '../db.js';

beforeAll(() => {
  initDB();
});

afterAll(() => {
  try { getDB().close(); } catch {}
  cleanupTestData();
});

describe('Database Initialization', () => {
  it('creates recordings table', () => {
    const db = getDB();
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='recordings'").get();
    expect(table).toBeTruthy();
  });

  it('creates frames table', () => {
    const db = getDB();
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='frames'").get();
    expect(table).toBeTruthy();
  });

  it('creates cards table', () => {
    const db = getDB();
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='cards'").get();
    expect(table).toBeTruthy();
  });

  it('creates users table', () => {
    const db = getDB();
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get();
    expect(table).toBeTruthy();
  });

  it('creates sessions table', () => {
    const db = getDB();
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'").get();
    expect(table).toBeTruthy();
  });

  it('creates views table', () => {
    const db = getDB();
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='views'").get();
    expect(table).toBeTruthy();
  });

  it('creates video_comments table', () => {
    const db = getDB();
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='video_comments'").get();
    expect(table).toBeTruthy();
  });

  it('creates settings table', () => {
    const db = getDB();
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='settings'").get();
    expect(table).toBeTruthy();
  });

  it('creates invites table', () => {
    const db = getDB();
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='invites'").get();
    expect(table).toBeTruthy();
  });
});

describe('Database Schema — recordings', () => {
  it('has all expected columns', () => {
    const db = getDB();
    const cols = db.prepare("PRAGMA table_info(recordings)").all().map(c => c.name);
    const expected = ['id', 'author', 'created_at', 'status', 'video_filename', 'audio_filename',
      'duration_seconds', 'file_size_bytes', 'transcript_json', 'analysis_json',
      'password_hash', 'share_token'];
    for (const col of expected) {
      expect(cols).toContain(col);
    }
  });

  it('can insert and retrieve a recording', () => {
    const db = getDB();
    const id = 'test-rec-' + Date.now();
    db.prepare(`
      INSERT INTO recordings (id, author, status, share_token)
      VALUES (?, 'tester', 'uploaded', ?)
    `).run(id, crypto.randomUUID());

    const rec = db.prepare('SELECT * FROM recordings WHERE id = ?').get(id);
    expect(rec).toBeTruthy();
    expect(rec.author).toBe('tester');
    expect(rec.status).toBe('uploaded');
    // Cleanup
    db.prepare('DELETE FROM recordings WHERE id = ?').run(id);
  });

  it('default status is uploaded', () => {
    const db = getDB();
    const id = 'test-default-' + Date.now();
    db.prepare("INSERT INTO recordings (id, author, share_token) VALUES (?, 'a', ?)").run(id, crypto.randomUUID());
    const rec = db.prepare('SELECT status FROM recordings WHERE id = ?').get(id);
    expect(rec.status).toBe('uploaded');
    db.prepare('DELETE FROM recordings WHERE id = ?').run(id);
  });
});

describe('Database Schema — users', () => {
  it('has required columns', () => {
    const db = getDB();
    const cols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
    expect(cols).toContain('id');
    expect(cols).toContain('name');
    expect(cols).toContain('email');
    expect(cols).toContain('role');
    expect(cols).toContain('password_hash');
    expect(cols).toContain('auth_provider');
  });

  it('seeds default admin from DASHBOARD_PASSWORD', () => {
    const db = getDB();
    const admin = db.prepare("SELECT * FROM users WHERE role = 'admin' LIMIT 1").get();
    expect(admin).toBeTruthy();
    expect(admin.name).toBe('Admin');
  });
});

describe('generateRecordingId', () => {
  const year = new Date().getFullYear();
  const prefix = `REC-${year}-`;

  function clearYear() {
    getDB().prepare('DELETE FROM recordings WHERE id LIKE ?').run(`${prefix}%`);
  }

  function insert(num) {
    const id = `${prefix}${String(num).padStart(4, '0')}`;
    getDB().prepare("INSERT INTO recordings (id, author, share_token) VALUES (?, 'tester', ?)")
      .run(id, crypto.randomUUID());
    return id;
  }

  it('returns 0001 on empty table', () => {
    clearYear();
    expect(generateRecordingId()).toBe(`${prefix}0001`);
    clearYear();
  });

  it('returns next sequential ID with consecutive records', () => {
    clearYear();
    insert(1); insert(2); insert(3);
    expect(generateRecordingId()).toBe(`${prefix}0004`);
    clearYear();
  });

  it('skips holes from middle deletions instead of colliding (regression)', () => {
    // Original bug: COUNT(*)+1 returned an ID that already existed when a
    // record was deleted from the middle of the sequence — UNIQUE constraint
    // failure on next upload. MAX(num)+1 must keep climbing past the hole.
    clearYear();
    insert(1); insert(2); insert(3); insert(4); insert(5);
    getDB().prepare('DELETE FROM recordings WHERE id = ?').run(`${prefix}0003`);
    expect(generateRecordingId()).toBe(`${prefix}0006`);
    clearYear();
  });

  it('handles non-contiguous gaps (mirrors real prod state)', () => {
    clearYear();
    [1,2,3,4,5,6,7,8,9,10,11,12,13,19,20,21,22,23,24,25].forEach(insert);
    expect(generateRecordingId()).toBe(`${prefix}0026`);
    clearYear();
  });
});

describe('Database — Foreign Keys', () => {
  it('foreign_keys pragma is enabled', () => {
    const db = getDB();
    const fk = db.prepare('PRAGMA foreign_keys').get();
    expect(fk.foreign_keys).toBe(1);
  });

  it('WAL journal mode is enabled', () => {
    const db = getDB();
    const jm = db.prepare('PRAGMA journal_mode').get();
    expect(jm.journal_mode).toBe('wal');
  });

  it('cascade deletes sessions when user is deleted', () => {
    const db = getDB();
    const userId = 'fk-test-' + Date.now();
    db.prepare("INSERT INTO users (id, name, auth_provider, role) VALUES (?, 'FK Test', 'simple', 'member')").run(userId);
    db.prepare("INSERT INTO sessions (token, user_id, type, expires_at) VALUES (?, ?, 'dashboard', datetime('now', '+1 day'))").run('fk-token-' + Date.now(), userId);

    const before = db.prepare('SELECT COUNT(*) as c FROM sessions WHERE user_id = ?').get(userId);
    expect(before.c).toBe(1);

    db.prepare('DELETE FROM users WHERE id = ?').run(userId);

    const after = db.prepare('SELECT COUNT(*) as c FROM sessions WHERE user_id = ?').get(userId);
    expect(after.c).toBe(0);
  });
});

describe('Database — Migrations', () => {
  it('recordings has migration columns', () => {
    const db = getDB();
    const cols = db.prepare("PRAGMA table_info(recordings)").all().map(c => c.name);
    // These are added via ALTER TABLE migrations
    expect(cols).toContain('action_events_json');
    expect(cols).toContain('manual_markers_json');
    expect(cols).toContain('trim_start');
    expect(cols).toContain('trim_end');
    expect(cols).toContain('segments_json');
  });

  it('frames has is_manual column from migration', () => {
    const db = getDB();
    const cols = db.prepare("PRAGMA table_info(frames)").all().map(c => c.name);
    expect(cols).toContain('is_manual');
    expect(cols).toContain('detail');
  });

  it('cards has summary column from migration', () => {
    const db = getDB();
    const cols = db.prepare("PRAGMA table_info(cards)").all().map(c => c.name);
    expect(cols).toContain('summary');
  });

  it('initDB is idempotent — can be called multiple times', () => {
    expect(() => initDB()).not.toThrow();
    expect(() => initDB()).not.toThrow();
  });
});
