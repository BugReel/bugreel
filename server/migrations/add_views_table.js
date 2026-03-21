/**
 * Migration: Create views table for view analytics tracking.
 *
 * This migration is applied automatically by db.js on startup
 * using CREATE TABLE IF NOT EXISTS (idempotent).
 *
 * Schema:
 *   views (
 *     id            INTEGER PRIMARY KEY AUTOINCREMENT
 *     recording_id  TEXT NOT NULL  — references recordings(id)
 *     viewer_hash   TEXT NOT NULL  — SHA-256 of IP (no raw IPs stored)
 *     user_agent    TEXT           — browser user-agent string
 *     referrer      TEXT           — HTTP referrer
 *     created_at    TEXT           — ISO timestamp of initial view
 *     duration_seconds INTEGER DEFAULT 0 — accumulated watch time via heartbeats
 *   )
 *
 * Indexes:
 *   idx_views_recording  — fast lookup by recording_id
 *   idx_views_rate_limit — rate-limit check: 1 view per IP per recording per hour
 */

export const up = `
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
`;
