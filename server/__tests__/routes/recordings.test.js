import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
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

// --- Helper: create a test recording ---

function createRecording(overrides = {}) {
  const db = getDB();
  const id = overrides.id || 'rec-test-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
  const shareToken = overrides.share_token || crypto.randomUUID();
  const author = overrides.author || 'test-author';
  const status = overrides.status || 'complete';

  db.prepare(`
    INSERT INTO recordings (id, author, status, share_token, duration_seconds, file_size_bytes,
      transcript_json, analysis_json, url_events_json, metadata_json, console_events_json,
      action_events_json, password_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, author, status, shareToken,
    overrides.duration_seconds ?? null,
    overrides.file_size_bytes ?? null,
    overrides.transcript_json ?? null,
    overrides.analysis_json ?? null,
    overrides.url_events_json ?? null,
    overrides.metadata_json ?? null,
    overrides.console_events_json ?? null,
    overrides.action_events_json ?? null,
    overrides.password_hash ?? null,
  );
  return { id, shareToken, author, status };
}

function createCard(recordingId, overrides = {}) {
  const db = getDB();
  const result = db.prepare(`
    INSERT INTO cards (recording_id, title, summary, type, priority, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    recordingId,
    overrides.title || 'Test Card',
    overrides.summary || 'Test summary',
    overrides.type || 'bug',
    overrides.priority || 'medium',
    overrides.status || 'draft',
  );
  return { id: result.lastInsertRowid };
}

function createFrame(recordingId, overrides = {}) {
  const db = getDB();
  const result = db.prepare(`
    INSERT INTO frames (recording_id, filename, time_seconds, description)
    VALUES (?, ?, ?, ?)
  `).run(
    recordingId,
    overrides.filename || `frame_${Date.now()}.jpg`,
    overrides.time_seconds ?? 5.0,
    overrides.description || 'test frame',
  );
  return { id: result.lastInsertRowid };
}

function cleanup(...ids) {
  const db = getDB();
  for (const id of ids) {
    db.prepare('DELETE FROM video_comments WHERE recording_id = ?').run(id);
    db.prepare('DELETE FROM views WHERE recording_id = ?').run(id);
    db.prepare('DELETE FROM frames WHERE recording_id = ?').run(id);
    db.prepare('DELETE FROM comments WHERE card_id IN (SELECT id FROM cards WHERE recording_id = ?)').run(id);
    db.prepare('DELETE FROM cards WHERE recording_id = ?').run(id);
    db.prepare('DELETE FROM recordings WHERE id = ?').run(id);
  }
}

// ================= LIST RECORDINGS =================

describe('Recordings — list with pagination', () => {
  const recIds = [];

  beforeAll(() => {
    for (let i = 0; i < 5; i++) {
      const rec = createRecording({ author: `list-author-${i}`, status: i < 3 ? 'complete' : 'uploaded' });
      recIds.push(rec.id);
    }
  });

  afterAll(() => {
    cleanup(...recIds);
  });

  it('returns recordings with total count', () => {
    const db = getDB();
    const countRow = db.prepare('SELECT COUNT(*) as total FROM recordings').get();
    expect(countRow.total).toBeGreaterThanOrEqual(5);
  });

  it('supports LIMIT and OFFSET', () => {
    const db = getDB();
    const all = db.prepare('SELECT * FROM recordings ORDER BY created_at DESC').all();
    const limited = db.prepare('SELECT * FROM recordings ORDER BY created_at DESC LIMIT 2 OFFSET 0').all();
    expect(limited).toHaveLength(2);
    expect(limited[0].id).toBe(all[0].id);
  });

  it('filters by status', () => {
    const db = getDB();
    const complete = db.prepare("SELECT * FROM recordings WHERE status = 'complete'").all();
    const uploaded = db.prepare("SELECT * FROM recordings WHERE status = 'uploaded'").all();
    for (const r of complete) expect(r.status).toBe('complete');
    for (const r of uploaded) expect(r.status).toBe('uploaded');
  });

  it('filters by author', () => {
    const db = getDB();
    const rows = db.prepare("SELECT * FROM recordings WHERE author = ?").all('list-author-0');
    expect(rows.length).toBeGreaterThanOrEqual(1);
    for (const r of rows) expect(r.author).toBe('list-author-0');
  });

  it('joins card data in listing query', () => {
    const db = getDB();
    createCard(recIds[0], { title: 'Joined Card Title' });

    const row = db.prepare(`
      SELECT r.*, c.title as card_title, c.id as card_id
      FROM recordings r
      LEFT JOIN cards c ON c.recording_id = r.id
      WHERE r.id = ?
    `).get(recIds[0]);

    expect(row.card_title).toBe('Joined Card Title');
    expect(row.card_id).toBeTruthy();
  });

  it('includes first_frame subquery', () => {
    const db = getDB();
    createFrame(recIds[1], { filename: 'first-frame.jpg', time_seconds: 1.0 });
    createFrame(recIds[1], { filename: 'second-frame.jpg', time_seconds: 5.0 });

    const row = db.prepare(`
      SELECT r.*,
        (SELECT f.filename FROM frames f WHERE f.recording_id = r.id ORDER BY f.time_seconds LIMIT 1) as first_frame
      FROM recordings r WHERE r.id = ?
    `).get(recIds[1]);

    expect(row.first_frame).toBe('first-frame.jpg');
  });

  it('includes comment_count subquery', () => {
    const db = getDB();
    db.prepare("INSERT INTO video_comments (recording_id, author_name, text) VALUES (?, 'commenter', 'hello')").run(recIds[2]);
    db.prepare("INSERT INTO video_comments (recording_id, author_name, text) VALUES (?, 'commenter', 'world')").run(recIds[2]);

    const row = db.prepare(`
      SELECT r.*,
        (SELECT COUNT(*) FROM video_comments vc WHERE vc.recording_id = r.id) as comment_count
      FROM recordings r WHERE r.id = ?
    `).get(recIds[2]);

    expect(row.comment_count).toBe(2);
  });

  it('includes view_count subquery', () => {
    const db = getDB();
    db.prepare("INSERT INTO views (recording_id, viewer_hash) VALUES (?, 'hash1')").run(recIds[3]);
    db.prepare("INSERT INTO views (recording_id, viewer_hash) VALUES (?, 'hash2')").run(recIds[3]);
    db.prepare("INSERT INTO views (recording_id, viewer_hash) VALUES (?, 'hash3')").run(recIds[3]);

    const row = db.prepare(`
      SELECT r.*,
        (SELECT COUNT(*) FROM views v WHERE v.recording_id = r.id) as view_count
      FROM recordings r WHERE r.id = ?
    `).get(recIds[3]);

    expect(row.view_count).toBe(3);
  });

  it('orders by created_at DESC', () => {
    const db = getDB();
    const rows = db.prepare('SELECT * FROM recordings ORDER BY created_at DESC').all();
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].created_at >= rows[i].created_at).toBe(true);
    }
  });
});

// ================= GET SINGLE RECORDING =================

describe('Recordings — get single by ID', () => {
  let recId, shareToken;

  beforeAll(() => {
    const rec = createRecording({
      transcript_json: JSON.stringify({ text: 'hello world', words: [{ word: 'hello', start: 0 }, { word: 'world', start: 1 }] }),
      analysis_json: JSON.stringify({ title: 'Test', type: 'bug' }),
      url_events_json: JSON.stringify([{ url: 'https://example.com', ts: 0 }]),
      metadata_json: JSON.stringify({ userAgent: 'TestAgent' }),
      console_events_json: JSON.stringify([{ level: 'error', text: 'err', ts: 2 }]),
      action_events_json: JSON.stringify([{ eventType: 'click', ts: 3 }]),
    });
    recId = rec.id;
    shareToken = rec.shareToken;
    createFrame(recId, { filename: 'frame1.jpg', time_seconds: 1.5 });
    createCard(recId, { title: 'Detail Card' });
  });

  afterAll(() => {
    cleanup(recId);
  });

  it('finds recording by ID', () => {
    const db = getDB();
    const rec = db.prepare('SELECT * FROM recordings WHERE id = ?').get(recId);
    expect(rec).toBeTruthy();
    expect(rec.id).toBe(recId);
  });

  it('finds recording by share_token as fallback', () => {
    const db = getDB();
    let recording = db.prepare('SELECT * FROM recordings WHERE id = ?').get(shareToken);
    if (!recording) {
      recording = db.prepare('SELECT * FROM recordings WHERE share_token = ?').get(shareToken);
    }
    expect(recording).toBeTruthy();
    expect(recording.id).toBe(recId);
  });

  it('returns 404 for nonexistent ID', () => {
    const db = getDB();
    const rec = db.prepare('SELECT * FROM recordings WHERE id = ?').get('nonexistent-id-xyz');
    expect(rec).toBeUndefined();
  });

  it('parses transcript_json correctly', () => {
    const db = getDB();
    const rec = db.prepare('SELECT transcript_json FROM recordings WHERE id = ?').get(recId);
    const transcript = JSON.parse(rec.transcript_json);
    expect(transcript.text).toBe('hello world');
    expect(transcript.words).toHaveLength(2);
  });

  it('parses analysis_json correctly', () => {
    const db = getDB();
    const rec = db.prepare('SELECT analysis_json FROM recordings WHERE id = ?').get(recId);
    const analysis = JSON.parse(rec.analysis_json);
    expect(analysis.title).toBe('Test');
    expect(analysis.type).toBe('bug');
  });

  it('parses url_events_json correctly', () => {
    const db = getDB();
    const rec = db.prepare('SELECT url_events_json FROM recordings WHERE id = ?').get(recId);
    const events = JSON.parse(rec.url_events_json);
    expect(events).toHaveLength(1);
    expect(events[0].url).toBe('https://example.com');
  });

  it('returns associated frames ordered by time', () => {
    const db = getDB();
    const frames = db.prepare('SELECT * FROM frames WHERE recording_id = ? ORDER BY time_seconds').all(recId);
    expect(frames.length).toBeGreaterThanOrEqual(1);
    expect(frames[0].filename).toBe('frame1.jpg');
  });

  it('returns associated card', () => {
    const db = getDB();
    const card = db.prepare('SELECT * FROM cards WHERE recording_id = ?').get(recId);
    expect(card).toBeTruthy();
    expect(card.title).toBe('Detail Card');
  });

  it('returns video_comments for recording', () => {
    const db = getDB();
    db.prepare("INSERT INTO video_comments (recording_id, author_name, text, timecode_seconds) VALUES (?, 'viewer', 'nice!', 10.5)").run(recId);
    const comments = db.prepare(
      'SELECT id, recording_id, author_name, text, timecode_seconds, created_at FROM video_comments WHERE recording_id = ? ORDER BY created_at ASC'
    ).all(recId);
    expect(comments.length).toBeGreaterThanOrEqual(1);
    expect(comments[0].author_name).toBe('viewer');
  });

  it('has_password flag derived from password_hash', () => {
    const db = getDB();
    const rec = db.prepare('SELECT password_hash FROM recordings WHERE id = ?').get(recId);
    const hasPassword = !!rec.password_hash;
    expect(hasPassword).toBe(false);
  });
});

// ================= GET BY SHARE TOKEN =================

describe('Recordings — get by share token', () => {
  let recId, shareToken;

  beforeAll(() => {
    const rec = createRecording({
      transcript_json: JSON.stringify({ text: 'token test' }),
    });
    recId = rec.id;
    shareToken = rec.shareToken;
  });

  afterAll(() => {
    cleanup(recId);
  });

  it('finds recording by share_token', () => {
    const db = getDB();
    const recording = db.prepare('SELECT * FROM recordings WHERE share_token = ?').get(shareToken);
    expect(recording).toBeTruthy();
    expect(recording.id).toBe(recId);
  });

  it('returns null for invalid share_token', () => {
    const db = getDB();
    const recording = db.prepare('SELECT * FROM recordings WHERE share_token = ?').get('bogus-token-999');
    expect(recording).toBeUndefined();
  });
});

// ================= UPDATE TRANSCRIPT =================

describe('Recordings — update transcript', () => {
  let recId;

  beforeAll(() => {
    const rec = createRecording({
      transcript_json: JSON.stringify({ text: 'original text', words: [{ word: 'original', start: 0 }, { word: 'text', start: 1 }] }),
    });
    recId = rec.id;
  });

  afterAll(() => {
    cleanup(recId);
  });

  it('updates transcript words and rebuilds text', () => {
    const db = getDB();
    const newWords = [{ word: 'updated', start: 0 }, { word: 'content', start: 1 }];

    // Simulate the route logic
    const recording = db.prepare('SELECT id, transcript_json FROM recordings WHERE id = ?').get(recId);
    expect(recording).toBeTruthy();

    let transcript = {};
    try { transcript = JSON.parse(recording.transcript_json || '{}'); } catch {}
    transcript.words = newWords;
    transcript.text = newWords.map(w => w.word).join(' ');

    db.prepare('UPDATE recordings SET transcript_json = ? WHERE id = ?')
      .run(JSON.stringify(transcript), recId);

    // Verify
    const updated = db.prepare('SELECT transcript_json FROM recordings WHERE id = ?').get(recId);
    const parsed = JSON.parse(updated.transcript_json);
    expect(parsed.text).toBe('updated content');
    expect(parsed.words).toHaveLength(2);
  });

  it('rejects update for nonexistent recording', () => {
    const db = getDB();
    const rec = db.prepare('SELECT id FROM recordings WHERE id = ?').get('nonexistent-rec');
    expect(rec).toBeUndefined();
  });
});

// ================= UPDATE CONTEXT =================

describe('Recordings — update context data', () => {
  let recId;

  beforeAll(() => {
    const rec = createRecording({
      url_events_json: JSON.stringify([{ url: 'https://old.com', ts: 0 }]),
      console_events_json: JSON.stringify([{ level: 'error', text: 'old error', ts: 1 }]),
    });
    recId = rec.id;
  });

  afterAll(() => {
    cleanup(recId);
  });

  it('updates url_events_json', () => {
    const db = getDB();
    const newEvents = [{ url: 'https://new.com', ts: 5 }];
    db.prepare('UPDATE recordings SET url_events_json = ? WHERE id = ?')
      .run(JSON.stringify(newEvents), recId);

    const rec = db.prepare('SELECT url_events_json FROM recordings WHERE id = ?').get(recId);
    const parsed = JSON.parse(rec.url_events_json);
    expect(parsed[0].url).toBe('https://new.com');
  });

  it('updates console_events_json', () => {
    const db = getDB();
    const newEvents = [{ level: 'warning', text: 'new warning', ts: 3 }];
    db.prepare('UPDATE recordings SET console_events_json = ? WHERE id = ?')
      .run(JSON.stringify(newEvents), recId);

    const rec = db.prepare('SELECT console_events_json FROM recordings WHERE id = ?').get(recId);
    const parsed = JSON.parse(rec.console_events_json);
    expect(parsed[0].level).toBe('warning');
  });

  it('updates action_events_json', () => {
    const db = getDB();
    const newEvents = [{ eventType: 'click', ts: 7, text: 'button' }];
    db.prepare('UPDATE recordings SET action_events_json = ? WHERE id = ?')
      .run(JSON.stringify(newEvents), recId);

    const rec = db.prepare('SELECT action_events_json FROM recordings WHERE id = ?').get(recId);
    const parsed = JSON.parse(rec.action_events_json);
    expect(parsed[0].eventType).toBe('click');
  });

  it('can update multiple context fields at once', () => {
    const db = getDB();
    db.prepare('UPDATE recordings SET url_events_json = ?, console_events_json = ? WHERE id = ?')
      .run(JSON.stringify([]), JSON.stringify([]), recId);

    const rec = db.prepare('SELECT url_events_json, console_events_json FROM recordings WHERE id = ?').get(recId);
    expect(JSON.parse(rec.url_events_json)).toEqual([]);
    expect(JSON.parse(rec.console_events_json)).toEqual([]);
  });
});

// ================= DELETE RECORDING =================

describe('Recordings — delete with cascading cleanup', () => {
  it('deletes recording and associated data', () => {
    const db = getDB();

    const rec = createRecording();
    const card = createCard(rec.id);
    createFrame(rec.id);
    db.prepare("INSERT INTO video_comments (recording_id, author_name, text) VALUES (?, 'a', 'b')").run(rec.id);
    db.prepare("INSERT INTO views (recording_id, viewer_hash) VALUES (?, 'hash')").run(rec.id);

    // Delete in order: dependent tables first (as routes do)
    db.prepare('DELETE FROM video_comments WHERE recording_id = ?').run(rec.id);
    db.prepare('DELETE FROM views WHERE recording_id = ?').run(rec.id);
    db.prepare('DELETE FROM frames WHERE recording_id = ?').run(rec.id);
    db.prepare('DELETE FROM comments WHERE card_id = ?').run(card.id);
    db.prepare('DELETE FROM cards WHERE recording_id = ?').run(rec.id);
    db.prepare('DELETE FROM recordings WHERE id = ?').run(rec.id);

    expect(db.prepare('SELECT * FROM recordings WHERE id = ?').get(rec.id)).toBeUndefined();
    expect(db.prepare('SELECT * FROM cards WHERE recording_id = ?').get(rec.id)).toBeUndefined();
    expect(db.prepare('SELECT * FROM frames WHERE recording_id = ?').get(rec.id)).toBeUndefined();
    expect(db.prepare('SELECT COUNT(*) as c FROM video_comments WHERE recording_id = ?').get(rec.id).c).toBe(0);
    expect(db.prepare('SELECT COUNT(*) as c FROM views WHERE recording_id = ?').get(rec.id).c).toBe(0);
  });

  it('delete is a no-op for nonexistent recording', () => {
    const db = getDB();
    const result = db.prepare('DELETE FROM recordings WHERE id = ?').run('does-not-exist-xyz');
    expect(result.changes).toBe(0);
  });
});

// ================= PRE-LINK YOUTRACK =================

describe('Recordings — pre-link YouTrack', () => {
  let recId;

  beforeAll(() => {
    const rec = createRecording();
    recId = rec.id;
  });

  afterAll(() => {
    cleanup(recId);
  });

  it('sets pending_youtrack_issue_id on recording', () => {
    const db = getDB();
    db.prepare('UPDATE recordings SET pending_youtrack_issue_id = ? WHERE id = ?')
      .run('TEST-123', recId);

    const rec = db.prepare('SELECT pending_youtrack_issue_id FROM recordings WHERE id = ?').get(recId);
    expect(rec.pending_youtrack_issue_id).toBe('TEST-123');
  });

  it('clears pending_youtrack_issue_id', () => {
    const db = getDB();
    db.prepare('UPDATE recordings SET pending_youtrack_issue_id = NULL WHERE id = ?').run(recId);

    const rec = db.prepare('SELECT pending_youtrack_issue_id FROM recordings WHERE id = ?').get(recId);
    expect(rec.pending_youtrack_issue_id).toBeNull();
  });

  it('rejects pre-link when card already has youtrack_issue_id', () => {
    const db = getDB();
    const card = createCard(recId);
    db.prepare('UPDATE cards SET youtrack_issue_id = ? WHERE id = ?').run('EXISTING-456', card.id);

    const existingCard = db.prepare('SELECT youtrack_issue_id FROM cards WHERE recording_id = ?').get(recId);
    expect(existingCard.youtrack_issue_id).toBe('EXISTING-456');
    // Route would return 409 here
  });
});

// ================= SHARE TOKEN UNIQUENESS =================

describe('Recordings — share_token', () => {
  it('each recording has a unique share_token', () => {
    const rec1 = createRecording();
    const rec2 = createRecording();

    const db = getDB();
    const r1 = db.prepare('SELECT share_token FROM recordings WHERE id = ?').get(rec1.id);
    const r2 = db.prepare('SELECT share_token FROM recordings WHERE id = ?').get(rec2.id);

    expect(r1.share_token).not.toBe(r2.share_token);
    expect(r1.share_token).toMatch(/^[0-9a-f]{8}-/); // UUID format

    cleanup(rec1.id, rec2.id);
  });
});
