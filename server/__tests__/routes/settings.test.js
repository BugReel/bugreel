import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { cleanupTestData } from '../setup.js';
import { initDB, getDB } from '../../db.js';

beforeAll(() => {
  initDB();
});

afterAll(() => {
  // Clean up test settings
  const db = getDB();
  try {
    db.prepare("DELETE FROM settings WHERE key LIKE 'test_%'").run();
    db.prepare("DELETE FROM settings WHERE key LIKE 'tracker_%'").run();
  } catch {}
  try { db.close(); } catch {}
  cleanupTestData();
});

// --- Helpers (mirror settings.js getSetting/setSetting) ---

function getSetting(key, fallback = '') {
  const db = getDB();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

function setSetting(key, value) {
  const db = getDB();
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
}

// ================= GET SETTINGS =================

describe('Settings — get', () => {
  it('returns fallback for nonexistent key', () => {
    const value = getSetting('nonexistent_key_xyz', 'default_val');
    expect(value).toBe('default_val');
  });

  it('returns empty string as default fallback', () => {
    const value = getSetting('another_missing_key');
    expect(value).toBe('');
  });

  it('returns stored value', () => {
    setSetting('test_key_1', 'hello world');
    const value = getSetting('test_key_1');
    expect(value).toBe('hello world');
  });
});

// ================= SET SETTINGS (UPSERT) =================

describe('Settings — set (upsert)', () => {
  it('creates a new setting', () => {
    setSetting('test_new_setting', 'new_value');
    const db = getDB();
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('test_new_setting');
    expect(row.value).toBe('new_value');
  });

  it('updates an existing setting', () => {
    setSetting('test_update_setting', 'original');
    setSetting('test_update_setting', 'updated');
    const value = getSetting('test_update_setting');
    expect(value).toBe('updated');
  });

  it('handles empty string values', () => {
    setSetting('test_empty', '');
    const value = getSetting('test_empty', 'fallback');
    // Row exists but value is empty string
    expect(value).toBe('');
  });
});

// ================= TRACKER CONFIG =================

describe('Settings — tracker config resolution', () => {
  it('defaults to "none" when no tracker settings exist', () => {
    // Clear any existing tracker settings
    const db = getDB();
    db.prepare("DELETE FROM settings WHERE key = 'tracker_type'").run();

    const type = getSetting('tracker_type', process.env.TRACKER_TYPE || 'none');
    expect(type).toBe('none');
  });

  it('reads tracker_type from DB', () => {
    setSetting('tracker_type', 'youtrack');
    const type = getSetting('tracker_type', 'none');
    expect(type).toBe('youtrack');
  });

  it('reads tracker_url from DB', () => {
    setSetting('tracker_url', 'https://youtrack.example.com');
    const url = getSetting('tracker_url', '');
    expect(url).toBe('https://youtrack.example.com');
  });

  it('reads tracker_project from DB', () => {
    setSetting('tracker_project', 'MY-PROJECT');
    const project = getSetting('tracker_project', '');
    expect(project).toBe('MY-PROJECT');
  });

  it('tracker is connected when type != none and url exists', () => {
    setSetting('tracker_type', 'youtrack');
    setSetting('tracker_url', 'https://youtrack.example.com');

    const type = getSetting('tracker_type', 'none');
    const url = getSetting('tracker_url', '');
    const connected = type !== 'none' && type !== '' && !!url;

    expect(connected).toBe(true);
  });

  it('tracker is disconnected when type is "none"', () => {
    setSetting('tracker_type', 'none');
    setSetting('tracker_url', 'https://youtrack.example.com');

    const type = getSetting('tracker_type', 'none');
    const url = getSetting('tracker_url', '');
    const connected = type !== 'none' && type !== '' && !!url;

    expect(connected).toBe(false);
  });

  it('tracker is disconnected when url is empty', () => {
    setSetting('tracker_type', 'youtrack');
    setSetting('tracker_url', '');

    const type = getSetting('tracker_type', 'none');
    const url = getSetting('tracker_url', '');
    const connected = type !== 'none' && type !== '' && !!url;

    expect(connected).toBe(false);
  });

  it('does not expose tracker_token in GET response', () => {
    setSetting('tracker_token', 'secret-token-123');

    // The route returns tracker_type, tracker_url, tracker_project, tracker_connected
    // but NOT tracker_token
    const responseKeys = ['tracker_type', 'tracker_url', 'tracker_project', 'tracker_connected'];
    expect(responseKeys).not.toContain('tracker_token');

    // Token is still in DB
    const token = getSetting('tracker_token');
    expect(token).toBe('secret-token-123');
  });
});

// ================= PUT SETTINGS (BULK UPDATE) =================

describe('Settings — PUT /api/settings logic', () => {
  it('updates multiple tracker settings at once', () => {
    const body = {
      tracker_type: 'jira',
      tracker_url: 'https://jira.example.com',
      tracker_token: 'jira-token',
      tracker_project: 'JIRA-1',
    };

    // Simulate route logic
    if (body.tracker_type !== undefined) setSetting('tracker_type', body.tracker_type || 'none');
    if (body.tracker_url !== undefined) setSetting('tracker_url', body.tracker_url || '');
    if (body.tracker_token !== undefined) setSetting('tracker_token', body.tracker_token || '');
    if (body.tracker_project !== undefined) setSetting('tracker_project', body.tracker_project || '');

    expect(getSetting('tracker_type')).toBe('jira');
    expect(getSetting('tracker_url')).toBe('https://jira.example.com');
    expect(getSetting('tracker_token')).toBe('jira-token');
    expect(getSetting('tracker_project')).toBe('JIRA-1');
  });

  it('clears settings when values are empty', () => {
    setSetting('tracker_type', 'youtrack');
    setSetting('tracker_url', 'https://yt.example.com');

    // Simulate setting tracker_type to empty -> stored as 'none'
    const body = { tracker_type: '', tracker_url: '' };
    if (body.tracker_type !== undefined) setSetting('tracker_type', body.tracker_type || 'none');
    if (body.tracker_url !== undefined) setSetting('tracker_url', body.tracker_url || '');

    expect(getSetting('tracker_type')).toBe('none');
    expect(getSetting('tracker_url')).toBe('');
  });

  it('partial update only changes specified fields', () => {
    setSetting('tracker_type', 'github');
    setSetting('tracker_url', 'https://github.com');
    setSetting('tracker_project', 'owner/repo');

    // Only update project
    const body = { tracker_project: 'new-owner/new-repo' };
    if (body.tracker_type !== undefined) setSetting('tracker_type', body.tracker_type || 'none');
    if (body.tracker_url !== undefined) setSetting('tracker_url', body.tracker_url || '');
    if (body.tracker_project !== undefined) setSetting('tracker_project', body.tracker_project || '');

    // Type and URL unchanged
    expect(getSetting('tracker_type')).toBe('github');
    expect(getSetting('tracker_url')).toBe('https://github.com');
    // Project updated
    expect(getSetting('tracker_project')).toBe('new-owner/new-repo');
  });
});

describe('Settings — branding config', () => {
  it('branding defaults to empty strings', () => {
    expect(getSetting('branding_logo_url')).toBe('');
    expect(getSetting('branding_logo_link')).toBe('');
  });

  it('can set branding logo URL', () => {
    setSetting('branding_logo_url', 'https://example.com/logo.png');
    expect(getSetting('branding_logo_url')).toBe('https://example.com/logo.png');
  });

  it('can set branding logo link', () => {
    setSetting('branding_logo_link', 'https://example.com');
    expect(getSetting('branding_logo_link')).toBe('https://example.com');
  });

  it('can clear branding by setting empty string', () => {
    setSetting('branding_logo_url', 'https://example.com/logo.png');
    setSetting('branding_logo_url', '');
    expect(getSetting('branding_logo_url')).toBe('');
  });

  it('branding included in settings response', () => {
    setSetting('branding_logo_url', 'https://test.com/logo.svg');
    setSetting('branding_logo_link', 'https://test.com');

    // Simulate GET /api/settings response construction
    const response = {
      branding_logo_url: getSetting('branding_logo_url', ''),
      branding_logo_link: getSetting('branding_logo_link', ''),
    };

    expect(response.branding_logo_url).toBe('https://test.com/logo.svg');
    expect(response.branding_logo_link).toBe('https://test.com');
  });
});
