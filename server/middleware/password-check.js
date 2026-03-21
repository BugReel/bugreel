import { getDB } from '../db.js';
import { hasValidAccess } from '../routes/password.js';

/**
 * Password-check middleware for public report pages.
 *
 * Intercepts GET /report/:id requests. If the recording has a password_hash set
 * and the visitor does not have a valid access cookie, it serves a password prompt
 * page instead of the normal report.
 *
 * Authenticated dashboard users (req.user) bypass the password check.
 */
export function passwordCheckPage(req, res, next) {
  // Only intercept report page requests
  if (!req.path.startsWith('/report/')) return next();

  const rawId = req.path.replace('/report/', '').replace(/\/$/, '');
  if (!rawId) return next();
  const recordingId = decodeURIComponent(rawId);

  const db = getDB();
  const recording = db.prepare('SELECT id, password_hash FROM recordings WHERE id = ?').get(recordingId);

  // Recording not found or no password — continue normally
  if (!recording || !recording.password_hash) return next();

  // Authenticated dashboard user — bypass password check
  if (req.user) return next();

  // Check for valid access cookie
  if (hasValidAccess(req, recordingId)) return next();

  // Get recording title for the prompt page (from card if available)
  const card = db.prepare('SELECT title FROM cards WHERE recording_id = ?').get(recordingId);
  const title = card?.title || recordingId;

  // Serve password prompt page
  res.status(200).send(renderPasswordPage(recordingId, title, false));
}

/**
 * Password-check middleware for API endpoints serving recording data.
 *
 * Protects:
 *   GET /api/recordings/:id
 *   GET /api/recordings/:id/video
 *   GET /api/recordings/:id/frames/:filename
 *
 * Returns 403 JSON if password-protected and no valid access.
 * Authenticated dashboard users bypass this check.
 */
export function passwordCheckAPI(req, res, next) {
  // Only check GET requests to specific recording endpoints
  if (req.method !== 'GET') return next();

  // Match /api/recordings/:id paths (but not list endpoint /api/recordings)
  const match = req.path.match(/^\/api\/recordings\/([^/]+)/);
  if (!match) return next();

  const recordingId = decodeURIComponent(match[1]);

  // Skip status/config-type endpoints that don't contain recording data
  if (recordingId === 'status') return next();

  const db = getDB();
  const recording = db.prepare('SELECT id, password_hash FROM recordings WHERE id = ?').get(recordingId);

  // Recording not found or no password — continue normally
  if (!recording || !recording.password_hash) return next();

  // Authenticated dashboard user — bypass password check
  if (req.user) return next();

  // Check for valid access cookie
  if (hasValidAccess(req, recordingId)) return next();

  // Block access
  return res.status(403).json({
    error: 'Password required',
    password_protected: true,
    recording_id: recordingId,
  });
}

/**
 * Password-check middleware for static /data/:recordingId/ paths.
 *
 * Protects direct access to recording files via the static data route.
 * Returns 403 if password-protected and no valid access.
 *
 * NOTE: When mounted as app.use('/data', passwordCheckData, ...),
 * req.path is relative to the mount point (e.g., "/REC-2024-0001/video.webm").
 */
export function passwordCheckData(req, res, next) {
  if (req.method !== 'GET') return next();

  // req.path is relative: /:recordingId/...
  const match = req.path.match(/^\/([^/]+)/);
  if (!match) return next();

  const recordingId = decodeURIComponent(match[1]);

  const db = getDB();
  const recording = db.prepare('SELECT id, password_hash FROM recordings WHERE id = ?').get(recordingId);

  if (!recording || !recording.password_hash) return next();
  if (req.user) return next();
  if (hasValidAccess(req, recordingId)) return next();

  return res.status(403).json({ error: 'Password required' });
}

/**
 * Render the password prompt HTML page.
 * Clean, minimal design matching BugReel dark theme.
 */
function renderPasswordPage(recordingId, title, hasError) {
  const escapedTitle = title
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  const escapedId = recordingId
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Protected Video - BugReel</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600;9..40,700&display=swap');

    :root {
      --bg: #060a14;
      --bg2: #0e1525;
      --surface: #151d30;
      --surface2: #1e2d48;
      --border: #334155;
      --text: #f1f5f9;
      --text2: #94a3b8;
      --text3: #64748b;
      --blue: #3b82f6;
      --blue-dim: rgba(59, 130, 246, 0.15);
      --red: #ef4444;
      --red-dim: rgba(239, 68, 68, 0.15);
      --radius: 8px;
      --radius-lg: 12px;
    }

    *, *::before, *::after {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      -webkit-font-smoothing: antialiased;
    }

    body::before {
      content: '';
      position: fixed;
      inset: 0;
      z-index: -1;
      background:
        radial-gradient(ellipse 50% 40% at 15% 10%, rgba(59, 130, 246, 0.06) 0%, transparent 70%),
        radial-gradient(ellipse 40% 50% at 85% 80%, rgba(139, 92, 246, 0.05) 0%, transparent 70%);
      pointer-events: none;
    }

    .password-container {
      width: 100%;
      max-width: 400px;
      padding: 24px;
    }

    .password-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      padding: 40px 32px;
      text-align: center;
    }

    .lock-icon {
      width: 56px;
      height: 56px;
      margin: 0 auto 20px;
      background: var(--blue-dim);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .lock-icon svg {
      width: 28px;
      height: 28px;
      stroke: var(--blue);
    }

    .password-card h1 {
      font-size: 1.25rem;
      font-weight: 600;
      margin-bottom: 6px;
      word-break: break-word;
    }

    .password-card .subtitle {
      color: var(--text3);
      font-size: 0.85rem;
      margin-bottom: 24px;
    }

    .password-form {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .password-input {
      width: 100%;
      padding: 10px 14px;
      background: var(--bg2);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      color: var(--text);
      font-size: 0.95rem;
      font-family: inherit;
      outline: none;
      transition: border-color 0.15s;
    }

    .password-input:focus {
      border-color: var(--blue);
    }

    .password-input::placeholder {
      color: var(--text3);
    }

    .unlock-btn {
      width: 100%;
      padding: 10px 20px;
      background: var(--blue);
      color: white;
      border: none;
      border-radius: var(--radius);
      font-size: 0.95rem;
      font-weight: 600;
      font-family: inherit;
      cursor: pointer;
      transition: opacity 0.15s;
    }

    .unlock-btn:hover {
      opacity: 0.9;
    }

    .unlock-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .error-message {
      color: var(--red);
      background: var(--red-dim);
      padding: 8px 12px;
      border-radius: var(--radius);
      font-size: 0.85rem;
      display: none;
    }

    .error-message.visible {
      display: block;
    }

    .branding {
      margin-top: 20px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      color: var(--text3);
      font-size: 0.75rem;
    }

    .branding svg {
      width: 14px;
      height: 14px;
      stroke: var(--text3);
    }
  </style>
</head>
<body>
  <div class="password-container">
    <div class="password-card">
      <div class="lock-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
          <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
        </svg>
      </div>

      <h1>${escapedTitle}</h1>
      <p class="subtitle">This video is protected by the author</p>

      <form class="password-form" id="passwordForm">
        <div class="error-message" id="errorMsg">Incorrect password. Please try again.</div>
        <input
          type="password"
          class="password-input"
          id="passwordInput"
          placeholder="Enter password"
          autocomplete="off"
          autofocus
          required
        />
        <button type="submit" class="unlock-btn" id="unlockBtn">Unlock</button>
      </form>

      <div class="branding">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"></circle>
          <circle cx="12" cy="12" r="6"></circle>
          <circle cx="12" cy="12" r="2"></circle>
        </svg>
        BugReel
      </div>
    </div>
  </div>

  <script>
    const form = document.getElementById('passwordForm');
    const input = document.getElementById('passwordInput');
    const btn = document.getElementById('unlockBtn');
    const errorMsg = document.getElementById('errorMsg');
    const recordingId = ${JSON.stringify(recordingId)};

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const password = input.value.trim();
      if (!password) return;

      btn.disabled = true;
      btn.textContent = 'Verifying...';
      errorMsg.classList.remove('visible');

      try {
        const res = await fetch('/api/recordings/' + encodeURIComponent(recordingId) + '/verify-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password }),
        });

        if (res.ok) {
          // Reload page — cookie is now set, will pass through to the report
          window.location.reload();
        } else {
          const data = await res.json();
          errorMsg.textContent = data.error || 'Incorrect password. Please try again.';
          errorMsg.classList.add('visible');
          input.value = '';
          input.focus();
        }
      } catch (err) {
        errorMsg.textContent = 'Connection error. Please try again.';
        errorMsg.classList.add('visible');
      }

      btn.disabled = false;
      btn.textContent = 'Unlock';
    });
  </script>
</body>
</html>`;
}
