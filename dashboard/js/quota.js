/**
 * quota.js — Optional quota/storage widget for SaaS deployments.
 * Fetches /api/subscription and displays storage usage in the header.
 * Silently does nothing if the endpoint doesn't exist (self-hosted BugReel).
 */
import { basePath, getCurrentUserAsync, icons } from './shared.js';

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

  const plan = data.plan || 'free';
  const planLabels = { free: 'Free', standard: 'Standard', pro: 'Pro', business: 'Business' };
  const planLabel = planLabels[plan] || plan;

  el.innerHTML = `
    <span class="quota-plan-badge quota-plan-${plan}">${planLabel}</span>
    <span class="quota-text">${usedStr} / ${limitStr}</span>
    <div class="quota-bar">
      <div class="quota-bar-fill ${color}" style="width:${Math.round(percent * 100)}%"></div>
    </div>
  `;
  el.style.display = 'flex';
  el.title = planLabel + ' — ' + t('quota_storage', 'Storage') + ': ' + usedStr + ' / ' + limitStr;
  el.onclick = () => { window.location.href = `${basePath}/settings-page`; };
}

/**
 * Render a retention badge for a recording.
 * Guests get an aggressive badge (always visible while they have records),
 * registered users only see it within 7 days of deletion.
 * @param {string} createdAt — ISO date string
 * @param {object} [opts] — { isGuest: boolean }
 * @returns {string} HTML string (empty if no badge needed)
 */
export function retentionBadge(createdAt, opts = {}) {
  if (!_quotaData?.limits) return '';
  const retDays = _quotaData.limits.retention_days;
  if (!retDays || retDays < 0) return ''; // unlimited

  const ageMs = Date.now() - new Date(createdAt).getTime();
  const ageDays = Math.floor(ageMs / 86400000);
  const remaining = retDays - ageDays;

  if (remaining < 0) return '';
  // Guests always see the countdown — short retention is the main pressure point.
  // Registered users only see it inside the last 7 days.
  if (!opts.isGuest && remaining > 7) return '';

  const color = remaining <= 3 ? 'red' : 'amber';
  const label = t('quota_deletes_in', 'Deletes in {n}d').replace('{n}', remaining);
  const deletionDate = new Date(Date.now() + remaining * 86400000).toLocaleDateString();
  return `<span class="badge badge-retention" style="background:var(--${color}-dim);color:var(--${color});font-size:0.6rem;padding:1px 6px;margin-left:6px;" title="${t('quota_will_delete_on', 'Will be deleted on')} ${deletionDate}">${label}</span>`;
}

/**
 * Render a sticky guest banner above the recordings list.
 * No-op for non-guest users or when /api/auth/me is unavailable.
 * Reads dismissal state from sessionStorage so it doesn't nag every page load
 * within a single session, but reappears on the next session.
 * @param {HTMLElement} container — element to prepend the banner to
 * @param {Array} [recordings] — current recordings list (used for limit + retention)
 */
export async function renderGuestBanner(container, recordings = []) {
  if (!container) return;
  const user = await getCurrentUserAsync();
  if (!user || !user.is_guest) return;
  if (sessionStorage.getItem('guest-banner-dismissed') === '1') return;

  // Avoid double-rendering (initial load + 5s refresh interval re-rerenders the table)
  if (container.querySelector('.guest-banner')) return;

  const limits = _quotaData?.limits || {};
  const maxRecordings = limits.max_recordings;
  const retentionDays = limits.retention_days;
  const recordingCount = recordings.length;

  // Compute days until oldest recording is auto-deleted
  let oldestDaysLeft = null;
  if (retentionDays > 0 && recordings.length > 0) {
    const oldestCreatedAt = recordings.reduce((min, r) => {
      const ts = new Date(r.created_at).getTime();
      return (min === null || ts < min) ? ts : min;
    }, null);
    if (oldestCreatedAt) {
      const ageDays = Math.floor((Date.now() - oldestCreatedAt) / 86400000);
      oldestDaysLeft = Math.max(0, retentionDays - ageDays);
    }
  }

  // Decide messaging tone
  const atLimit = maxRecordings > 0 && recordingCount >= maxRecordings;
  const expiringSoon = oldestDaysLeft !== null && oldestDaysLeft <= 2;
  const urgent = atLimit || expiringSoon;

  let title;
  let detail = '';
  if (atLimit) {
    title = t('guest_banner_at_limit_title', 'You\'ve hit the {n}-recording limit').replace('{n}', maxRecordings);
    detail = t('guest_banner_at_limit_desc', 'Confirm your email to unlock more recordings and keep them longer.');
  } else if (expiringSoon) {
    title = t('guest_banner_expiring_title', 'Your oldest recording deletes in {n} day(s)').replace('{n}', oldestDaysLeft);
    detail = t('guest_banner_expiring_desc', 'Confirm your email to extend retention from {a} to {b} days.')
      .replace('{a}', retentionDays).replace('{b}', '14');
  } else {
    title = t('guest_banner_default_title', 'You\'re using a guest account');
    const recPart = maxRecordings > 0
      ? t('guest_banner_default_desc_count', '{n} of {max} recordings used. ').replace('{n}', recordingCount).replace('{max}', maxRecordings)
      : '';
    detail = recPart + t('guest_banner_default_desc', 'Add your email — keep recordings 2× longer and unlock more space.');
  }

  const cta = t('guest_banner_cta', 'Save account');
  const upgradeUrl = user.upgrade_url || '/auth/upgrade';

  const banner = document.createElement('div');
  banner.className = 'guest-banner' + (urgent ? ' guest-banner-urgent' : '');
  banner.innerHTML = `
    <span class="guest-banner-icon">${urgent ? icons.alertTriangle : icons.user}</span>
    <div class="guest-banner-text">
      <strong>${title}</strong>
      <span class="muted">${detail}</span>
    </div>
    <a class="guest-banner-cta" href="${upgradeUrl}">
      ${cta}
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
    </a>
    <button class="guest-banner-dismiss" type="button" aria-label="${t('dismiss', 'Dismiss')}">${icons.x}</button>
  `;
  banner.querySelector('.guest-banner-dismiss').addEventListener('click', () => {
    sessionStorage.setItem('guest-banner-dismissed', '1');
    banner.remove();
  });

  container.prepend(banner);
}
