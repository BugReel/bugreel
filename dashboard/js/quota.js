/**
 * quota.js — Optional quota/storage widget for SaaS deployments.
 * Fetches /api/subscription and displays storage usage in the header.
 * Silently does nothing if the endpoint doesn't exist (self-hosted BugReel).
 */

const t = (key, fallback) => (window.__dashboardI18n?.t || ((k, f) => f || k))(key, fallback);

let _quotaData = null;
let _initPromise = null;

/**
 * Fetch subscription/quota data and render the header widget.
 * Safe to call on every page — no-ops if /api/subscription is unavailable.
 */
export function initQuotaWidget() {
  if (_initPromise) return _initPromise;
  _initPromise = _doInit();
  return _initPromise;
}

async function _doInit() {
  try {
    const res = await fetch('/api/subscription', { credentials: 'include' });
    if (!res.ok) return;
    _quotaData = await res.json();
    if (!_quotaData?.ok) { _quotaData = null; return; }
    _renderHeaderWidget(_quotaData);
  } catch {
    // Self-hosted BugReel or network error — silently skip
  }
}

/** Return cached quota data (or null if not SaaS / not loaded yet). */
export function getQuotaData() {
  return _quotaData;
}

/** Wait for quota data to load, then return it. */
export async function getQuotaDataAsync() {
  if (_initPromise) await _initPromise;
  return _quotaData;
}

/**
 * Format bytes to human-readable string.
 * @param {number} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  if (bytes < 0) return '∞';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return parseFloat((bytes / Math.pow(1024, i)).toFixed(1)) + ' ' + units[i];
}

/**
 * Get color class based on usage percentage.
 * @param {number} percent 0-1
 * @returns {'green'|'amber'|'red'}
 */
function usageColor(percent) {
  if (percent >= 0.9) return 'red';
  if (percent >= 0.7) return 'amber';
  return 'green';
}

/** Render the compact header widget into #quota-widget */
function _renderHeaderWidget(data) {
  const el = document.getElementById('quota-widget');
  if (!el) return;

  const used = data.total_storage_bytes || 0;
  const limit = data.limits?.max_storage_bytes || 0;
  const percent = limit > 0 ? Math.min(used / limit, 1) : 0;
  const color = usageColor(percent);

  const usedStr = formatBytes(used);
  const limitStr = limit > 0 ? formatBytes(limit) : '∞';

  el.innerHTML = `
    <span class="quota-text">${usedStr} / ${limitStr}</span>
    <div class="quota-bar">
      <div class="quota-bar-fill ${color}" style="width:${Math.round(percent * 100)}%"></div>
    </div>
  `;
  el.style.display = 'flex';
  el.title = t('quota_storage', 'Storage') + ': ' + usedStr + ' / ' + limitStr;
  el.onclick = () => { window.location.href = '/settings-page'; };
}

/**
 * Render a retention badge for a recording.
 * @param {string} createdAt — ISO date string
 * @returns {string} HTML string (empty if no badge needed)
 */
export function retentionBadge(createdAt) {
  if (!_quotaData?.limits) return '';
  const retDays = _quotaData.limits.retention_days;
  if (!retDays || retDays < 0) return ''; // unlimited

  const ageMs = Date.now() - new Date(createdAt).getTime();
  const ageDays = Math.floor(ageMs / 86400000);
  const remaining = retDays - ageDays;

  if (remaining > 7) return '';
  if (remaining < 0) return '';

  const color = remaining <= 3 ? 'red' : 'amber';
  const label = t('quota_deletes_in', 'Deletes in {n}d').replace('{n}', remaining);
  return `<span class="badge badge-retention" style="background:var(--${color}-dim);color:var(--${color});font-size:0.6rem;padding:1px 6px;margin-left:6px;">${label}</span>`;
}
