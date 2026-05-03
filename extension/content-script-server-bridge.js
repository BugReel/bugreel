// Server bridge: lets the dashboard hand a freshly minted extension token
// directly to the extension via window.postMessage, eliminating copy-paste.
//
// Activation rules (defensive):
//   - Only on /auth/* paths (where token-issuing pages live)
//   - Only when window.origin matches the configured serverUrl from storage
//   - Only accepts messages with source='extension-bridge-page' from same origin
//
// Flow:
//   page → window.postMessage({source:'extension-bridge-page', type:'set-token', token, user})
//   content-script → chrome.runtime.sendMessage({type:'set-extension-token', ...})
//   background → stores in chrome.storage.local, replies {ok:true}
//   content-script → window.postMessage({source:'extension-bridge', type:'token-ack'})

(async () => {
  if (!location.pathname.startsWith('/auth/')) return;

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
      // Background may be asleep on first connect; the page will keep its
      // copy-paste fallback visible, so silent failure is acceptable.
    }
  });
})();
