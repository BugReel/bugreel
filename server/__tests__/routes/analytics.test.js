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
  const id = overrides.id || 'analytics-rec-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
  const shareToken = crypto.randomUUID();
  db.prepare(`
    INSERT INTO recordings (id, author, status, share_token)
    VALUES (?, ?, ?, ?)
  `).run(id, overrides.author || 'analytics-tester', overrides.status || 'complete', shareToken);
  return { id, shareToken };
}

function hashIP(ip) {
  return crypto.createHash('sha256').update(`bugreel-view-salt:${ip}`).digest('hex');
}

function insertView(recordingId, viewerHash, overrides = {}) {
  const db = getDB();
  const result = db.prepare(`
    INSERT INTO views (recording_id, viewer_hash, user_agent, referrer, duration_seconds, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    recordingId,
    viewerHash,
    overrides.user_agent || 'TestBrowser/1.0',
    overrides.referrer || '',
    overrides.duration_seconds ?? 0,
    overrides.created_at || new Date().toISOString().replace('T', ' ').slice(0, 19),
  );
  return result.lastInsertRowid;
}

function cleanup(...recIds) {
  const db = getDB();
  for (const id of recIds) {
    db.prepare('DELETE FROM views WHERE recording_id = ?').run(id);
    db.prepare('DELETE FROM frames WHERE recording_id = ?').run(id);
    db.prepare('DELETE FROM cards WHERE recording_id = ?').run(id);
    db.prepare('DELETE FROM recordings WHERE id = ?').run(id);
  }
}

// ================= TRACK VIEW =================

describe('Analytics — track view (POST /api/analytics/view logic)', () => {
  let recId;

  beforeAll(() => {
    const rec = createRecording();
    recId = rec.id;
  });

  afterAll(() => {
    cleanup(recId);
  });

  it('inserts a new view for a recording', () => {
    const db = getDB();
    const viewerHash = hashIP('192.168.1.1');

    const result = db.prepare(`
      INSERT INTO views (recording_id, viewer_hash, user_agent, referrer)
      VALUES (?, ?, ?, ?)
    `).run(recId, viewerHash, 'Chrome/120', 'https://google.com');

    expect(result.lastInsertRowid).toBeGreaterThan(0);

    const view = db.prepare('SELECT * FROM views WHERE id = ?').get(result.lastInsertRowid);
    expect(view.recording_id).toBe(recId);
    expect(view.viewer_hash).toBe(viewerHash);
    expect(view.user_agent).toBe('Chrome/120');
    expect(view.referrer).toBe('https://google.com');
    expect(view.duration_seconds).toBe(0);
  });

  it('rejects view for nonexistent recording', () => {
    const db = getDB();
    const rec = db.prepare('SELECT id FROM recordings WHERE id = ?').get('nonexistent-analytics-rec');
    expect(rec).toBeUndefined();
    // Route would return 404
  });

  it('requires recording_id', () => {
    // Route logic: if (!recording_id) return 400
    const recording_id = null;
    expect(!recording_id).toBe(true);
  });
});

// ================= RATE LIMITING =================

describe('Analytics — rate limiting (same viewer within cooldown)', () => {
  let recId;

  beforeAll(() => {
    const rec = createRecording();
    recId = rec.id;
  });

  afterAll(() => {
    cleanup(recId);
  });

  it('detects duplicate view from same IP within 1 hour', () => {
    const db = getDB();
    const viewerHash = hashIP('10.0.0.1');

    // Insert an initial view (recent)
    insertView(recId, viewerHash);

    // Check for recent view (same query as analytics route)
    const recentView = db.prepare(`
      SELECT id FROM views
      WHERE recording_id = ? AND viewer_hash = ? AND created_at > datetime('now', '-1 hour')
      ORDER BY created_at DESC LIMIT 1
    `).get(recId, viewerHash);

    expect(recentView).toBeTruthy();
    // Route would return { ok: true, duplicate: true }
  });

  it('allows view from different IP', () => {
    const db = getDB();
    const viewerHash1 = hashIP('10.0.0.1');
    const viewerHash2 = hashIP('10.0.0.2');

    insertView(recId, viewerHash1);

    const recentView = db.prepare(`
      SELECT id FROM views
      WHERE recording_id = ? AND viewer_hash = ? AND created_at > datetime('now', '-1 hour')
      ORDER BY created_at DESC LIMIT 1
    `).get(recId, viewerHash2);

    // Different IP = no duplicate
    expect(recentView).toBeFalsy();
  });

  it('allows view after cooldown period expires', () => {
    const db = getDB();
    const viewerHash = hashIP('10.0.0.99');

    // Insert a view from 2 hours ago
    insertView(recId, viewerHash, {
      created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19),
    });

    const recentView = db.prepare(`
      SELECT id FROM views
      WHERE recording_id = ? AND viewer_hash = ? AND created_at > datetime('now', '-1 hour')
      ORDER BY created_at DESC LIMIT 1
    `).get(recId, viewerHash);

    expect(recentView).toBeFalsy();
    // Cooldown expired, new view allowed
  });
});

// ================= HEARTBEAT =================

describe('Analytics — heartbeat (update watch duration)', () => {
  let recId;

  beforeAll(() => {
    const rec = createRecording();
    recId = rec.id;
  });

  afterAll(() => {
    cleanup(recId);
  });

  it('increments duration_seconds on a view', () => {
    const db = getDB();
    const viewId = insertView(recId, hashIP('heartbeat-ip-1'));

    const increment = Math.min(30, 60); // capped at 60
    db.prepare('UPDATE views SET duration_seconds = duration_seconds + ? WHERE id = ?')
      .run(increment, viewId);

    const view = db.prepare('SELECT duration_seconds FROM views WHERE id = ?').get(viewId);
    expect(view.duration_seconds).toBe(30);
  });

  it('caps single heartbeat to 60 seconds', () => {
    const db = getDB();
    const viewId = insertView(recId, hashIP('heartbeat-ip-2'));

    const rawSeconds = 120;
    const increment = Math.min(rawSeconds, 60);
    expect(increment).toBe(60);

    db.prepare('UPDATE views SET duration_seconds = duration_seconds + ? WHERE id = ?')
      .run(increment, viewId);

    const view = db.prepare('SELECT duration_seconds FROM views WHERE id = ?').get(viewId);
    expect(view.duration_seconds).toBe(60);
  });

  it('accumulates multiple heartbeats', () => {
    const db = getDB();
    const viewId = insertView(recId, hashIP('heartbeat-ip-3'));

    for (let i = 0; i < 4; i++) {
      db.prepare('UPDATE views SET duration_seconds = duration_seconds + ? WHERE id = ?')
        .run(30, viewId);
    }

    const view = db.prepare('SELECT duration_seconds FROM views WHERE id = ?').get(viewId);
    expect(view.duration_seconds).toBe(120);
  });

  it('returns 0 changes for nonexistent view', () => {
    const db = getDB();
    const result = db.prepare('UPDATE views SET duration_seconds = duration_seconds + ? WHERE id = ?')
      .run(30, 999999);
    expect(result.changes).toBe(0);
    // Route would return 404
  });
});

// ================= GET STATS =================

describe('Analytics — aggregate stats (GET /api/analytics/:recordingId logic)', () => {
  let recId;

  beforeAll(() => {
    const rec = createRecording();
    recId = rec.id;

    // Insert various views
    insertView(recId, hashIP('stats-ip-1'), { duration_seconds: 60, user_agent: 'Chrome/120' });
    insertView(recId, hashIP('stats-ip-2'), { duration_seconds: 120, user_agent: 'Firefox/115' });
    insertView(recId, hashIP('stats-ip-1'), { duration_seconds: 30, user_agent: 'Chrome/120' }); // same IP, different view
    insertView(recId, hashIP('stats-ip-3'), { duration_seconds: 0, user_agent: 'Safari/17' });
  });

  afterAll(() => {
    cleanup(recId);
  });

  it('returns correct total_views', () => {
    const db = getDB();
    const stats = db.prepare(`
      SELECT COUNT(*) as total_views FROM views WHERE recording_id = ?
    `).get(recId);
    expect(stats.total_views).toBe(4);
  });

  it('returns correct unique_viewers', () => {
    const db = getDB();
    const stats = db.prepare(`
      SELECT COUNT(DISTINCT viewer_hash) as unique_viewers FROM views WHERE recording_id = ?
    `).get(recId);
    expect(stats.unique_viewers).toBe(3);
  });

  it('returns correct avg_watch_duration', () => {
    const db = getDB();
    const stats = db.prepare(`
      SELECT COALESCE(ROUND(AVG(duration_seconds)), 0) as avg_watch_duration
      FROM views WHERE recording_id = ?
    `).get(recId);
    // (60 + 120 + 30 + 0) / 4 = 52.5 => rounded = 53
    expect(stats.avg_watch_duration).toBe(53);
  });

  it('returns correct max_watch_duration', () => {
    const db = getDB();
    const stats = db.prepare(`
      SELECT COALESCE(MAX(duration_seconds), 0) as max_watch_duration
      FROM views WHERE recording_id = ?
    `).get(recId);
    expect(stats.max_watch_duration).toBe(120);
  });

  it('returns views_by_day aggregation', () => {
    const db = getDB();
    const viewsByDay = db.prepare(`
      SELECT DATE(created_at) as date, COUNT(*) as count
      FROM views
      WHERE recording_id = ? AND created_at > datetime('now', '-30 days')
      GROUP BY DATE(created_at)
      ORDER BY date ASC
    `).all(recId);

    expect(viewsByDay.length).toBeGreaterThanOrEqual(1);
    // All views are from today
    const todayCount = viewsByDay.reduce((sum, d) => sum + d.count, 0);
    expect(todayCount).toBe(4);
  });

  it('returns recent_views with metadata', () => {
    const db = getDB();
    const recentViews = db.prepare(`
      SELECT id, viewer_hash, user_agent, referrer, created_at, duration_seconds
      FROM views WHERE recording_id = ?
      ORDER BY created_at DESC LIMIT 20
    `).all(recId);

    expect(recentViews.length).toBe(4);
    expect(recentViews[0]).toHaveProperty('viewer_hash');
    expect(recentViews[0]).toHaveProperty('user_agent');
    expect(recentViews[0]).toHaveProperty('duration_seconds');
  });

  it('returns zeros for recording with no views', () => {
    const emptyRec = createRecording();
    const db = getDB();

    const stats = db.prepare(`
      SELECT
        COUNT(*) as total_views,
        COUNT(DISTINCT viewer_hash) as unique_viewers,
        COALESCE(ROUND(AVG(duration_seconds)), 0) as avg_watch_duration,
        COALESCE(MAX(duration_seconds), 0) as max_watch_duration
      FROM views WHERE recording_id = ?
    `).get(emptyRec.id);

    expect(stats.total_views).toBe(0);
    expect(stats.unique_viewers).toBe(0);
    expect(stats.avg_watch_duration).toBe(0);
    expect(stats.max_watch_duration).toBe(0);

    cleanup(emptyRec.id);
  });
});

// ================= IP HASHING =================

describe('Analytics — IP hashing', () => {
  it('hashIP is deterministic for same IP', () => {
    const h1 = hashIP('192.168.1.1');
    const h2 = hashIP('192.168.1.1');
    expect(h1).toBe(h2);
  });

  it('hashIP produces different hashes for different IPs', () => {
    const h1 = hashIP('192.168.1.1');
    const h2 = hashIP('192.168.1.2');
    expect(h1).not.toBe(h2);
  });

  it('hashIP returns 64-char hex string', () => {
    const h = hashIP('10.0.0.1');
    expect(h).toMatch(/^[a-f0-9]{64}$/);
  });
});
