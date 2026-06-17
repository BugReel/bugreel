// Server bridge: links the browser extension to the user's server account
// without copy-pasting a token. Two complementary paths, both gated to the
// configured serverUrl origin:
//
//   1. Passive handoff (pages under /auth/*): a token-issuing page mints a
//      token and posts it to us; we forward it to the background. Used by the
//      dedicated connect/upgrade pages that drive their own flow.
//
//        page → window.postMessage({source:'extension-bridge-page', type:'set-token', token, user})
//        content-script → chrome.runtime.sendMessage({type:'set-extension-token', ...})
//        background → stores in chrome.storage.local, replies {ok:true}
//        content-script → window.postMessage({source:'extension-bridge', type:'token-ack'})
//
//   2. Active self-connect (any OTHER server page): if the extension isn't
//      linked yet and this page has a logged-in session cookie, we mint a
//      token straight from that session and store it — no special page, no
//      redirect. This covers users who log in via the normal login form,
//      an SSO/OAuth redirect, or are simply already signed in.
//
// Self-connect is skipped on /auth/* so it can't race the page-driven handoff:
// POST /api/auth/extension-token rotates the stored token server-side, so two
// concurrent mints would invalidate each other.

(async () => {
  let serverUrl = '';
  try {
    const stored = await chrome.storage.local.get('serverUrl');
    serverUrl = stored.serverUrl || '';
  } catch { return; }
  if (!serverUrl) return;

  // Compare origins — strip trailing slash and normalize.
  let configuredOrigin;
  try { configuredOrigin = new URL(serverUrl).origin; } catch { return; }
  if (location.origin !== configuredOrigin) return;

  // ── Universal: tell the page whether the extension is installed + linked ──
  // Lets a server page render a live connection indicator. The page posts
  // {source:'extension-bridge-page', type:'status-request'} and/or just listens
  // for {source:'extension-bridge', type:'status', installed, linked, isGuest}.
  // We also announce proactively on load and whenever the token changes, so a
  // self-connect (below) flips the page from "not linked" to "connected" live.
  function announceStatus() {
    try {
      chrome.storage.local.get(['extensionToken', 'userIsGuest'], (s) => {
        try {
          window.postMessage({
            source: 'extension-bridge',
            type: 'status',
            installed: true,
            linked: !!(s && s.extensionToken),
            isGuest: !!(s && s.userIsGuest === true),
          }, location.origin);
        } catch {}
      });
    } catch {}
  }
  window.addEventListener('message', (ev) => {
    if (ev.source !== window || ev.origin !== location.origin) return;
    const m = ev.data;
    if (m && typeof m === 'object' && m.source === 'extension-bridge-page' && m.type === 'status-request') {
      announceStatus();
    }
  });
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && (changes.extensionToken || changes.userIsGuest)) announceStatus();
    });
  } catch {}
  announceStatus();

  // ── Path 1: passive handoff on /auth/* token-issuing pages ──
  if (location.pathname.startsWith('/auth/')) {
    window.addEventListener('message', async (ev) => {
      if (ev.source !== window) return;
      if (ev.origin !== location.origin) return;
      const msg = ev.data;
      if (!msg || typeof msg !== 'object') return;
      if (msg.source !== 'extension-bridge-page') return;
      if (msg.type !== 'set-token') return;
      if (typeof msg.token !== 'string' || msg.token.length < 20 || msg.token.length > 4096) return;

      try {
        const reply = await chrome.runtime.sendMessage({
          type: 'set-extension-token',
          token: msg.token,
          user: msg.user || null,
        });
        if (reply && reply.ok) {
          window.postMessage({ source: 'extension-bridge', type: 'token-ack' }, location.origin);
        }
      } catch {
        // Background may be asleep on first connect; the page keeps its
        // copy-paste fallback visible, so silent failure is acceptable.
      }
    });
    return; // never self-connect on /auth/* — avoid racing the page handoff
  }

  // ── Path 2: active self-connect on any other server page ──

  async function trySelfConnect() {
    // Already linked? Don't re-mint — that would rotate the server-side token
    // and could log out the extension on another browser/device.
    try {
      const { extensionToken } = await chrome.storage.local.get('extensionToken');
      if (extensionToken) return;
    } catch { return; }

    // Logged in here? /api/auth/me with the page's session cookie tells us.
    let user;
    try {
      const meRes = await fetch(`${configuredOrigin}/api/auth/me`, { credentials: 'include' });
      if (!meRes.ok) return; // 401 → not signed in on this origin; nothing to do
      const me = await meRes.json();
      if (!me || !me.ok || !me.user) return;
      user = me.user;
    } catch { return; }

    // Mint an extension token from the cookie session.
    let token;
    try {
      const tokRes = await fetch(`${configuredOrigin}/api/auth/extension-token`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!tokRes.ok) return; // server may not support this — manual path stays available
      const data = await tokRes.json();
      if (!data || !data.ok || !data.token) return;
      token = data.token;
    } catch { return; }

    try {
      await chrome.runtime.sendMessage({ type: 'set-extension-token', token, user });
    } catch {
      // Service worker asleep — a later focus/visibility retry will catch it.
    }
  }

  trySelfConnect();

  // Re-attempt when the user returns to this tab — covers signing in within
  // this same tab (login form, OAuth redirect that landed on the dashboard)
  // or in another window and then switching back.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) trySelfConnect(); });
  window.addEventListener('focus', () => trySelfConnect());
})();
