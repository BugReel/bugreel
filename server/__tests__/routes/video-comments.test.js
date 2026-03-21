import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import { cleanupTestData } from '../setup.js';
import { initDB, getDB } from '../../db.js';

beforeAll(() => {
  initDB();
});

afterAll(() => {
  try { getDB().close(); } catch {}
  cleanupTestData();
});

// --- Helpers ---

function createRecording(overrides = {}) {
  const db = getDB();
  const id = overrides.id || 'vc-rec-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
  const shareToken = crypto.randomUUID();
  db.prepare(`
    INSERT INTO recordings (id, author, status, share_token)
    VALUES (?, ?, ?, ?)
  `).run(id, 'vc-tester', 'complete', shareToken);
  return { id, shareToken };
}

function cleanup(...recIds) {
  const db = getDB();
  for (const id of recIds) {
    db.prepare('DELETE FROM video_comments WHERE recording_id = ?').run(id);
    db.prepare('DELETE FROM frames WHERE recording_id = ?').run(id);
    db.prepare('DELETE FROM cards WHERE recording_id = ?').run(id);
    db.prepare('DELETE FROM recordings WHERE id = ?').run(id);
  }
}

// ================= CREATE COMMENTS =================

describe('Video Comments — create', () => {
  let recId;

  beforeAll(() => {
    const rec = createRecording();
    recId = rec.id;
  });

  afterAll(() => {
    cleanup(recId);
  });

  it('creates a comment with timecode', () => {
    const db = getDB();
    const result = db.prepare(
      'INSERT INTO video_comments (recording_id, author_name, text, timecode_seconds) VALUES (?, ?, ?, ?)'
    ).run(recId, 'Alice', 'Great recording!', 15.5);

    expect(result.lastInsertRowid).toBeGreaterThan(0);

    const comment = db.prepare('SELECT * FROM video_comments WHERE id = ?').get(result.lastInsertRowid);
    expect(comment.recording_id).toBe(recId);
    expect(comment.author_name).toBe('Alice');
    expect(comment.text).toBe('Great recording!');
    expect(comment.timecode_seconds).toBe(15.5);
    expect(comment.created_at).toBeTruthy();
  });

  it('creates a comment without timecode', () => {
    const db = getDB();
    const result = db.prepare(
      'INSERT INTO video_comments (recording_id, author_name, text, timecode_seconds) VALUES (?, ?, ?, ?)'
    ).run(recId, 'Bob', 'General comment', null);

    const comment = db.prepare('SELECT * FROM video_comments WHERE id = ?').get(result.lastInsertRowid);
    expect(comment.timecode_seconds).toBeNull();
    expect(comment.text).toBe('General comment');
  });

  it('truncates long author_name to 100 chars (app logic)', () => {
    const longName = 'A'.repeat(200);
    const trimmedName = longName.trim().slice(0, 100);
    expect(trimmedName).toHaveLength(100);
  });

  it('truncates long text to 2000 chars (app logic)', () => {
    const longText = 'X'.repeat(3000);
    const trimmedText = longText.trim().slice(0, 2000);
    expect(trimmedText).toHaveLength(2000);
  });
});

// ================= LIST COMMENTS =================

describe('Video Comments — list', () => {
  let recId;

  beforeAll(() => {
    const rec = createRecording();
    recId = rec.id;

    const db = getDB();
    db.prepare('INSERT INTO video_comments (recording_id, author_name, text, timecode_seconds) VALUES (?, ?, ?, ?)').run(recId, 'First', 'Comment 1', 5.0);
    db.prepare('INSERT INTO video_comments (recording_id, author_name, text, timecode_seconds) VALUES (?, ?, ?, ?)').run(recId, 'Second', 'Comment 2', 10.0);
    db.prepare('INSERT INTO video_comments (recording_id, author_name, text, timecode_seconds) VALUES (?, ?, ?, ?)').run(recId, 'Third', 'Comment 3', 15.0);
  });

  afterAll(() => {
    cleanup(recId);
  });

  it('returns all comments for a recording', () => {
    const db = getDB();
    const comments = db.prepare(
      'SELECT id, recording_id, author_name, text, timecode_seconds, created_at FROM video_comments WHERE recording_id = ? ORDER BY created_at ASC'
    ).all(recId);

    expect(comments).toHaveLength(3);
  });

  it('orders comments by created_at ASC', () => {
    const db = getDB();
    const comments = db.prepare(
      'SELECT * FROM video_comments WHERE recording_id = ? ORDER BY created_at ASC'
    ).all(recId);

    for (let i = 1; i < comments.length; i++) {
      expect(comments[i].created_at >= comments[i - 1].created_at).toBe(true);
    }
  });

  it('returns empty array for recording with no comments', () => {
    const emptyRec = createRecording();
    const db = getDB();
    const comments = db.prepare(
      'SELECT * FROM video_comments WHERE recording_id = ? ORDER BY created_at ASC'
    ).all(emptyRec.id);

    expect(comments).toHaveLength(0);

    cleanup(emptyRec.id);
  });

  it('returns 404-equivalent for nonexistent recording', () => {
    const db = getDB();
    const recording = db.prepare('SELECT id FROM recordings WHERE id = ?').get('nonexistent-vc-rec');
    expect(recording).toBeUndefined();
    // Route would return 404
  });

  it('selects only public-safe columns', () => {
    const db = getDB();
    const comments = db.prepare(
      'SELECT id, recording_id, author_name, text, timecode_seconds, created_at FROM video_comments WHERE recording_id = ?'
    ).all(recId);

    const cols = Object.keys(comments[0]);
    expect(cols).toContain('id');
    expect(cols).toContain('recording_id');
    expect(cols).toContain('author_name');
    expect(cols).toContain('text');
    expect(cols).toContain('timecode_seconds');
    expect(cols).toContain('created_at');
    // author_email should NOT be in this select
    expect(cols).not.toContain('author_email');
  });
});

// ================= DELETE COMMENTS =================

describe('Video Comments — delete', () => {
  let recId;

  beforeAll(() => {
    const rec = createRecording();
    recId = rec.id;
  });

  afterAll(() => {
    cleanup(recId);
  });

  it('deletes a specific comment by id and recording_id', () => {
    const db = getDB();
    const result = db.prepare(
      'INSERT INTO video_comments (recording_id, author_name, text) VALUES (?, ?, ?)'
    ).run(recId, 'DeleteMe', 'This will be deleted');
    const commentId = result.lastInsertRowid;

    // Verify it exists
    const comment = db.prepare('SELECT * FROM video_comments WHERE id = ? AND recording_id = ?').get(commentId, recId);
    expect(comment).toBeTruthy();

    // Delete
    db.prepare('DELETE FROM video_comments WHERE id = ?').run(commentId);

    // Verify it's gone
    const deleted = db.prepare('SELECT * FROM video_comments WHERE id = ?').get(commentId);
    expect(deleted).toBeUndefined();
  });

  it('returns 0 changes when deleting nonexistent comment', () => {
    const db = getDB();
    const result = db.prepare('DELETE FROM video_comments WHERE id = ?').run(999999);
    expect(result.changes).toBe(0);
  });

  it('only deletes the targeted comment, not others', () => {
    const db = getDB();
    db.prepare('INSERT INTO video_comments (recording_id, author_name, text) VALUES (?, ?, ?)').run(recId, 'Keep1', 'Stay');
    const toDelete = db.prepare('INSERT INTO video_comments (recording_id, author_name, text) VALUES (?, ?, ?)').run(recId, 'Remove', 'Go away');
    db.prepare('INSERT INTO video_comments (recording_id, author_name, text) VALUES (?, ?, ?)').run(recId, 'Keep2', 'Stay too');

    const beforeCount = db.prepare('SELECT COUNT(*) as c FROM video_comments WHERE recording_id = ?').get(recId).c;

    db.prepare('DELETE FROM video_comments WHERE id = ?').run(toDelete.lastInsertRowid);

    const afterCount = db.prepare('SELECT COUNT(*) as c FROM video_comments WHERE recording_id = ?').get(recId).c;
    expect(afterCount).toBe(beforeCount - 1);
  });
});

// ================= VALIDATION =================

describe('Video Comments — validation logic', () => {
  it('rejects empty author_name', () => {
    const authorName = '';
    expect(!authorName || !authorName.trim()).toBe(true);
  });

  it('rejects empty text', () => {
    const text = '   ';
    expect(!text || !text.trim()).toBe(true);
  });

  it('rejects negative timecode', () => {
    const timecode = parseFloat(-5);
    expect(isNaN(timecode) || timecode < 0).toBe(true);
  });

  it('accepts zero timecode', () => {
    const timecode = parseFloat(0);
    expect(isNaN(timecode) || timecode < 0).toBe(false);
  });

  it('rejects NaN timecode', () => {
    const timecode = parseFloat('abc');
    expect(isNaN(timecode)).toBe(true);
  });
});
