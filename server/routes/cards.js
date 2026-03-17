import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { getDB } from '../db.js';
import { config } from '../config.js';
import { createIssue, attachFile, searchIssues, addComment } from '../services/youtrack.js';
import { analyzeTranscript } from '../services/gpt.js';
import { extractFrame } from '../services/ffmpeg.js';
import { formatDescription } from '../services/pipeline.js';
import { getIntegration } from '../integrations/registry.js';

const router = Router();

function formatTimecode(seconds) {
  const s = Math.round(seconds || 0);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// List cards with optional filters, JOIN recordings for author
router.get('/cards', (req, res) => {
  const db = getDB();
  const { status, assigned_to, priority, limit = 50, offset = 0 } = req.query;

  let where = '';
  const conditions = [];
  const params = [];

  if (status) {
    conditions.push('c.status = ?');
    params.push(status);
  }
  if (assigned_to) {
    conditions.push('c.assigned_to = ?');
    params.push(assigned_to);
  }
  if (priority) {
    conditions.push('c.priority = ?');
    params.push(priority);
  }
  if (conditions.length) {
    where = ' WHERE ' + conditions.join(' AND ');
  }

  const countRow = db.prepare(
    `SELECT COUNT(*) as total FROM cards c${where}`
  ).get(...params);

  const rows = db.prepare(
    `SELECT c.*, r.author as recording_author,
      (SELECT f.filename FROM frames f WHERE f.recording_id = c.recording_id ORDER BY f.time_seconds LIMIT 1) as first_frame
     FROM cards c
     LEFT JOIN recordings r ON c.recording_id = r.id${where}
     ORDER BY c.created_at DESC LIMIT ? OFFSET ?`
  ).all(...params, parseInt(limit), parseInt(offset));

  res.json({ cards: rows, total: countRow.total });
});

// Single card with comments and frames
router.get('/cards/:id', (req, res) => {
  const db = getDB();

  const card = db.prepare(
    `SELECT c.*, r.author as recording_author
     FROM cards c
     LEFT JOIN recordings r ON c.recording_id = r.id
     WHERE c.id = ?`
  ).get(req.params.id);
  if (!card) return res.status(404).json({ error: 'Not found' });

  const comments = db.prepare(
    'SELECT * FROM comments WHERE card_id = ? ORDER BY created_at'
  ).all(req.params.id);

  const frames = db.prepare(
    'SELECT * FROM frames WHERE recording_id = ? ORDER BY time_seconds'
  ).all(card.recording_id);

  res.json({ card, comments, frames });
});

// Add comment to a card
router.post('/cards/:id/comment', (req, res) => {
  const db = getDB();
  const { author, text } = req.body;

  if (!text) return res.status(400).json({ error: 'text is required' });

  const cardExists = db.prepare('SELECT id FROM cards WHERE id = ?').get(req.params.id);
  if (!cardExists) return res.status(404).json({ error: 'Card not found' });

  const result = db.prepare(
    'INSERT INTO comments (card_id, author, text) VALUES (?, ?, ?)'
  ).run(req.params.id, author || 'Unknown', text);

  res.json({ ok: true, commentId: result.lastInsertRowid });
});

// Update Complexity Score (CS) for a card
router.post('/cards/:id/score', (req, res) => {
  const db = getDB();
  const { cs_scope, cs_risk, cs_domain, cs_novelty, cs_clarity } = req.body;

  const cardExists = db.prepare('SELECT id FROM cards WHERE id = ?').get(req.params.id);
  if (!cardExists) return res.status(404).json({ error: 'Card not found' });

  const total = (cs_scope || 0) + (cs_risk || 0) + (cs_domain || 0) + (cs_novelty || 0) + (cs_clarity || 0);

  let category, multiplier;
  if (total >= 14) {
    category = 'critical';
    multiplier = 3.0;
  } else if (total >= 11) {
    category = 'hard';
    multiplier = 2.0;
  } else if (total >= 8) {
    category = 'medium';
    multiplier = 1.5;
  } else {
    category = 'easy';
    multiplier = 1.0;
  }

  const weighted = total * multiplier;

  db.prepare(`
    UPDATE cards SET
      cs_scope = ?, cs_risk = ?, cs_domain = ?, cs_novelty = ?, cs_clarity = ?,
      cs_total = ?, cs_weighted = ?, cs_category = ?,
      status = 'scored'
    WHERE id = ?
  `).run(cs_scope, cs_risk, cs_domain, cs_novelty, cs_clarity, total, weighted, category, req.params.id);

  res.json({ ok: true, cs_total: total, cs_weighted: weighted, cs_category: category });
});

// Update card fields (title, description, type, priority)
router.put('/cards/:id', (req, res) => {
  const db = getDB();
  const allowedFields = ['title', 'description', 'summary', 'type', 'priority', 'assigned_to', 'status'];
  const updates = [];
  const values = [];

  for (const field of allowedFields) {
    if (req.body[field] !== undefined) {
      updates.push(`${field} = ?`);
      values.push(req.body[field]);
    }
  }

  if (!updates.length) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }

  const cardExists = db.prepare('SELECT id FROM cards WHERE id = ?').get(req.params.id);
  if (!cardExists) return res.status(404).json({ error: 'Card not found' });

  values.push(req.params.id);
  db.prepare(`UPDATE cards SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  const card = db.prepare('SELECT * FROM cards WHERE id = ?').get(req.params.id);
  res.json({ ok: true, card });
});

// Generic export via integration registry
router.post('/cards/:id/export', async (req, res) => {
  const db = getDB();
  const { integration: integrationName, ...options } = req.body || {};

  const card = db.prepare(
    `SELECT c.*, r.author as recording_author, r.id as rec_id
     FROM cards c LEFT JOIN recordings r ON c.recording_id = r.id
     WHERE c.id = ?`
  ).get(req.params.id);
  if (!card) return res.status(404).json({ error: 'Card not found' });

  const frames = db.prepare(
    'SELECT * FROM frames WHERE recording_id = ? ORDER BY time_seconds'
  ).all(card.rec_id);

  // Default to youtrack for backwards compatibility
  const name = integrationName || 'youtrack';

  // Build integration config from server config + request options
  let integrationConfig = {};
  if (name === 'youtrack') {
    integrationConfig = { ...config.youtrack, ...options };
  } else if (name === 'webhook') {
    integrationConfig = { ...options };
  } else {
    integrationConfig = { ...options };
  }

  let integration;
  try {
    integration = getIntegration(name, integrationConfig);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  try {
    const result = await integration.createIssue(card, frames, {
      baseUrl: config.dashboardUrl,
      project: options.project,
      ...options,
    });

    if (!result) {
      return res.status(502).json({ error: `${name} integration returned no result` });
    }

    // Store issue link in DB if the integration returned a key/id
    if (result.key && name === 'youtrack') {
      db.prepare('UPDATE cards SET youtrack_issue_id = ? WHERE id = ?').run(result.key, card.id);
      if (card.rec_id) {
        db.prepare('UPDATE recordings SET youtrack_issue_id = ?, youtrack_url = ? WHERE id = ?')
          .run(result.key, result.url, card.rec_id);
      }
    }

    console.log(`[Card #${card.id}] Exported via ${name}: id=${result.id}, url=${result.url}`);

    res.json({
      ok: true,
      integration: name,
      issue_id: result.id,
      issue_url: result.url,
      issue_key: result.key,
    });
  } catch (err) {
    console.error(`[Card #${card.id}] Export via ${name} failed: ${err.message}`);
    res.status(502).json({ error: err.message });
  }
});

// --- Reanalyze recording with GPT (re-run analysis + update card) ---

router.post('/recordings/:id/reanalyze', async (req, res) => {
  const db = getDB();
  const recording = db.prepare('SELECT * FROM recordings WHERE id = ?').get(req.params.id);
  if (!recording) return res.status(404).json({ error: 'Recording not found' });
  if (!recording.transcript_json) return res.status(400).json({ error: 'No transcript available' });

  let transcript, urlEvents = null, consoleEvents = null, actionEvents = null;
  try { transcript = JSON.parse(recording.transcript_json); } catch { return res.status(400).json({ error: 'Invalid transcript' }); }
  try { if (recording.url_events_json) urlEvents = JSON.parse(recording.url_events_json); } catch {}
  try { if (recording.console_events_json) consoleEvents = JSON.parse(recording.console_events_json); } catch {}
  try { if (recording.action_events_json) actionEvents = JSON.parse(recording.action_events_json); } catch {}

  console.log(`[${req.params.id}] Reanalyzing with GPT...`);
  const analysis = await analyzeTranscript(transcript, urlEvents, consoleEvents, actionEvents);
  db.prepare('UPDATE recordings SET analysis_json = ? WHERE id = ?').run(JSON.stringify(analysis), req.params.id);

  // Update card if exists
  const card = db.prepare('SELECT * FROM cards WHERE recording_id = ?').get(req.params.id);
  if (card) {
    const description = formatDescription(analysis);
    db.prepare('UPDATE cards SET title = ?, type = ?, summary = ?, description = ? WHERE id = ?')
      .run(analysis.title || card.title, analysis.type || card.type, analysis.summary || card.summary, description, card.id);
  }

  // Re-extract frames if keyFrames changed
  if (analysis.keyFrames?.length) {
    const recDir = path.join(config.dataDir, req.params.id);
    const videoPath = path.join(recDir, 'video.webm');
    const framesDir = path.join(recDir, 'frames');
    if (fs.existsSync(videoPath)) {
      fs.mkdirSync(framesDir, { recursive: true });
      // Delete old frames from DB
      db.prepare('DELETE FROM frames WHERE recording_id = ?').run(req.params.id);
      // Extract new frames
      for (let i = 0; i < analysis.keyFrames.length; i++) {
        const kf = analysis.keyFrames[i];
        const idx = String(i + 1).padStart(3, '0');
        const filename = `${idx}_${kf.time.toFixed(1)}s.jpg`;
        const framePath = path.join(framesDir, filename);
        try {
          await extractFrame(videoPath, kf.time, framePath);
          db.prepare('INSERT INTO frames (recording_id, filename, time_seconds, description) VALUES (?, ?, ?, ?)')
            .run(req.params.id, filename, kf.time, kf.description || '');
        } catch (err) {
          console.error(`[${req.params.id}] Frame extraction failed at ${kf.time}s: ${err.message}`);
        }
      }
    }
  }

  console.log(`[${req.params.id}] Reanalysis complete: type=${analysis.type}, title="${analysis.title}"`);
  res.json({ ok: true, analysis, card_updated: !!card });
});

// --- YouTrack Export (manual, per card) ---

router.post('/cards/:id/export-youtrack', async (req, res) => {
  const db = getDB();

  const card = db.prepare(
    `SELECT c.*, r.author as recording_author, r.id as rec_id,
       r.url_events_json, r.metadata_json, r.console_events_json,
       r.transcript_json, r.action_events_json
     FROM cards c LEFT JOIN recordings r ON c.recording_id = r.id
     WHERE c.id = ?`
  ).get(req.params.id);
  if (!card) return res.status(404).json({ error: 'Card not found' });

  if (card.youtrack_issue_id) {
    return res.status(409).json({ error: 'Already exported', youtrack_issue_id: card.youtrack_issue_id });
  }

  // Resolve author → YouTrack user for reporter
  const author = card.recording_author || 'Unknown';
  const ytUser = db.prepare('SELECT * FROM youtrack_users WHERE author = ? OR youtrack_login = ? OR youtrack_name = ? LIMIT 1').get(author, author, author);
  const reporterId = ytUser ? ytUser.youtrack_id : null;

  // Build rich description with screenshots and video link
  const frames = db.prepare('SELECT * FROM frames WHERE recording_id = ? ORDER BY time_seconds').all(card.rec_id);
  const dashboardUrl = config.dashboardUrl;
  const recordingUrl = `${dashboardUrl}/recording/${encodeURIComponent(card.rec_id)}`;

  let richDescription = card.description || '';

  if (frames.length) {
    richDescription += `\n\n**Screenshots:**\n`;
    for (const frame of frames) {
      const frameImgUrl = `${dashboardUrl}/api/recordings/${encodeURIComponent(card.rec_id)}/frames/${encodeURIComponent(frame.filename)}`;
      richDescription += `![${frame.description || formatTimecode(frame.time_seconds)}](${frameImgUrl})\n`;
    }
  }

  // Affected Pages (from URL events)
  if (card.url_events_json) {
    try {
      const urlEvents = JSON.parse(card.url_events_json);
      if (urlEvents.length > 0) {
        richDescription += `\n\n---\n**Affected Pages:**\n`;
        const seen = new Set();
        for (const ev of urlEvents) {
          if (!seen.has(ev.url)) {
            seen.add(ev.url);
            const mins = Math.floor(ev.ts / 60);
            const secs = Math.floor(ev.ts % 60);
            const time = `${mins}:${String(secs).padStart(2, '0')}`;
            const title = ev.title || new URL(ev.url).pathname;
            richDescription += `- [${title}](${ev.url}) (${time})\n`;
          }
        }
      }
    } catch (e) { /* ignore parse errors */ }
  }

  // Console Errors & Warnings
  if (card.console_events_json) {
    try {
      const consoleEvents = JSON.parse(card.console_events_json);
      const issues = consoleEvents.filter(e => e.level === 'error' || e.level === 'warning');
      if (issues.length > 0) {
        richDescription += `\n**Console Errors & Warnings:**\n`;
        for (const err of issues.slice(0, 15)) {
          const mins = Math.floor(err.ts / 60);
          const secs = Math.floor(err.ts % 60);
          const time = `${mins}:${String(secs).padStart(2, '0')}`;
          const icon = err.level === 'error' ? '🔴' : '🟡';
          richDescription += `- ${icon} \`[${time}] ${err.text}\``;
          if (err.source && err.source !== 'unknown') richDescription += ` (${err.source})`;
          richDescription += `\n`;
        }
      }
    } catch (e) { /* ignore */ }
  }

  // User Actions (clicks, modals, selections)
  if (card.action_events_json) {
    try {
      const actions = JSON.parse(card.action_events_json);
      if (actions.length > 0) {
        const ACTION_LABELS = { click: 'Click', modal_open: 'Modal open', modal_close: 'Modal close', text_select: 'Select', form_submit: 'Submit' };
        richDescription += `\n<details>\n<summary>User Actions (${actions.length})</summary>\n\n`;
        for (const a of actions) {
          const mins = Math.floor(a.ts / 60);
          const secs = Math.floor(a.ts % 60);
          const time = `${mins}:${String(secs).padStart(2, '0')}`;
          const type = ACTION_LABELS[a.eventType] || a.eventType;
          const label = a.ariaLabel || a.text || '';
          richDescription += `- \`[${time}]\` ${type}: ${label.slice(0, 80)}\n`;
        }
        richDescription += `\n</details>\n`;
      }
    } catch (e) { /* ignore */ }
  }

  // Environment (browser, OS, screen)
  if (card.metadata_json) {
    try {
      const meta = JSON.parse(card.metadata_json);
      const parts = [];
      if (meta.userAgent) {
        const ua = meta.userAgent;
        const chromeMatch = ua.match(/Chrome\/([\d.]+)/);
        const firefoxMatch = ua.match(/Firefox\/([\d.]+)/);
        const browser = chromeMatch ? `Chrome ${chromeMatch[1].split('.')[0]}` :
                        firefoxMatch ? `Firefox ${firefoxMatch[1].split('.')[0]}` : 'Unknown browser';
        parts.push(browser);

        const macMatch = ua.match(/Mac OS X ([\d_]+)/);
        const winMatch = ua.match(/Windows NT ([\d.]+)/);
        const linuxMatch = ua.match(/Linux/);
        const os = macMatch ? `macOS ${macMatch[1].replace(/_/g, '.')}` :
                   winMatch ? `Windows ${winMatch[1]}` :
                   linuxMatch ? 'Linux' : '';
        if (os) parts.push(os);
      }
      const sw = meta.screenWidth ?? meta.screen?.width;
      const sh = meta.screenHeight ?? meta.screen?.height;
      const dpr = meta.devicePixelRatio ?? meta.screen?.devicePixelRatio;
      if (sw && sh) {
        let screen = `${sw}\u00d7${sh}`;
        if (dpr && dpr > 1) screen += ` @${dpr}x`;
        parts.push(screen);
      }
      if (parts.length > 0) {
        richDescription += `\n**Environment:** ${parts.join(', ')}\n`;
      }
    } catch (e) { /* ignore */ }
  }

  richDescription += `\n\n---\n`;
  richDescription += `**Video:** [${card.rec_id}](${recordingUrl})\n`;

  // Transcript (collapsible)
  if (card.transcript_json) {
    try {
      const transcript = typeof card.transcript_json === 'string'
        ? JSON.parse(card.transcript_json)
        : card.transcript_json;
      if (transcript.words && transcript.words.length > 0) {
        richDescription += `\n<details>\n<summary>Transcript</summary>\n\n`;
        let currentChunk = '';
        let chunkStart = transcript.words[0].start;
        for (const word of transcript.words) {
          if (word.start - chunkStart >= 10 && currentChunk) {
            const mins = Math.floor(chunkStart / 60);
            const secs = Math.floor(chunkStart % 60);
            richDescription += `[${mins}:${String(secs).padStart(2, '0')}] ${currentChunk.trim()}\n`;
            currentChunk = '';
            chunkStart = word.start;
          }
          currentChunk += word.word + ' ';
        }
        if (currentChunk) {
          const mins = Math.floor(chunkStart / 60);
          const secs = Math.floor(chunkStart % 60);
          richDescription += `[${mins}:${String(secs).padStart(2, '0')}] ${currentChunk.trim()}\n`;
        }
        richDescription += `\n</details>\n`;
      }
    } catch (e) { /* ignore */ }
  }

  // Create issue (project from request body or default from config)
  const requestProject = req.body?.project || null;
  const issue = await createIssue({
    summary: card.title || 'Untitled',
    description: richDescription,
    type: card.type,
    reporterId,
    project: requestProject,
  });

  if (!issue) {
    return res.status(502).json({ error: 'YouTrack API error' });
  }

  const issueId = issue.idReadable || issue.id;
  const issueUrl = `${config.youtrack.url}/issue/${issueId}`;

  // Save to DB
  db.prepare('UPDATE cards SET youtrack_issue_id = ? WHERE id = ?').run(issueId, card.id);
  db.prepare('UPDATE recordings SET youtrack_issue_id = ?, youtrack_url = ? WHERE id = ?')
    .run(issueId, issueUrl, card.rec_id);

  const attached = frames.length; // embedded as links

  console.log(`[Card #${card.id}] Exported to YouTrack: ${issueId}, reporter: ${ytUser?.youtrack_login || 'token owner'}, frames: ${attached}`);

  res.json({
    ok: true,
    youtrack_issue_id: issueId,
    youtrack_url: issueUrl,
    reporter: ytUser ? ytUser.youtrack_name : null,
    frames_attached: attached,
  });
});

// --- YouTrack Issue Search ---

router.get('/youtrack-search', async (req, res) => {
  const db = getDB();
  const { author, state, q, all, project } = req.query;

  // Build base filters (project + state)
  let base = '';
  if (project) base += `project: ${project} `;
  if (state) base += `State: {${state}} `;
  else if (!all) base += '#Unresolved ';
  if (q) base += q + ' ';

  // Resolve author → YT login
  let ytLogin = null;
  if (author) {
    const ytUser = db.prepare('SELECT * FROM youtrack_users WHERE author = ? OR youtrack_login = ? OR youtrack_name = ? LIMIT 1').get(author, author, author);
    if (ytUser) ytLogin = ytUser.youtrack_login;
  }

  let allIssues;
  if (ytLogin) {
    // Two queries: Assignee + Reporter, then merge
    const [byAssignee, byReporter] = await Promise.all([
      searchIssues(`${base}Assignee: ${ytLogin}`.trim()),
      searchIssues(`${base}by: ${ytLogin}`.trim()),
    ]);
    // Merge & deduplicate by idReadable
    const seen = new Set();
    allIssues = [];
    for (const issue of [...(byAssignee || []), ...(byReporter || [])]) {
      if (!seen.has(issue.idReadable)) {
        seen.add(issue.idReadable);
        allIssues.push(issue);
      }
    }
  } else {
    allIssues = await searchIssues(base.trim() || '#Unresolved');
  }

  const result = (allIssues || []).map(issue => {
    const stateField = issue.customFields?.find(f => f.name === 'State');
    return {
      id: issue.idReadable,
      summary: issue.summary,
      state: stateField?.value?.name || null,
      resolved: !!issue.resolved,
    };
  });

  res.json({ issues: result });
});

// --- Link card to existing YouTrack issue ---

router.post('/cards/:id/link-youtrack', async (req, res) => {
  const db = getDB();
  const { youtrack_issue_id } = req.body;

  if (!youtrack_issue_id) {
    return res.status(400).json({ error: 'youtrack_issue_id required' });
  }

  const card = db.prepare(
    `SELECT c.*, r.author as recording_author, r.id as rec_id,
       r.duration_seconds, r.url_events_json, r.metadata_json,
       r.console_events_json, r.transcript_json, r.action_events_json
     FROM cards c LEFT JOIN recordings r ON c.recording_id = r.id
     WHERE c.id = ?`
  ).get(req.params.id);
  if (!card) return res.status(404).json({ error: 'Card not found' });

  if (card.youtrack_issue_id) {
    return res.status(409).json({ error: 'Already linked', youtrack_issue_id: card.youtrack_issue_id });
  }

  // Build rich comment for existing issue (same context as export)
  const frames = db.prepare('SELECT * FROM frames WHERE recording_id = ? ORDER BY time_seconds').all(card.rec_id);
  const dashboardUrl = '${config.dashboardUrl}';
  const recordingUrl = `${dashboardUrl}/recording/${encodeURIComponent(card.rec_id)}`;

  let comment = `## Video Report: ${card.rec_id}\n`;
  comment += `**Author:** ${card.recording_author || 'Unknown'}`;
  if (card.duration_seconds) {
    comment += ` | **Duration:** ${formatTimecode(card.duration_seconds)}`;
  }
  comment += '\n\n';

  if (card.summary) {
    comment += `${card.summary}\n\n`;
  }

  if (card.description) {
    comment += `${card.description}\n\n`;
  }

  if (frames.length) {
    for (const frame of frames) {
      const frameImgUrl = `${dashboardUrl}/api/recordings/${encodeURIComponent(card.rec_id)}/frames/${encodeURIComponent(frame.filename)}`;
      comment += `![${frame.description || formatTimecode(frame.time_seconds)}](${frameImgUrl})\n`;
    }
    comment += '\n';
  }

  // Affected Pages
  if (card.url_events_json) {
    try {
      const urlEvents = JSON.parse(card.url_events_json);
      if (urlEvents.length > 0) {
        comment += `---\n**Affected Pages:**\n`;
        const seen = new Set();
        for (const ev of urlEvents) {
          if (!seen.has(ev.url)) {
            seen.add(ev.url);
            const mins = Math.floor(ev.ts / 60);
            const secs = Math.floor(ev.ts % 60);
            const time = `${mins}:${String(secs).padStart(2, '0')}`;
            const title = ev.title || new URL(ev.url).pathname;
            comment += `- [${title}](${ev.url}) (${time})\n`;
          }
        }
        comment += '\n';
      }
    } catch (e) { /* ignore parse errors */ }
  }

  // Console Errors & Warnings
  if (card.console_events_json) {
    try {
      const consoleEvents = JSON.parse(card.console_events_json);
      const issues = consoleEvents.filter(e => e.level === 'error' || e.level === 'warning');
      if (issues.length > 0) {
        comment += `**Console Errors & Warnings:**\n`;
        for (const err of issues.slice(0, 15)) {
          const mins = Math.floor(err.ts / 60);
          const secs = Math.floor(err.ts % 60);
          const time = `${mins}:${String(secs).padStart(2, '0')}`;
          const icon = err.level === 'error' ? '🔴' : '🟡';
          comment += `- ${icon} \`[${time}] ${err.text}\``;
          if (err.source && err.source !== 'unknown') comment += ` (${err.source})`;
          comment += `\n`;
        }
        comment += '\n';
      }
    } catch (e) { /* ignore */ }
  }

  // User Actions
  if (card.action_events_json) {
    try {
      const actions = JSON.parse(card.action_events_json);
      if (actions.length > 0) {
        const ACTION_LABELS = { click: 'Click', modal_open: 'Modal open', modal_close: 'Modal close', text_select: 'Select', form_submit: 'Submit' };
        comment += `<details>\n<summary>User Actions (${actions.length})</summary>\n\n`;
        for (const a of actions) {
          const mins = Math.floor(a.ts / 60);
          const secs = Math.floor(a.ts % 60);
          const time = `${mins}:${String(secs).padStart(2, '0')}`;
          const type = ACTION_LABELS[a.eventType] || a.eventType;
          const label = a.ariaLabel || a.text || '';
          comment += `- \`[${time}]\` ${type}: ${label.slice(0, 80)}\n`;
        }
        comment += `\n</details>\n`;
      }
    } catch (e) { /* ignore */ }
  }

  // Environment
  if (card.metadata_json) {
    try {
      const meta = JSON.parse(card.metadata_json);
      const parts = [];
      if (meta.userAgent) {
        const ua = meta.userAgent;
        const chromeMatch = ua.match(/Chrome\/([\d.]+)/);
        const firefoxMatch = ua.match(/Firefox\/([\d.]+)/);
        const browser = chromeMatch ? `Chrome ${chromeMatch[1].split('.')[0]}` :
                        firefoxMatch ? `Firefox ${firefoxMatch[1].split('.')[0]}` : 'Unknown browser';
        parts.push(browser);
        const macMatch = ua.match(/Mac OS X ([\d_]+)/);
        const winMatch = ua.match(/Windows NT ([\d.]+)/);
        const linuxMatch = ua.match(/Linux/);
        const os = macMatch ? `macOS ${macMatch[1].replace(/_/g, '.')}` :
                   winMatch ? `Windows ${winMatch[1]}` :
                   linuxMatch ? 'Linux' : '';
        if (os) parts.push(os);
      }
      const sw = meta.screenWidth ?? meta.screen?.width;
      const sh = meta.screenHeight ?? meta.screen?.height;
      const dpr = meta.devicePixelRatio ?? meta.screen?.devicePixelRatio;
      if (sw && sh) {
        let screen = `${sw}\u00d7${sh}`;
        if (dpr && dpr > 1) screen += ` @${dpr}x`;
        parts.push(screen);
      }
      if (parts.length > 0) {
        comment += `**Environment:** ${parts.join(', ')}\n`;
      }
    } catch (e) { /* ignore */ }
  }

  comment += `\n---\n`;
  comment += `**Video:** [${card.rec_id}](${recordingUrl})\n`;

  // Transcript (collapsible)
  if (card.transcript_json) {
    try {
      const transcript = typeof card.transcript_json === 'string'
        ? JSON.parse(card.transcript_json)
        : card.transcript_json;
      if (transcript.words && transcript.words.length > 0) {
        comment += `\n<details>\n<summary>Transcript</summary>\n\n`;
        let currentChunk = '';
        let chunkStart = transcript.words[0].start;
        for (const word of transcript.words) {
          if (word.start - chunkStart >= 10 && currentChunk) {
            const mins = Math.floor(chunkStart / 60);
            const secs = Math.floor(chunkStart % 60);
            comment += `[${mins}:${String(secs).padStart(2, '0')}] ${currentChunk.trim()}\n`;
            currentChunk = '';
            chunkStart = word.start;
          }
          currentChunk += word.word + ' ';
        }
        if (currentChunk) {
          const mins = Math.floor(chunkStart / 60);
          const secs = Math.floor(chunkStart % 60);
          comment += `[${mins}:${String(secs).padStart(2, '0')}] ${currentChunk.trim()}\n`;
        }
        comment += `\n</details>\n`;
      }
    } catch (e) { /* ignore */ }
  }

  // Post comment to YouTrack
  const commentResult = await addComment(youtrack_issue_id, comment);
  if (!commentResult) {
    return res.status(502).json({ error: 'Failed to add comment to YouTrack issue' });
  }

  // Save link in DB
  const issueUrl = `${config.youtrack.url}/issue/${youtrack_issue_id}`;
  db.prepare('UPDATE cards SET youtrack_issue_id = ? WHERE id = ?').run(youtrack_issue_id, card.id);
  db.prepare('UPDATE recordings SET youtrack_issue_id = ?, youtrack_url = ? WHERE id = ?')
    .run(youtrack_issue_id, issueUrl, card.rec_id);

  console.log(`[Card #${card.id}] Linked to YouTrack: ${youtrack_issue_id}`);

  res.json({
    ok: true,
    youtrack_issue_id: youtrack_issue_id,
    youtrack_url: issueUrl,
    linked: true,
  });
});

// --- YouTrack User Mapping ---

router.get('/youtrack-users', (req, res) => {
  const db = getDB();
  const users = db.prepare('SELECT * FROM youtrack_users ORDER BY youtrack_name, author').all();
  res.json({ users });
});

router.post('/youtrack-users', (req, res) => {
  const db = getDB();
  const { author, youtrack_id, youtrack_login, youtrack_name } = req.body;

  if (!author || !youtrack_id || !youtrack_login) {
    return res.status(400).json({ error: 'author, youtrack_id, youtrack_login required' });
  }

  db.prepare(
    'INSERT OR REPLACE INTO youtrack_users (author, youtrack_id, youtrack_login, youtrack_name) VALUES (?, ?, ?, ?)'
  ).run(author, youtrack_id, youtrack_login, youtrack_name || '');

  res.json({ ok: true });
});

export default router;
