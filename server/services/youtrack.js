import { config } from '../config.js';
import fetch from 'node-fetch';
import https from 'https';
import FormData from 'form-data';
import fs from 'fs';

function isConfigured() {
  return !!(config.youtrack.url && config.youtrack.token);
}

/**
 * Create an issue in YouTrack.
 */
export async function createIssue({ summary, description, type, reporterId, project }) {
  if (!isConfigured()) {
    console.log('[YouTrack] Not configured, skipping');
    return null;
  }

  const body = {
    project: { shortName: project || config.youtrack.project },
    summary,
    description,
  };

  if (reporterId) {
    body.reporter = { id: reporterId };
  }

  let res;
  try {
    res = await fetch(`${config.youtrack.url}/api/issues?fields=id,idReadable,reporter(login,name)`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.youtrack.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.error(`[YouTrack] Request failed: ${err.message}`);
    return null;
  }

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    console.error(`[YouTrack] Error ${res.status}: ${errBody}`);
    return null;
  }

  return await res.json();
}

/**
 * Search issues in YouTrack.
 */
export async function searchIssues(query, top = 20) {
  if (!isConfigured()) return [];

  const params = new URLSearchParams({
    query,
    fields: 'id,idReadable,summary,resolved,customFields(name,value(name))',
    $top: String(top),
  });

  let res;
  try {
    res = await fetch(`${config.youtrack.url}/api/issues?${params}`, {
      headers: {
        'Authorization': `Bearer ${config.youtrack.token}`,
      },
    });
  } catch (err) {
    console.error(`[YouTrack] Search failed: ${err.message}`);
    return [];
  }

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    console.error(`[YouTrack] Search error ${res.status}: ${errBody}`);
    return [];
  }

  return await res.json();
}

/**
 * Add a comment to an existing YouTrack issue.
 */
export async function addComment(issueId, text) {
  if (!isConfigured()) return null;

  let res;
  try {
    res = await fetch(`${config.youtrack.url}/api/issues/${issueId}/comments`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.youtrack.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text }),
    });
  } catch (err) {
    console.error(`[YouTrack] Comment failed: ${err.message}`);
    return null;
  }

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    console.error(`[YouTrack] Comment error ${res.status}: ${errBody}`);
    return null;
  }

  return await res.json();
}

/**
 * Attach a file to a YouTrack issue using native https (avoids HTTP/2 issues).
 */
export async function attachFile(issueId, filePath) {
  if (!isConfigured()) return null;
  if (!fs.existsSync(filePath)) {
    console.error(`[YouTrack] File not found: ${filePath}`);
    return null;
  }

  const form = new FormData();
  form.append('file', fs.createReadStream(filePath));

  const url = new URL(`${config.youtrack.url}/api/issues/${issueId}/attachments`);

  return new Promise((resolve) => {
    const req = https.request({
      hostname: url.hostname,
      port: 443,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.youtrack.token}`,
        ...form.getHeaders(),
      },
      // Force HTTP/1.1 — YouTrack Cloud returns PROTOCOL_ERROR on HTTP/2 file uploads
      ALPNProtocols: ['http/1.1'],
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(data)); } catch { resolve({ ok: true }); }
        } else {
          console.error(`[YouTrack] Attachment error ${res.statusCode}: ${data.substring(0, 200)}`);
          resolve(null);
        }
      });
    });

    req.on('error', (err) => {
      console.error(`[YouTrack] Attachment failed: ${err.message}`);
      resolve(null);
    });

    req.setTimeout(60000, () => {
      console.error('[YouTrack] Attachment timeout');
      req.destroy();
      resolve(null);
    });

    form.pipe(req);
  });
}
