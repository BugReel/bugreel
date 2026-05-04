/**
 * BugReel — Shared UI helpers and SVG icons
 * Lucide-style SVG icons rendered inline (no emoji)
 */

// --- i18n helper (loaded via i18n-dashboard.js before this module) ---
const t = window.__dashboardI18n?.t || ((k, f) => f || k);

// --- Base path detection for reverse-proxy deployments ---
// Auto-detects path prefix (e.g., '/app' when dashboard runs at /app/).
// Works out of the box: standalone → '', proxied at /app/ → '/app'.
export const basePath = (() => {
  try {
    const p = new URL(import.meta.url).pathname;
    const i = p.indexOf('/js/shared.js');
    if (i > 0) return p.slice(0, i);
  } catch {}
  return '';
})();

// --- SVG Icons (Lucide-style, 24x24 viewBox) ---
export const icons = {
  video: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"></polygon><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect></svg>`,

  cards: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>`,

  chart: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>`,

  arrowLeft: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>`,

  chevronLeft: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>`,

  chevronRight: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>`,

  search: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>`,

  clock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`,

  user: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>`,

  calendar: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>`,

  filter: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>`,

  send: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>`,

  messageCircle: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>`,

  target: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="6"></circle><circle cx="12" cy="12" r="2"></circle></svg>`,

  bug: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2l1.88 1.88M14.12 3.88L16 2M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"></path><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6"></path><path d="M12 20v-9M6.53 9C4.6 8.8 3 7.1 3 5"></path><path d="M6 13H2M6 17l-4 1M17.47 9c1.93-.2 3.53-1.9 3.53-4"></path><path d="M18 13h4M18 17l4 1"></path></svg>`,

  sparkle: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.912 5.813a2 2 0 0 0 1.275 1.275L21 12l-5.813 1.912a2 2 0 0 0-1.275 1.275L12 21l-1.912-5.813a2 2 0 0 0-1.275-1.275L3 12l5.813-1.912a2 2 0 0 0 1.275-1.275L12 3z"></path></svg>`,

  layers: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg>`,

  hash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="9" x2="20" y2="9"></line><line x1="4" y1="15" x2="20" y2="15"></line><line x1="10" y1="3" x2="8" y2="21"></line><line x1="16" y1="3" x2="14" y2="21"></line></svg>`,

  externalLink: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>`,

  inbox: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"></polyline><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"></path></svg>`,

  play: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`,

  image: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>`,

  fileText: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>`,

  activity: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>`,

  trendingUp: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline><polyline points="17 6 23 6 23 12"></polyline></svg>`,

  alertTriangle: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`,

  checkCircle: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`,

  share: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"></path><polyline points="16 6 12 2 8 6"></polyline><line x1="12" y1="2" x2="12" y2="15"></line></svg>`,

  pencil: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"></path><path d="m15 5 4 4"></path></svg>`,

  x: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`,

  code: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>`,

  lock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>`,

  unlock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 5-5 5 5 0 0 1 5 5"></path></svg>`,

  eye: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`,

  trash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>`,

  settings: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>`,
};

// --- Helpers ---

/**
 * Format ISO date string to human-readable
 */
export function formatDate(isoStr) {
  if (!isoStr) return '--';
  const d = new Date(isoStr);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${day}.${month}.${year} ${hours}:${minutes}`;
}

/**
 * Format seconds to mm:ss or hh:mm:ss
 */
export function formatDuration(seconds) {
  if (!seconds && seconds !== 0) return '--';
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }
  return `${m}:${String(sec).padStart(2, '0')}`;
}

/**
 * Format seconds to a short timecode like "1:23"
 */
export function formatTimecode(seconds) {
  if (seconds == null) return '0:00';
  const s = Math.round(seconds);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

/**
 * Return CSS class suffix for recording status
 */
export function statusBadge(status) {
  return `badge badge-${status || 'draft'}`;
}

/**
 * Human label for recording status (i18n-aware)
 */
export function statusLabel(status) {
  const map = {
    uploaded: t('status_uploaded', 'Uploaded'),
    audio_extracted: t('status_audio_extracted', 'Audio'),
    transcribing: t('status_transcribing', 'Transcribing'),
    transcribed: t('status_transcribed', 'Transcribed'),
    analyzed: t('status_analyzed', 'Analyzed'),
    frames_extracted: t('status_frames_extracted', 'Frames'),
    compressing: t('status_compressing', 'Compressing'),
    complete: t('status_complete', 'Complete'),
    error: t('status_error', 'Error'),
    draft: t('status_draft', 'Draft'),
    scored: t('status_scored', 'Scored'),
    done: t('status_done', 'Done'),
  };
  return map[status] || status || '--';
}

/**
 * Human label for CS category (i18n-aware)
 */
export function categoryLabel(category) {
  const map = {
    easy: t('cs_easy', 'Easy'),
    medium: t('cs_medium', 'Medium'),
    hard: t('cs_hard', 'Hard'),
    critical: t('cs_critical', 'Critical'),
  };
  return map[category] || category || '--';
}

/**
 * Create a CS score circle HTML
 */
export function csCircleHTML(total, category, sizeClass = '') {
  const cat = category || csCategory(total);
  const cls = ['cs-circle', cat, sizeClass].filter(Boolean).join(' ');
  const val = total != null ? total : '--';
  return `<div class="${cls}">${val}</div>`;
}

/**
 * Determine CS category from total
 */
export function csCategory(total) {
  if (total == null) return 'none';
  if (total >= 14) return 'critical';
  if (total >= 11) return 'hard';
  if (total >= 8) return 'medium';
  return 'easy';
}

/**
 * Simple markdown-like render for description text:
 * ## headings, line breaks
 */
export function renderDescription(text) {
  if (!text) return '';
  return text
    .split('\n')
    .map(line => {
      if (line.startsWith('## ')) {
        return `<h2>${escapeHTML(line.slice(3))}</h2>`;
      }
      if (line.trim() === '') return '<br>';
      return `<p>${escapeHTML(line)}</p>`;
    })
    .join('\n');
}

/**
 * Escape HTML special characters
 */
export function escapeHTML(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Extract route parameter from URL path
 * Works with optional path prefix (e.g., /app/recording/ID or /recording/ID)
 */
export function extractParam(prefix) {
  const path = window.location.pathname;
  const idx = path.indexOf(prefix);
  if (idx !== -1) {
    return decodeURIComponent(path.slice(idx + prefix.length));
  }
  return null;
}

/**
 * Relative time string (e.g., "5 minutes ago")
 */
export function timeAgo(isoStr) {
  if (!isoStr) return '';
  const now = Date.now();
  const then = new Date(isoStr).getTime();
  const diff = Math.floor((now - then) / 1000);

  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return formatDate(isoStr);
}

/**
 * Render a CS bar row (used in CS Breakdown sections)
 */
export function csBarRow(label, value) {
  const v = value || 0;
  return `
    <div class="cs-bar-row">
      <span class="cs-bar-label">${label}</span>
      <div class="cs-bar-track">
        <div class="cs-bar-fill level-${v}"></div>
      </div>
      <span class="cs-bar-value">${v}/3</span>
    </div>
  `;
}

/**
 * Render a single comment block
 */
export function renderComment(comment) {
  return `
    <div class="comment">
      <div class="comment-header">
        <span class="comment-author">${escapeHTML(comment.author || 'Unknown')}</span>
        <span class="comment-date">${timeAgo(comment.created_at)}</span>
      </div>
      <div class="comment-text">${escapeHTML(comment.text)}</div>
    </div>
  `;
}

/**
 * Build header + nav HTML (reusable across pages, i18n-aware)
 */
export function renderHeader(activePage) {
  const navItems = [
    { href: `${basePath}/`, label: t('nav_recordings', 'Recordings'), icon: icons.video, key: 'recordings' },
    { href: `${basePath}/analytics`, label: t('nav_analytics', 'Analytics'), icon: icons.chart, key: 'analytics' },
    { href: `${basePath}/guide`, label: t('nav_guide', 'Guide'), icon: icons.fileText, key: 'guide' },
    { href: `${basePath}/settings-page`, label: t('nav_settings', 'Settings'), icon: icons.settings, key: 'settings' },
  ];

  const currentLang = window.__dashboardI18n?.lang || 'en';

  // Logo starts hidden, revealed after branding loads (prevents BugReel→custom flash)
  fetchBranding();

  return `
    <header class="app-header">
      <div class="container">
        <a href="${basePath}/" class="logo" id="brand-logo" style="opacity:0;transition:opacity .15s">
          <div class="logo-icon" id="brand-icon"></div>
          <span id="brand-name"></span>
        </a>
        <nav class="nav">
          ${navItems.map(item => `
            <a href="${item.href}" class="${item.key === activePage ? 'active' : ''}">
              ${item.icon}
              <span>${item.label}</span>
            </a>
          `).join('')}
        </nav>
        <div id="quota-widget" style="display:none"></div>
        <button id="feedback-btn" class="feedback-btn" style="display:none" title="${t('feedback_button', 'Report a problem')}" aria-label="${t('feedback_button', 'Report a problem')}">
          ${icons.messageCircle}
        </button>
        <div class="lang-switcher" role="group" aria-label="Language">
          <button type="button" class="lang-btn ${currentLang === 'en' ? 'active' : ''}" aria-pressed="${currentLang === 'en'}" onclick="window.__dashboardI18n.setLang('en')">EN</button>
          <button type="button" class="lang-btn ${currentLang === 'ru' ? 'active' : ''}" aria-pressed="${currentLang === 'ru'}" onclick="window.__dashboardI18n.setLang('ru')">RU</button>
        </div>
        <div id="user-menu" class="user-menu" style="display:none">
          <button id="user-menu-btn" class="user-menu-btn" type="button" aria-haspopup="true" aria-expanded="false">
            <span id="user-menu-avatar" class="user-menu-avatar"></span>
            <span id="user-menu-name"></span>
          </button>
          <div id="user-menu-dropdown" class="user-menu-dropdown" hidden>
            <div class="user-menu-info">
              <div id="user-menu-fullname" class="user-menu-fullname"></div>
              <div id="user-menu-email" class="user-menu-email"></div>
            </div>
            <button id="user-menu-logout" class="user-menu-logout" type="button">
              ${t('nav_logout', 'Log out')}
            </button>
          </div>
        </div>
      </div>
    </header>
  `;
}

/**
 * Load current user from /api/auth/me and render the user menu.
 * Logout posts /api/auth/logout (works behind both Core auth and a
 * cloud reverse proxy that overrides the route) and redirects to /.
 */
let _userMenuPromise = null;
let _currentUser = null;
export function initUserMenu() {
  if (_userMenuPromise) return _userMenuPromise;
  _userMenuPromise = fetch('/api/auth/me', { credentials: 'same-origin' })
    .then(r => r.ok ? r.json() : null)
    .then(data => {
      const u = data?.user;
      if (!u) return;
      _currentUser = { ...u, upgrade_url: data.upgrade_url || '/auth/upgrade' };
      const menu = document.getElementById('user-menu');
      const nameEl = document.getElementById('user-menu-name');
      const fullEl = document.getElementById('user-menu-fullname');
      const emailEl = document.getElementById('user-menu-email');
      const avatarEl = document.getElementById('user-menu-avatar');
      const display = u.name || (u.email ? u.email.split('@')[0] : 'User');
      const initials = display.trim().slice(0, 1).toUpperCase() || 'U';

      if (u.is_guest) {
        if (menu) menu.classList.add('user-menu-guest');
        if (nameEl) nameEl.textContent = t('guest_save_cta', 'Save account');
        if (fullEl) fullEl.textContent = t('guest_label', 'Guest account');
        if (emailEl) emailEl.textContent = t('guest_no_email', 'No email — recordings expire soon');
        if (avatarEl) avatarEl.textContent = '?';
      } else {
        if (nameEl) nameEl.textContent = display;
        if (fullEl) fullEl.textContent = display;
        if (emailEl) emailEl.textContent = u.email || '';
        if (avatarEl) avatarEl.textContent = initials;
      }
      if (menu) menu.style.display = '';

      const btn = document.getElementById('user-menu-btn');
      const dd = document.getElementById('user-menu-dropdown');

      if (u.is_guest && dd) {
        const cta = document.createElement('a');
        cta.href = _currentUser.upgrade_url;
        cta.className = 'user-menu-upgrade-cta';
        cta.textContent = t('guest_save_cta', 'Save account');
        const info = dd.querySelector('.user-menu-info');
        if (info) info.after(cta);
      }

      btn?.addEventListener('click', (e) => {
        e.stopPropagation();
        const open = !dd.hidden;
        dd.hidden = open;
        btn.setAttribute('aria-expanded', String(!open));
      });
      document.addEventListener('click', (e) => {
        if (!dd || dd.hidden) return;
        if (!menu.contains(e.target)) { dd.hidden = true; btn?.setAttribute('aria-expanded', 'false'); }
      });

      document.getElementById('user-menu-logout')?.addEventListener('click', async () => {
        try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }); } catch {}
        window.location.href = '/';
      });
    })
    .catch(() => {});
  return _userMenuPromise;
}

/** Return cached current user from /api/auth/me (or null if not loaded). */
export function getCurrentUser() {
  return _currentUser;
}

/** Wait for /api/auth/me to resolve, then return the cached user. */
export async function getCurrentUserAsync() {
  if (_userMenuPromise) await _userMenuPromise;
  return _currentUser;
}

/**
 * Fetch branding from /api/branding and apply to header + page title.
 * Falls back silently if the endpoint is unavailable.
 */
let _brandingPromise = null;
function fetchBranding() {
  if (_brandingPromise) return _brandingPromise;
  _brandingPromise = fetch('/api/branding').then(r => r.json()).then(b => {
    const nameEl = document.getElementById('brand-name');
    const iconEl = document.getElementById('brand-icon');
    const logoEl = document.getElementById('brand-logo');

    // Set brand name
    if (nameEl) nameEl.textContent = b.name || t('brand_name', 'BugReel');

    // Set logo icon
    if (iconEl) {
      iconEl.innerHTML = b.logo_url
        ? `<img src="${escapeHTML(b.logo_url)}" alt="" style="height:24px;max-width:100px;object-fit:contain;">`
        : icons.target;
    }

    // Reveal logo (was hidden to prevent flash)
    if (logoEl) logoEl.style.opacity = '1';

    // Update page title
    if (b.name) document.title = document.title.replace(/BugReel/g, b.name);

    window.__branding = b;

    // Replace brand name in page content and reveal (hidden via CSS to prevent flash)
    const brandEls = document.querySelectorAll('.brand-name');
    if (b.name && b.name !== 'BugReel') {
      brandEls.forEach(el => { el.textContent = b.name; });
    }
    brandEls.forEach(el => { el.style.opacity = '1'; });

    // Inject analytics counters (once)
    if (b.analytics) injectAnalytics(b.analytics);

    // Feedback button — visible only when backend has a destination configured
    if (b.feedback_enabled) initFeedback();

    return b;
  }).catch(() => {
    // Fallback: show defaults if API fails
    const nameEl = document.getElementById('brand-name');
    const iconEl = document.getElementById('brand-icon');
    const logoEl = document.getElementById('brand-logo');
    if (nameEl) nameEl.textContent = t('brand_name', 'BugReel');
    if (iconEl) iconEl.innerHTML = icons.target;
    if (logoEl) logoEl.style.opacity = '1';
    document.querySelectorAll('.brand-name').forEach(el => { el.style.opacity = '1'; });
  });
  return _brandingPromise;
}

/**
 * Inject analytics scripts (Yandex Metrika, Google Analytics) into <head>.
 * Called once from fetchBranding() — idempotent (checks for existing scripts).
 */
function injectAnalytics(analytics) {
  if (!analytics) return;

  // Yandex Metrika
  const ymId = analytics.yandex_metrika_id;
  if (ymId && !document.getElementById('ym-script')) {
    const s = document.createElement('script');
    s.id = 'ym-script';
    s.textContent = `(function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};m[i].l=1*new Date();for(var j=0;j<document.scripts.length;j++){if(document.scripts[j].src===r)return;}k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})(window,document,"script","https://mc.yandex.ru/metrika/tag.js","ym");ym(${Number(ymId)},"init",{clickmap:true,trackLinks:true,accurateTrackBounce:true,webvisor:true});`;
    document.head.appendChild(s);
  }

  // Google Analytics (gtag.js)
  const gtagId = analytics.gtag_id;
  if (gtagId && !document.getElementById('gtag-script')) {
    const g = document.createElement('script');
    g.id = 'gtag-script';
    g.async = true;
    g.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(gtagId)}`;
    document.head.appendChild(g);

    const s = document.createElement('script');
    s.id = 'gtag-init';
    s.textContent = `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${gtagId.replace(/[^A-Za-z0-9-]/g, '')}');`;
    document.head.appendChild(s);
  }
}

/**
 * Feedback modal — reveals header button, opens modal, POSTs to /api/feedback.
 * Idempotent: safe to call multiple times.
 */
let _feedbackInited = false;
function initFeedback() {
  if (_feedbackInited) return;
  _feedbackInited = true;

  const btn = document.getElementById('feedback-btn');
  if (!btn) return;
  btn.style.display = '';
  btn.addEventListener('click', openFeedbackModal);
}

function openFeedbackModal() {
  let overlay = document.getElementById('feedback-modal');
  if (overlay) {
    overlay.classList.remove('hidden');
    overlay.querySelector('textarea')?.focus();
    return;
  }

  overlay = document.createElement('div');
  overlay.id = 'feedback-modal';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-dialog" style="max-width:520px">
      <div class="modal-header">
        <h3>${icons.messageCircle}<span>${t('feedback_title', 'Send feedback')}</span></h3>
        <button class="modal-close" data-feedback-close aria-label="Close">${icons.x}</button>
      </div>
      <div class="modal-body">
        <div class="modal-field">
          <label>${t('feedback_type_label', 'Type')}</label>
          <select class="edit-field" id="feedback-type">
            <option value="bug">${t('feedback_type_bug', 'Bug')}</option>
            <option value="idea">${t('feedback_type_idea', 'Idea')}</option>
            <option value="question">${t('feedback_type_question', 'Question')}</option>
            <option value="other">${t('feedback_type_other', 'Other')}</option>
          </select>
        </div>
        <div class="modal-field" style="margin-top:12px">
          <label>${t('feedback_message_label', 'Message')}</label>
          <textarea class="edit-field" id="feedback-message" rows="6" placeholder="${t('feedback_message_placeholder', 'Describe the problem…')}" maxlength="4000"></textarea>
        </div>
        <div id="feedback-status" style="margin-top:8px;font-size:.9rem;color:var(--text3)"></div>
      </div>
      <div class="modal-footer">
        <button class="btn-edit-cancel" data-feedback-close>${t('cancel', 'Cancel')}</button>
        <button class="btn-edit-save" id="feedback-submit">${t('feedback_submit', 'Send')}</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const close = () => overlay.classList.add('hidden');
  overlay.querySelectorAll('[data-feedback-close]').forEach(el => el.addEventListener('click', close));
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

  const submitBtn = overlay.querySelector('#feedback-submit');
  const statusEl = overlay.querySelector('#feedback-status');
  submitBtn.addEventListener('click', async () => {
    const type = overlay.querySelector('#feedback-type').value;
    const message = overlay.querySelector('#feedback-message').value.trim();
    if (message.length < 3) {
      statusEl.textContent = t('feedback_message_label', 'Message') + ' *';
      statusEl.style.color = 'var(--danger, #ef4444)';
      return;
    }
    submitBtn.disabled = true;
    submitBtn.textContent = t('feedback_sending', 'Sending…');
    statusEl.textContent = '';
    try {
      const res = await fetch(`${basePath}/api/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, message, page_url: location.href }),
      });
      if (!res.ok) throw new Error('http ' + res.status);
      statusEl.textContent = t('feedback_sent', 'Thanks! Feedback sent.');
      statusEl.style.color = 'var(--success, #10b981)';
      overlay.querySelector('#feedback-message').value = '';
      setTimeout(close, 1500);
    } catch (err) {
      statusEl.textContent = t('feedback_error', 'Failed to send. Try again.');
      statusEl.style.color = 'var(--danger, #ef4444)';
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = t('feedback_submit', 'Send');
    }
  });

  overlay.querySelector('#feedback-message').focus();
}
