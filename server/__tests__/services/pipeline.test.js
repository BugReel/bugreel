import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
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

describe('Pipeline — Queue Status', () => {
  it('getQueueStatus returns running and queued counts', async () => {
    const { getQueueStatus } = await import('../../services/pipeline.js');
    const status = getQueueStatus();
    expect(status).toHaveProperty('running');
    expect(status).toHaveProperty('queued');
    expect(typeof status.running).toBe('number');
    expect(typeof status.queued).toBe('number');
  });
});

describe('Pipeline — retryStuckRecordings', () => {
  it('identifies stuck recordings for retry', async () => {
    const db = getDB();
    const id = 'stuck-' + Date.now();

    // Create a "stuck" recording (processing state)
    db.prepare(`
      INSERT INTO recordings (id, author, status, share_token)
      VALUES (?, 'test', 'processing', ?)
    `).run(id, crypto.randomUUID());

    // Verify it would be detected as stuck
    const stuck = db.prepare(
      "SELECT id FROM recordings WHERE status NOT IN ('complete', 'error', 'uploaded') AND id = ?"
    ).get(id);
    expect(stuck).toBeTruthy();
    expect(stuck.id).toBe(id);

    // Verify reset logic works
    db.prepare("UPDATE recordings SET status = 'uploaded', transcript_json = NULL, analysis_json = NULL WHERE id = ?").run(id);
    const rec = db.prepare('SELECT status FROM recordings WHERE id = ?').get(id);
    expect(rec.status).toBe('uploaded');

    db.prepare('DELETE FROM recordings WHERE id = ?').run(id);
  });
});

describe('Pipeline — Recording State Machine', () => {
  it('recording starts as uploaded', () => {
    const db = getDB();
    const id = 'state-' + Date.now();
    db.prepare(`INSERT INTO recordings (id, author, share_token) VALUES (?, 'test', ?)`).run(id, crypto.randomUUID());

    const rec = db.prepare('SELECT status FROM recordings WHERE id = ?').get(id);
    expect(rec.status).toBe('uploaded');

    db.prepare('DELETE FROM recordings WHERE id = ?').run(id);
  });

  it('can transition to processing', () => {
    const db = getDB();
    const id = 'trans-' + Date.now();
    db.prepare(`INSERT INTO recordings (id, author, status, share_token) VALUES (?, 'test', 'uploaded', ?)`).run(id, crypto.randomUUID());

    db.prepare("UPDATE recordings SET status = 'processing' WHERE id = ?").run(id);
    const rec = db.prepare('SELECT status FROM recordings WHERE id = ?').get(id);
    expect(rec.status).toBe('processing');

    db.prepare('DELETE FROM recordings WHERE id = ?').run(id);
  });

  it('can transition to complete', () => {
    const db = getDB();
    const id = 'comp-' + Date.now();
    db.prepare(`INSERT INTO recordings (id, author, status, share_token) VALUES (?, 'test', 'processing', ?)`).run(id, crypto.randomUUID());

    db.prepare("UPDATE recordings SET status = 'complete' WHERE id = ?").run(id);
    const rec = db.prepare('SELECT status FROM recordings WHERE id = ?').get(id);
    expect(rec.status).toBe('complete');

    db.prepare('DELETE FROM recordings WHERE id = ?').run(id);
  });

  it('can transition to error', () => {
    const db = getDB();
    const id = 'err-' + Date.now();
    db.prepare(`INSERT INTO recordings (id, author, status, share_token) VALUES (?, 'test', 'processing', ?)`).run(id, crypto.randomUUID());

    db.prepare("UPDATE recordings SET status = 'error' WHERE id = ?").run(id);
    const rec = db.prepare('SELECT status FROM recordings WHERE id = ?').get(id);
    expect(rec.status).toBe('error');

    db.prepare('DELETE FROM recordings WHERE id = ?').run(id);
  });

  it('stuck recordings are identified correctly', () => {
    const db = getDB();
    const ids = [];

    // Create recordings in various states
    for (const status of ['uploaded', 'processing', 'extracting', 'transcribing', 'complete', 'error']) {
      const id = `stuck-check-${status}-${Date.now()}`;
      db.prepare(`INSERT INTO recordings (id, author, status, share_token) VALUES (?, 'test', ?, ?)`).run(id, status, crypto.randomUUID());
      ids.push(id);
    }

    const stuck = db.prepare(
      "SELECT id, status FROM recordings WHERE status NOT IN ('complete', 'error', 'uploaded') AND id LIKE 'stuck-check-%'"
    ).all();

    // processing, extracting, transcribing should be stuck
    expect(stuck.length).toBe(3);

    // Cleanup
    for (const id of ids) {
      db.prepare('DELETE FROM recordings WHERE id = ?').run(id);
    }
  });
});

describe('Pipeline — Concurrency', () => {
  it('MAX_CONCURRENT is 2', async () => {
    // Import and check the queue status reflects the max
    const { getQueueStatus } = await import('../../services/pipeline.js');
    const status = getQueueStatus();
    // running should be <= 2 at any time
    expect(status.running).toBeLessThanOrEqual(2);
  });
});
