/**
 * BugReel — API Client
 * All functions call fetch against same-origin /api endpoints
 */

// Auto-detect API base: if dashboard runs under a path prefix (e.g. /app/),
// API calls still go to /api/ at the origin root.
// This works for both standalone (localhost:3500) and reverse-proxy (/app/) deployments.
const API_BASE = '';

/**
 * Generic fetch wrapper with error handling
 */
async function request(path, options = {}) {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${res.status}: ${body}`);
  }
  return res.json();
}

/**
 * Build query string from params object (skips null/undefined/empty)
 */
function qs(params) {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '');
  if (!entries.length) return '';
  return '?' + new URLSearchParams(entries).toString();
}

// --- Recordings ---

export async function getRecordings(params = {}) {
  const { status, author, search, limit = 50, offset = 0 } = params;
  return request(`/api/recordings${qs({ status, author, limit, offset })}`);
}

export async function getRecording(id) {
  return request(`/api/recordings/${encodeURIComponent(id)}`);
}

export async function getRecordingByToken(token) {
  return request(`/api/recordings/by-token/${encodeURIComponent(token)}`);
}

// --- Cards ---

export async function getCards(params = {}) {
  const { status, assigned_to, priority, limit = 50, offset = 0 } = params;
  return request(`/api/cards${qs({ status, assigned_to, priority, limit, offset })}`);
}

export async function getCard(id) {
  return request(`/api/cards/${encodeURIComponent(id)}`);
}

// --- Comments ---

export async function addComment(cardId, author, text) {
  return request(`/api/cards/${encodeURIComponent(cardId)}/comment`, {
    method: 'POST',
    body: JSON.stringify({ author, text }),
  });
}

// --- Score ---

export async function updateScore(cardId, scoreData) {
  return request(`/api/cards/${encodeURIComponent(cardId)}/score`, {
    method: 'POST',
    body: JSON.stringify(scoreData),
  });
}

// --- YouTrack Export ---

export async function exportToYoutrack(cardId, options = {}) {
  return request(`/api/cards/${encodeURIComponent(cardId)}/export-youtrack`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options),
  });
}

// --- YouTrack Search & Link ---

export async function searchYoutrackIssues(params = {}) {
  const { author, state, q, all, project } = params;
  return request(`/api/youtrack-search${qs({ author, state, q, all, project })}`);
}

export async function linkToYoutrack(cardId, youtrackIssueId) {
  return request(`/api/cards/${encodeURIComponent(cardId)}/link-youtrack`, {
    method: 'POST',
    body: JSON.stringify({ youtrack_issue_id: youtrackIssueId }),
  });
}

// --- Pre-Link (before card exists) ---

export async function preLinkYoutrack(recordingId, youtrackIssueId) {
  return request(`/api/recordings/${encodeURIComponent(recordingId)}/pre-link-youtrack`, {
    method: 'POST',
    body: JSON.stringify({ youtrack_issue_id: youtrackIssueId }),
  });
}

export async function clearPreLink(recordingId) {
  return request(`/api/recordings/${encodeURIComponent(recordingId)}/pre-link-youtrack`, {
    method: 'DELETE',
  });
}

// --- Transcript Update ---

export async function updateTranscript(recordingId, words) {
  return request(`/api/recordings/${encodeURIComponent(recordingId)}/transcript`, {
    method: 'PUT',
    body: JSON.stringify({ words }),
  });
}

export async function updateContext(recordingId, data) {
  return request(`/api/recordings/${encodeURIComponent(recordingId)}/context`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

// --- Card Update ---

export async function updateCard(cardId, fields) {
  return request(`/api/cards/${encodeURIComponent(cardId)}`, {
    method: 'PUT',
    body: JSON.stringify(fields),
  });
}

// --- Keyframes ---

export async function updateKeyframes(recordingId, keyframes) {
  return request(`/api/recordings/${encodeURIComponent(recordingId)}/keyframes`, {
    method: 'PUT',
    body: JSON.stringify({ keyframes }),
  });
}

export async function addKeyframe(recordingId, time_seconds, description) {
  return request(`/api/recordings/${encodeURIComponent(recordingId)}/keyframes`, {
    method: 'POST',
    body: JSON.stringify({ time_seconds, description }),
  });
}

export async function deleteKeyframe(recordingId, frameId) {
  return request(`/api/recordings/${encodeURIComponent(recordingId)}/keyframes/${encodeURIComponent(frameId)}`, {
    method: 'DELETE',
  });
}

export async function regenerateFrames(recordingId) {
  return request(`/api/recordings/${encodeURIComponent(recordingId)}/regenerate-frames`, {
    method: 'POST',
  });
}

export async function exportCard(cardId) {
  return request(`/api/cards/${encodeURIComponent(cardId)}/export`, {
    method: 'POST',
  });
}

// --- Video Comments ---

export async function getVideoComments(recordingId) {
  return request(`/api/recordings/${encodeURIComponent(recordingId)}/comments`);
}

export async function addVideoComment(recordingId, author_name, text, timecode_seconds) {
  const body = { author_name, text };
  if (timecode_seconds !== undefined && timecode_seconds !== null) {
    body.timecode_seconds = timecode_seconds;
  }
  return request(`/api/recordings/${encodeURIComponent(recordingId)}/comments`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function deleteVideoComment(recordingId, commentId) {
  return request(`/api/recordings/${encodeURIComponent(recordingId)}/comments/${encodeURIComponent(commentId)}`, {
    method: 'DELETE',
  });
}

// --- View Analytics ---

export async function recordView(recordingId) {
  return request(`/api/analytics/view`, {
    method: 'POST',
    body: JSON.stringify({ recording_id: recordingId }),
  });
}

export async function getRecordingViews(recordingId) {
  return request(`/api/analytics/${encodeURIComponent(recordingId)}`);
}

export async function getViewAnalytics() {
  return request('/api/analytics/views');
}

// --- Password Protection ---

export async function setRecordingPassword(recordingId, password) {
  return request(`/api/recordings/${encodeURIComponent(recordingId)}/password`, {
    method: 'PUT',
    body: JSON.stringify({ password }),
  });
}

export async function removeRecordingPassword(recordingId) {
  return request(`/api/recordings/${encodeURIComponent(recordingId)}/password`, {
    method: 'DELETE',
  });
}

// --- Helpers ---

/**
 * Build URL for recording video
 */
export function videoUrl(recordingId) {
  return `/api/recordings/${encodeURIComponent(recordingId)}/video`;
}

/**
 * Build URL for frame image
 */
export function frameUrl(recordingId, filename) {
  return `/api/recordings/${encodeURIComponent(recordingId)}/frames/${encodeURIComponent(filename)}`;
}
