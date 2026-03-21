import { Router } from 'express';
import { getDB } from '../db.js';
import { config } from '../config.js';

const router = Router();

/**
 * Helper: read a setting from DB, fall back to env/config.
 */
function getSetting(key, fallback = '') {
  const db = getDB();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

/**
 * Helper: write a setting to DB (upsert).
 */
function setSetting(key, value) {
  const db = getDB();
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
}

/**
 * Resolve effective tracker config: DB settings take priority, then env/config fallback.
 */
function getTrackerConfig() {
  const type = getSetting('tracker_type', process.env.TRACKER_TYPE || 'none');
  const url = getSetting('tracker_url', config.youtrack?.url || '');
  const project = getSetting('tracker_project', config.youtrack?.project || '');
  const token = getSetting('tracker_token', config.youtrack?.token || '');
  const connected = type !== 'none' && type !== '' && !!url;
  return { type, url, project, token, connected };
}

/**
 * GET /api/settings
 * Returns current settings (no token for security).
 */
router.get('/settings', (req, res) => {
  const tracker = getTrackerConfig();
  res.json({
    tracker_type: tracker.type,
    tracker_url: tracker.url,
    tracker_project: tracker.project,
    tracker_connected: tracker.connected,
  });
});

/**
 * PUT /api/settings
 * Save tracker settings.
 */
router.put('/settings', (req, res) => {
  const { tracker_type, tracker_url, tracker_token, tracker_project } = req.body;

  if (tracker_type !== undefined) setSetting('tracker_type', tracker_type || 'none');
  if (tracker_url !== undefined) setSetting('tracker_url', tracker_url || '');
  if (tracker_token !== undefined) setSetting('tracker_token', tracker_token || '');
  if (tracker_project !== undefined) setSetting('tracker_project', tracker_project || '');

  res.json({ ok: true });
});

/**
 * POST /api/settings/test-connection
 * Tests connection to the configured tracker.
 */
router.post('/settings/test-connection', async (req, res) => {
  const { tracker_type, tracker_url, tracker_token, tracker_project } = req.body;

  if (!tracker_type || tracker_type === 'none') {
    return res.status(400).json({ ok: false, message: 'No tracker type selected' });
  }

  if (!tracker_url && tracker_type !== 'linear') {
    return res.status(400).json({ ok: false, message: 'Server URL is required' });
  }

  try {
    if (tracker_type === 'youtrack') {
      const apiUrl = `${tracker_url.replace(/\/$/, '')}/api/admin/projects?fields=id,name,shortName&$top=100`;
      const response = await fetch(apiUrl, {
        headers: {
          'Authorization': `Bearer ${tracker_token}`,
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        const text = await response.text();
        return res.json({ ok: false, message: `YouTrack returned ${response.status}: ${text.slice(0, 200)}` });
      }

      const projects = await response.json();
      return res.json({ ok: true, message: `Connected to YouTrack (${projects.length} projects found)` });
    }

    if (tracker_type === 'jira') {
      const apiUrl = `${tracker_url.replace(/\/$/, '')}/rest/api/2/project`;
      const response = await fetch(apiUrl, {
        headers: {
          'Authorization': `Bearer ${tracker_token}`,
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        const text = await response.text();
        return res.json({ ok: false, message: `Jira returned ${response.status}: ${text.slice(0, 200)}` });
      }

      const projects = await response.json();
      return res.json({ ok: true, message: `Connected to Jira (${Array.isArray(projects) ? projects.length : '?'} projects found)` });
    }

    if (tracker_type === 'github') {
      const repo = tracker_project || '';
      if (!repo.includes('/')) {
        return res.json({ ok: false, message: 'Repository must be in format owner/repo' });
      }
      const apiUrl = `https://api.github.com/repos/${repo}`;
      const headers = { 'Accept': 'application/vnd.github.v3+json' };
      if (tracker_token) headers['Authorization'] = `Bearer ${tracker_token}`;

      const response = await fetch(apiUrl, {
        headers,
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        const text = await response.text();
        return res.json({ ok: false, message: `GitHub returned ${response.status}: ${text.slice(0, 200)}` });
      }

      const repoData = await response.json();
      return res.json({ ok: true, message: `Connected to GitHub: ${repoData.full_name} (${repoData.open_issues_count} open issues)` });
    }

    if (tracker_type === 'linear') {
      const response = await fetch('https://api.linear.app/graphql', {
        method: 'POST',
        headers: {
          'Authorization': tracker_token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: '{ teams { nodes { id name } } }' }),
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        const text = await response.text();
        return res.json({ ok: false, message: `Linear returned ${response.status}: ${text.slice(0, 200)}` });
      }

      const data = await response.json();
      const teams = data?.data?.teams?.nodes || [];
      return res.json({ ok: true, message: `Connected to Linear (${teams.length} teams found)` });
    }

    if (tracker_type === 'webhook') {
      // Test webhook by sending a ping
      const response = await fetch(tracker_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'ping', timestamp: new Date().toISOString() }),
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        return res.json({ ok: false, message: `Webhook returned ${response.status}` });
      }

      return res.json({ ok: true, message: `Webhook responded with ${response.status} OK` });
    }

    return res.json({ ok: false, message: `Unknown tracker type: ${tracker_type}` });
  } catch (err) {
    return res.json({ ok: false, message: `Connection failed: ${err.message}` });
  }
});

export default router;
export { getTrackerConfig };
