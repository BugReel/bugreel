/**
 * Migration: Create video_comments table for video-level comments with timecodes.
 *
 * This migration is applied automatically by db.js on startup
 * using CREATE TABLE IF NOT EXISTS (idempotent).
 *
 * Schema:
 *   video_comments (
 *     id                INTEGER PRIMARY KEY AUTOINCREMENT
 *     recording_id      TEXT NOT NULL      — references recordings(id)
 *     author_name       TEXT NOT NULL      — display name of commenter
 *     author_email      TEXT               — optional email (not displayed publicly)
 *     text              TEXT NOT NULL      — comment body (max 2000 chars)
 *     timecode_seconds  REAL               — nullable, video position in seconds
 *     created_at        TEXT               — ISO timestamp
 *   )
 *
 * Indexes:
 *   idx_video_comments_recording — fast lookup by recording_id
 */

export const up = `
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
`;
