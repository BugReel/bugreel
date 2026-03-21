import Database from 'better-sqlite3';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { config } from './config.js';

// DB lives inside dataDir (same directory as recordings)
const dbDir = config.dataDir;
const dbPath = path.join(dbDir, 'tracker.db');

let db;

export function getDB() {
  if (!db) {
    fs.mkdirSync(dbDir, { recursive: true });
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

export function initDB() {
  const db = getDB();

  db.exec(`
    CREATE TABLE IF NOT EXISTS recordings (
      id TEXT PRIMARY KEY,
      author TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      status TEXT DEFAULT 'uploaded',
      video_filename TEXT,
      audio_filename TEXT,
      duration_seconds INTEGER,
      file_size_bytes INTEGER,
      transcript_json TEXT,
      analysis_json TEXT,
      youtrack_issue_id TEXT,
      youtrack_url TEXT,
      url_events_json TEXT,
      metadata_json TEXT,
      console_events_json TEXT
    );

    CREATE TABLE IF NOT EXISTS frames (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recording_id TEXT REFERENCES recordings(id),
      time_seconds REAL,
      description TEXT,
      filename TEXT
    );

    CREATE TABLE IF NOT EXISTS cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recording_id TEXT REFERENCES recordings(id),
      type TEXT,
      category TEXT,
      title TEXT,
      description TEXT,
      cs_scope TINYINT,
      cs_risk TINYINT,
      cs_domain TINYINT,
      cs_novelty TINYINT,
      cs_clarity TINYINT,
      cs_total INTEGER,
      cs_weighted REAL,
      cs_category TEXT,
      architecture_json TEXT,
      affected_files TEXT,
      related_cards TEXT,
      assigned_to TEXT,
      priority TEXT DEFAULT 'medium',
      actual_cs INTEGER,
      actual_time_minutes INTEGER,
      required_human_help INTEGER DEFAULT 0,
      docs_updated TEXT,
      youtrack_issue_id TEXT,
      status TEXT DEFAULT 'draft',
      created_at TEXT DEFAULT (datetime('now')),
      closed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      card_id INTEGER REFERENCES cards(id),
      author TEXT,
      text TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS youtrack_users (
      author TEXT PRIMARY KEY,
      youtrack_id TEXT NOT NULL,
      youtrack_login TEXT NOT NULL,
      youtrack_name TEXT
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT,
      avatar_url TEXT,
      auth_provider TEXT NOT NULL DEFAULT 'simple',
      provider_user_id TEXT,
      provider_access_token TEXT,
      provider_refresh_token TEXT,
      password_hash TEXT,
      role TEXT NOT NULL DEFAULT 'member',
      created_at TEXT DEFAULT (datetime('now')),
      last_login_at TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL DEFAULT 'dashboard',
      user_agent TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS invites (
      code TEXT PRIMARY KEY,
      created_by TEXT REFERENCES users(id),
      role TEXT NOT NULL DEFAULT 'member',
      used_by TEXT REFERENCES users(id),
      used_at TEXT,
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS views (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recording_id TEXT NOT NULL,
      viewer_hash TEXT NOT NULL,
      user_agent TEXT,
      referrer TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      duration_seconds INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_views_recording
      ON views (recording_id);

    CREATE INDEX IF NOT EXISTS idx_views_rate_limit
      ON views (recording_id, viewer_hash, created_at);

    CREATE TABLE IF NOT EXISTS video_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recording_id TEXT NOT NULL,
      author_name TEXT NOT NULL,
      author_email TEXT,
      text TEXT NOT NULL,
      timecode_seconds REAL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_video_comments_recording
      ON video_comments (recording_id);
  `);

  // Migrations for existing tables
  try { db.exec('ALTER TABLE cards ADD COLUMN summary TEXT'); } catch {}
  try { db.exec('ALTER TABLE recordings ADD COLUMN url_events_json TEXT'); } catch {}
  try { db.exec('ALTER TABLE recordings ADD COLUMN metadata_json TEXT'); } catch {}
  try { db.exec('ALTER TABLE recordings ADD COLUMN console_events_json TEXT'); } catch {}
  try { db.exec('ALTER TABLE recordings ADD COLUMN action_events_json TEXT'); } catch {}
  try { db.exec('ALTER TABLE recordings ADD COLUMN manual_markers_json TEXT'); } catch {}
  try { db.exec('ALTER TABLE frames ADD COLUMN is_manual INTEGER DEFAULT 0'); } catch {}
  try { db.exec('ALTER TABLE recordings ADD COLUMN pending_youtrack_issue_id TEXT'); } catch {}
  try { db.exec('ALTER TABLE frames ADD COLUMN detail TEXT'); } catch {}
  try { db.exec('ALTER TABLE recordings ADD COLUMN trim_start REAL'); } catch {}
  try { db.exec('ALTER TABLE recordings ADD COLUMN trim_end REAL'); } catch {}
  try { db.exec('ALTER TABLE recordings ADD COLUMN segments_json TEXT'); } catch {}
  try { db.exec('ALTER TABLE recordings ADD COLUMN password_hash TEXT'); } catch {}

  // Migration: add password_hash to users if missing (for existing DBs)
  try { db.exec('ALTER TABLE users ADD COLUMN password_hash TEXT'); } catch {}

  // Seed: create default admin from DASHBOARD_PASSWORD for backward compatibility
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  if (userCount === 0 && config.dashboardPassword) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(config.dashboardPassword, salt, 64).toString('hex');
    const passwordHash = `${salt}:${hash}`;
    db.prepare(`
      INSERT INTO users (id, name, email, auth_provider, password_hash, role)
      VALUES (?, 'Admin', 'admin@bugreel.local', 'simple', ?, 'admin')
    `).run(crypto.randomUUID(), passwordHash);
    console.log('Created default admin user from DASHBOARD_PASSWORD');
  }

  // Cleanup: remove orphaned frames without extracted images
  const orphaned = db.prepare("DELETE FROM frames WHERE filename IS NULL OR filename = ''").run();
  if (orphaned.changes > 0) {
    console.log(`Cleaned up ${orphaned.changes} orphaned frame(s) without images`);
  }

  // YouTrack user mappings are managed via the API (POST /api/youtrack-users)
  // No seed data — configure your team mappings after deployment

  console.log('Database initialized at', dbPath);
}

export function generateRecordingId() {
  const db = getDB();
  const year = new Date().getFullYear();
  const prefix = `REC-${year}-`;
  const row = db.prepare('SELECT COUNT(*) as count FROM recordings WHERE id LIKE ?').get(`${prefix}%`);
  const num = (row.count + 1).toString().padStart(4, '0');
  return `${prefix}${num}`;
}
