// Extension connection status — header badge + recordings banner.
//
// A host product whose recordings come from a browser extension can surface,
// inside the dashboard, whether that extension is installed and linked to the
// signed-in account. The extension's content script (content-script-server-bridge.js)
// answers a status handshake on the server origin:
//
//   page → window.postMessage({source:'extension-bridge-page', type:'status-request'})
//   ext  → window.postMessage({source:'extension-bridge', type:'status', installed, linked, isGuest})
//
// The extension also announces proactively on load and whenever its token
// changes, so a fresh self-connect flips the UI from "not linked" to
// "connected" live — no reload.
//
// ⚠️ No-signal ≠ not installed. The status handshake only exists in newer
// extension builds; older installed+linked builds stay silent. So a timeout
// with no reply is rendered as a neutral amber "not detected" (install OR
// update + reload), never a hard red "not installed".
//
// Self-contained on purpose (no import from shared.js) to avoid an import
// cycle — shared.js imports this for its side effect (auto-mounting the badge).

const STR = {
  ru: {
    linked: 'Расширение подключено',
    checking: 'Проверка расширения…',
    unlinked: 'Расширение не подключено',
    undetected: 'Расширение не обнаружено',
    badge_warn_title: 'Нажмите, чтобы настроить расширение',
    b_undet_title: 'Расширение не обнаружено',
    b_undet_desc: 'Без него запись экрана недоступна. Установите расширение — а если оно уже установлено, обновите его до последней версии и перезагрузите эту страницу.',
    b_undet_cta: 'Установить расширение',
    b_unlink_title: 'Расширение не подключено к аккаунту',
    b_unlink_desc: 'Подключите его, чтобы записи сохранялись в вашем аккаунте и открывались на любом устройстве.',
    b_unlink_cta: 'Подключить',
    dismiss: 'Скрыть',
  },
  en: {
    linked: 'Extension connected',
    checking: 'Checking extension…',
    unlinked: 'Extension not connected',
    undetected: 'Extension not detected',
    badge_warn_title: 'Click to set up the extension',
    b_undet_title: 'Extension not detected',
    b_undet_desc: 'Screen recording needs it. Install the extension — or, if it is already installed, update it to the latest version and reload this page.',
    b_undet_cta: 'Install extension',
    b_unlink_title: 'Extension not linked to your account',
    b_unlink_desc: 'Connect it so your recordings are saved to your account and open on any device.',
    b_unlink_cta: 'Connect',
    dismiss: 'Dismiss',
  },
};

const ICON = {
  alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>',
  chevron: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>',
  x: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>',
};

function lang() {
  const l = (typeof window !== 'undefined' && window.__dashboardI18n && window.__dashboardI18n.lang) || 'en';
  return STR[l] ? l : 'en';
}
function S() { return STR[lang()]; }

function installUrl() {
  return (window.__branding && window.__branding.extension_install_url) || '/install.html';
}
function connectUrl() {
  return (window.__branding && window.__branding.extension_connect_url) || '/settings';
}

// ── Shared status channel ───────────────────────────────────────────────────
// State: 'checking' | 'linked' | 'unlinked' | 'undetected'.
// (A guest-but-linked extension counts as 'linked' here — the extension works;
//  the guest-account nudge is a separate banner.)
let _state = 'checking';
let _resolved = false;
let _started = false;
const _subs = new Set();

function emit() { _subs.forEach((fn) => { try { fn(_state); } catch {} }); }

function requestStatus() {
  try { window.postMessage({ source: 'extension-bridge-page', type: 'status-request' }, location.origin); } catch {}
}

function start() {
  if (_started) return;
  _started = true;

  window.addEventListener('message', (ev) => {
    if (ev.source !== window || ev.origin !== location.origin) return;
    const m = ev.data;
    if (!m || typeof m !== 'object' || m.source !== 'extension-bridge' || m.type !== 'status') return;
    _resolved = true;
    _state = m.linked ? 'linked' : 'unlinked';
    emit();
  });

  requestStatus();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) requestStatus(); });
  window.addEventListener('focus', requestStatus);

  // No reply at all → not detected (absent OR an older silent build). Never a
  // hard "not installed".
  setTimeout(() => { if (!_resolved) { _state = 'undetected'; emit(); } }, 2200);
}

export function subscribeExtStatus(fn) {
  _subs.add(fn);
  try { fn(_state); } catch {}
  start();
  return () => _subs.delete(fn);
}

// ── Header badge ─────────────────────────────────────────────────────────────
function badgeHTML(state) {
  const s = S();
  if (state === 'checking') {
    return `<span class="ext-badge ext-badge--checking" role="status"><span class="ext-badge-dot"></span><span class="ext-badge-label">${s.checking}</span></span>`;
  }
  if (state === 'linked') {
    return `<span class="ext-badge ext-badge--linked" role="status"><span class="ext-badge-dot"></span><span class="ext-badge-label">${s.linked}</span></span>`;
  }
  const href = state === 'unlinked' ? connectUrl() : installUrl();
  const label = state === 'unlinked' ? s.unlinked : s.undetected;
  return `<a class="ext-badge ext-badge--warn" href="${href}" title="${s.badge_warn_title}"><span class="ext-badge-dot"></span><span class="ext-badge-label">${label}</span></a>`;
}

// Returns true once the host exists and the badge has been mounted.
export function initExtStatusBadge(host) {
  host = host || document.getElementById('ext-status-host');
  if (!host) return false;
  if (host.dataset.extInit === '1') return true;
  host.dataset.extInit = '1';
  subscribeExtStatus((state) => { host.innerHTML = badgeHTML(state); });
  return true;
}

// ── Recordings banner (shown only while not connected) ───────────────────────
function bannerHTML(state) {
  const s = S();
  const undetected = state === 'undetected';
  const title = undetected ? s.b_undet_title : s.b_unlink_title;
  const desc = undetected ? s.b_undet_desc : s.b_unlink_desc;
  const cta = undetected ? s.b_undet_cta : s.b_unlink_cta;
  const href = undetected ? installUrl() : connectUrl();
  const target = undetected ? ' target="_blank" rel="noopener"' : '';
  return `
    <div class="ext-banner">
      <span class="ext-banner-icon">${ICON.alert}</span>
      <div class="ext-banner-text">
        <strong>${title}</strong>
        <span class="muted">${desc}</span>
      </div>
      <a class="ext-banner-cta" href="${href}"${target}>${cta} ${ICON.chevron}</a>
      <button class="ext-banner-dismiss" type="button" aria-label="${s.dismiss}">${ICON.x}</button>
    </div>`;
}

export function renderExtBanner(host) {
  if (!host || host.dataset.extBound === '1') return;
  host.dataset.extBound = '1';
  subscribeExtStatus((state) => {
    const show = (state === 'undetected' || state === 'unlinked')
      && sessionStorage.getItem('ext-banner-dismissed') !== '1';
    if (!show) { host.innerHTML = ''; host.dataset.state = ''; return; }
    if (host.dataset.state === state) return; // avoid rebuild churn
    host.dataset.state = state;
    host.innerHTML = bannerHTML(state);
    const dismiss = host.querySelector('.ext-banner-dismiss');
    if (dismiss) dismiss.addEventListener('click', () => {
      sessionStorage.setItem('ext-banner-dismissed', '1');
      host.innerHTML = '';
      host.dataset.state = '';
    });
  });
}

// ── Auto-mount the badge wherever the app header renders ──────────────────────
// renderHeader() injects #ext-status-host; it may appear after this module is
// evaluated (header is built in each page's body). Watch for it so no page
// needs explicit wiring.
function boot() {
  if (initExtStatusBadge()) return;
  try {
    const obs = new MutationObserver(() => { if (initExtStatusBadge()) obs.disconnect(); });
    obs.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => obs.disconnect(), 10000);
  } catch {}
}
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
}
