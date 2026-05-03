import crypto from 'crypto';
import { Router } from 'express';
import { config } from './config.js';
import { getDB } from './db.js';

const AUTH_COOKIE = 'tracker_auth';

// Reverse proxies must keep header values within ASCII (RFC 7230). When the
// upstream user has a non-ASCII name like "Алексей", the proxy percent-encodes
// it. Decode here transparently — plain ASCII strings pass through unchanged.
function decodeProxyHeader(value) {
  if (!value) return '';
  const s = String(value);
  if (!s.includes('%')) return s;
  try { return decodeURIComponent(s); } catch { return s; }
}

// Legacy token for backward compatibility (simple mode)
const LEGACY_AUTH_TOKEN = config.dashboardPassword
  ? crypto.createHash('sha256').update(config.dashboardPassword + 'bugreel-default-salt').digest('hex')
  : '';

// --- Password hashing with crypto.scrypt ---

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const attempt = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(attempt, 'hex'));
}

// --- Session helpers ---

function createSession(userId, type = 'dashboard', userAgent = '') {
  const db = getDB();
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = type === 'extension'
    ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString() // 1 year
    : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();  // 30 days
  db.prepare(`
    INSERT INTO sessions (token, user_id, type, user_agent, expires_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(token, userId, type, userAgent, expiresAt);
  return { token, expiresAt };
}

function getUserBySession(token) {
  const db = getDB();
  const row = db.prepare(`
    SELECT u.* FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = ? AND s.expires_at > datetime('now')
  `).get(token);
  return row || null;
}

function getCookie(req, name) {
  const header = req.headers.cookie || '';
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie',
    `${AUTH_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 3600}`
  );
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${AUTH_COOKIE}=; Path=/; HttpOnly; Max-Age=0`);
}

// --- Auth middleware ---

/**
 * authenticateRequest — checks cookie OR Bearer token, sets req.user.
 * Does NOT block — just identifies the user if possible.
 */
export function authenticateRequest(req, res, next) {
  // 0. Trust proxy headers from Cloud Layer (X-User-Id set by reverse proxy)
  const proxyUserId = req.headers['x-user-id'];
  if (proxyUserId) {
    const db = getDB();
    // Find user by ID or email
    let user = db.prepare('SELECT * FROM users WHERE id = ?').get(proxyUserId);
    if (!user) {
      // Try by email (cloud layer sends X-User-Email)
      const proxyEmail = decodeProxyHeader(req.headers['x-user-email']);
      if (proxyEmail) {
        user = db.prepare('SELECT * FROM users WHERE email = ?').get(proxyEmail);
      }
    }
    if (!user) {
      // Auto-create user from proxy headers (first proxied user accessing BugReel).
      // Header values are ASCII-only per RFC 7230, so the proxy may percent-encode
      // non-ASCII characters (e.g. Cyrillic names). Decode defensively.
      const userId = proxyUserId;
      const email = decodeProxyHeader(req.headers['x-user-email']) || `${proxyUserId}@proxy.local`;
      const name = decodeProxyHeader(req.headers['x-user-name']) || 'Proxy User';
      db.prepare(`
        INSERT OR IGNORE INTO users (id, name, email, auth_provider, role)
        VALUES (?, ?, ?, 'proxy', 'admin')
      `).run(userId, name, email);
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    }
    if (user) {
      req.user = user;
      return next();
    }
  }

  // 1. Check Bearer token (extension auth)
  const authHeader = req.headers.authorization || '';
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const user = getUserBySession(token);
    if (user) {
      req.user = user;
      return next();
    }
  }

  // 2. Check session cookie (new auth)
  const cookieToken = getCookie(req, AUTH_COOKIE);
  if (cookieToken) {
    // Try as session token first
    const user = getUserBySession(cookieToken);
    if (user) {
      req.user = user;
      return next();
    }

    // Backward compatibility: legacy hash-based cookie
    if (cookieToken === LEGACY_AUTH_TOKEN && config.dashboardPassword) {
      // Find or create the admin user from legacy auth
      const db = getDB();
      const admin = db.prepare("SELECT * FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1").get();
      if (admin) {
        req.user = admin;
        // Upgrade: create a real session and replace the legacy cookie
        const session = createSession(admin.id, 'dashboard', req.headers['user-agent'] || '');
        setSessionCookie(res, session.token);
        return next();
      }
    }
  }

  // 3. No auth found
  next();
}

/**
 * requireAuth — 401 if not authenticated.
 */
export function requireAuth(req, res, next) {
  if (!req.user) {
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Smart link: /recording/{id} → redirect to /report/{share_token} for non-authenticated users
    const recMatch = req.path.match(/^\/recording\/(.+)$/);
    if (recMatch) {
      const recId = decodeURIComponent(recMatch[1]);
      const db = getDB();
      const rec = db.prepare('SELECT share_token FROM recordings WHERE id = ?').get(recId);
      if (rec && rec.share_token) {
        return res.redirect(`/report/${encodeURIComponent(rec.share_token)}`);
      }
      return res.redirect(`/report/${recMatch[1]}`);
    }

    return res.redirect('/login');
  }
  next();
}

/**
 * requireAdmin — 403 if not admin role.
 */
export function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: admin access required' });
  }
  next();
}

/**
 * isPublicRoute — returns true for routes that don't need auth.
 */
function isPublicRoute(req) {
  const p = req.path;

  // Auth endpoints
  if (p === '/login' || p === '/api/auth/login' || p === '/api/auth/register') return true;

  // Report pages (public share links)
  if (p.startsWith('/report/')) return true;

  // Embed pages (public, embeddable in iframes)
  if (p.startsWith('/embed/')) return true;

  // Static assets
  if (p.startsWith('/css/') || p.startsWith('/js/')) return true;

  // Extension upload (authenticated via Bearer token, handled separately)
  if (p.startsWith('/api/upload')) return true;

  // Public share-token lookup (the canonical endpoint for /report/ pages)
  if (req.method === 'GET' && /^\/api\/recordings\/by-token\//.test(p)) return true;

  // Public report page assets — the route itself enforces share_token vs id
  // ownership, so leaving the routes "public" only means auth isn't required
  // to attempt them; non-owner ids return 404 inside the handler.
  if (req.method === 'GET' && /^\/api\/recordings\/[^/]+\/(video|subtitles\.vtt)$/.test(p)) return true;
  if (req.method === 'GET' && /^\/api\/recordings\/[^/]+\/frames\//.test(p)) return true;

  // Legacy fallback: /api/recordings/{share_token} returns the same JSON as
  // /by-token/{share_token}. Kept public for old report links; handler
  // rejects any id that isn't a share_token unless caller owns it.
  if (req.method === 'GET' && /^\/api\/recordings\/[^/]+$/.test(p)) return true;

  // Video comments: GET and POST are public, DELETE is handled by the route (requires auth)
  if (/^\/api\/recordings\/[^/]+\/comments/.test(p)) return true;

  // Password verification: public endpoint for unlocking password-protected recordings
  if (req.method === 'POST' && /^\/api\/recordings\/[^/]+\/verify-password$/.test(p)) return true;

  // View analytics tracking (POST view + heartbeat called from public report page)
  if (req.method === 'POST' && (p === '/api/analytics/view' || p === '/api/analytics/heartbeat')) return true;

  return false;
}

/**
 * authGuard — combined middleware: authenticate + enforce auth on protected routes.
 * If no password is configured AND no users exist — skip auth (dev mode).
 */
export function authGuard(req, res, next) {
  // Proxy mode: when running behind a trusted proxy (e.g. SaaS Cloud Layer)
  // that handles authentication, skip Core's own auth entirely.
  // Set TRUST_PROXY_AUTH=true in .env when Core is a backend behind an auth proxy.
  if (process.env.TRUST_PROXY_AUTH === 'true') {
    return authenticateRequest(req, res, () => {
      if (!req.user) {
        req.user = {
          id: 'proxy-user',
          name: decodeProxyHeader(req.headers['x-user-name']) || 'User',
          email: decodeProxyHeader(req.headers['x-user-email']) || '',
          role: 'admin',
        };
      }
      next();
    });
  }

  // Dev mode: no password AND no users — authenticate but don't require
  if (!config.dashboardPassword) {
    const db = getDB();
    const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
    if (userCount === 0) {
      // Still try to authenticate (proxy headers, Bearer token)
      return authenticateRequest(req, res, () => {
        // If no auth found, create a virtual dev user so requireAuth passes
        if (!req.user) {
          req.user = { id: 'dev-user', name: 'Developer', email: 'dev@bugreel.local', role: 'admin' };
        }
        next();
      });
    }
  }

  // Public routes — no auth needed (but still try to identify user)
  if (isPublicRoute(req)) {
    return authenticateRequest(req, res, next);
  }

  // Protected routes — authenticate then require auth
  authenticateRequest(req, res, () => {
    requireAuth(req, res, next);
  });
}

// --- Auth routes ---

const router = Router();

/**
 * POST /api/auth/login — email + password login
 */
router.post('/auth/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const db = getDB();

  // Find user by email
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);

  if (user && user.password_hash) {
    // User exists with password — verify
    if (!verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
  } else if (!user && config.dashboardPassword && password === config.dashboardPassword) {
    // Backward compatibility: login with DASHBOARD_PASSWORD creates/finds admin
    // This handles the case where someone uses the old password but with an email
    return res.status(401).json({ error: 'Invalid credentials' });
  } else {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  // Update last login
  db.prepare('UPDATE users SET last_login_at = datetime(?) WHERE id = ?')
    .run(new Date().toISOString(), user.id);

  // Create session
  const session = createSession(user.id, 'dashboard', req.headers['user-agent'] || '');
  setSessionCookie(res, session.token);

  return res.json({
    ok: true,
    user: { id: user.id, name: user.name, email: user.email, role: user.role, avatar_url: user.avatar_url },
  });
});

/**
 * POST /api/auth/register — register via invite code
 */
router.post('/auth/register', (req, res) => {
  const { name, email, password, invite_code } = req.body;

  if (!name || !email || !password || !invite_code) {
    return res.status(400).json({ error: 'Name, email, password, and invite_code are required' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  const db = getDB();

  // Validate invite code
  const invite = db.prepare(`
    SELECT * FROM invites WHERE code = ? AND used_by IS NULL AND expires_at > datetime('now')
  `).get(invite_code);

  if (!invite) {
    return res.status(400).json({ error: 'Invalid or expired invite code' });
  }

  // Check email uniqueness
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) {
    return res.status(409).json({ error: 'Email already registered' });
  }

  // Create user
  const userId = crypto.randomUUID();
  const passwordHash = hashPassword(password);

  db.prepare(`
    INSERT INTO users (id, name, email, auth_provider, password_hash, role)
    VALUES (?, ?, ?, 'simple', ?, ?)
  `).run(userId, name, email, passwordHash, invite.role);

  // Mark invite as used
  db.prepare('UPDATE invites SET used_by = ?, used_at = datetime(?) WHERE code = ?')
    .run(userId, new Date().toISOString(), invite_code);

  // Create session
  const session = createSession(userId, 'dashboard', req.headers['user-agent'] || '');
  setSessionCookie(res, session.token);

  return res.json({
    ok: true,
    user: { id: userId, name, email, role: invite.role },
  });
});

/**
 * POST /api/auth/invite — admin only: generate invite link
 */
router.post('/auth/invite', requireAuth, requireAdmin, (req, res) => {
  const { role = 'member', expires_hours = 72 } = req.body;
  const db = getDB();

  const code = crypto.randomBytes(16).toString('hex');
  const expiresAt = new Date(Date.now() + expires_hours * 60 * 60 * 1000).toISOString();

  db.prepare(`
    INSERT INTO invites (code, created_by, role, expires_at) VALUES (?, ?, ?, ?)
  `).run(code, req.user.id, role, expiresAt);

  const baseUrl = config.dashboardUrl || `${req.protocol}://${req.get('host')}`;
  const inviteUrl = `${baseUrl}/login?invite=${code}`;

  return res.json({ ok: true, code, url: inviteUrl, expires_at: expiresAt });
});

/**
 * GET /api/auth/invites — admin only: list active invites
 */
router.get('/auth/invites', requireAuth, requireAdmin, (req, res) => {
  const db = getDB();
  const invites = db.prepare(`
    SELECT i.code, i.role, i.expires_at, i.created_at, i.used_at,
           creator.name as created_by_name,
           used.name as used_by_name
    FROM invites i
    LEFT JOIN users creator ON creator.id = i.created_by
    LEFT JOIN users used ON used.id = i.used_by
    ORDER BY i.created_at DESC
  `).all();
  return res.json({ ok: true, invites });
});

/**
 * DELETE /api/auth/invites/:code — admin only: revoke invite
 */
router.delete('/auth/invites/:code', requireAuth, requireAdmin, (req, res) => {
  const db = getDB();
  const result = db.prepare('DELETE FROM invites WHERE code = ? AND used_by IS NULL').run(req.params.code);
  if (result.changes === 0) {
    return res.status(404).json({ error: 'Invite not found or already used' });
  }
  return res.json({ ok: true });
});

/**
 * POST /api/auth/extension-token — generate long-lived extension token for current user
 */
router.post('/auth/extension-token', requireAuth, (req, res) => {
  const session = createSession(req.user.id, 'extension', req.headers['user-agent'] || '');
  return res.json({ ok: true, token: session.token, expires_at: session.expiresAt });
});

/**
 * GET /api/auth/me — return current user info
 */
router.get('/auth/me', requireAuth, (req, res) => {
  const { id, name, email, role, avatar_url, created_at, last_login_at } = req.user;
  return res.json({ ok: true, user: { id, name, email, role, avatar_url, created_at, last_login_at } });
});

/**
 * POST /api/auth/logout — clear session
 */
router.post('/auth/logout', (req, res) => {
  const cookieToken = getCookie(req, AUTH_COOKIE);
  if (cookieToken && cookieToken !== LEGACY_AUTH_TOKEN) {
    const db = getDB();
    db.prepare('DELETE FROM sessions WHERE token = ?').run(cookieToken);
  }
  clearSessionCookie(res);
  return res.json({ ok: true });
});

/**
 * GET /api/users — list all users (admin only)
 */
router.get('/users', requireAuth, requireAdmin, (req, res) => {
  const db = getDB();
  const users = db.prepare(`
    SELECT id, name, email, avatar_url, auth_provider, role, created_at, last_login_at
    FROM users ORDER BY created_at
  `).all();
  return res.json({ ok: true, users });
});

/**
 * PUT /api/users/:id — update user role (admin only)
 */
router.put('/users/:id', requireAuth, requireAdmin, (req, res) => {
  const { role } = req.body;
  if (!role || !['admin', 'member', 'viewer'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role. Must be: admin, member, or viewer' });
  }

  const db = getDB();

  // Prevent removing the last admin
  if (role !== 'admin') {
    const adminCount = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'admin'").get().count;
    const targetUser = db.prepare('SELECT role FROM users WHERE id = ?').get(req.params.id);
    if (targetUser && targetUser.role === 'admin' && adminCount <= 1) {
      return res.status(400).json({ error: 'Cannot remove the last admin' });
    }
  }

  const result = db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, req.params.id);
  if (result.changes === 0) {
    return res.status(404).json({ error: 'User not found' });
  }
  return res.json({ ok: true });
});

/**
 * DELETE /api/users/:id — delete user (admin only)
 */
router.delete('/users/:id', requireAuth, requireAdmin, (req, res) => {
  if (req.params.id === req.user.id) {
    return res.status(400).json({ error: 'Cannot delete yourself' });
  }

  const db = getDB();

  // Prevent deleting the last admin
  const targetUser = db.prepare('SELECT role FROM users WHERE id = ?').get(req.params.id);
  if (!targetUser) {
    return res.status(404).json({ error: 'User not found' });
  }
  if (targetUser.role === 'admin') {
    const adminCount = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'admin'").get().count;
    if (adminCount <= 1) {
      return res.status(400).json({ error: 'Cannot delete the last admin' });
    }
  }

  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  return res.json({ ok: true });
});

// --- Legacy login handler (backward compatibility for /login POST form) ---

/**
 * handleLegacyLogin — POST /login with password field (old simple auth)
 * If DASHBOARD_PASSWORD matches, finds or creates admin, starts session.
 */
export function handleLegacyLogin(req, res) {
  const { password } = req.body;

  if (!config.dashboardPassword) {
    return res.json({ ok: true });
  }

  if (password !== config.dashboardPassword) {
    return res.status(401).json({ error: 'Wrong password' });
  }

  const db = getDB();

  // Find existing admin or auto-create one
  let admin = db.prepare("SELECT * FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1").get();
  if (!admin) {
    const userId = crypto.randomUUID();
    const passwordHash = hashPassword(password);
    db.prepare(`
      INSERT INTO users (id, name, email, auth_provider, password_hash, role)
      VALUES (?, 'Admin', 'admin@bugreel.local', 'simple', ?, 'admin')
    `).run(userId, passwordHash);
    admin = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  }

  // Update last login
  db.prepare('UPDATE users SET last_login_at = datetime(?) WHERE id = ?')
    .run(new Date().toISOString(), admin.id);

  // Create session
  const session = createSession(admin.id, 'dashboard', req.headers['user-agent'] || '');
  setSessionCookie(res, session.token);

  return res.json({ ok: true });
}

/**
 * handleLogout — POST /logout (legacy route)
 */
export function handleLogout(req, res) {
  const cookieToken = getCookie(req, AUTH_COOKIE);
  if (cookieToken && cookieToken !== LEGACY_AUTH_TOKEN) {
    const db = getDB();
    db.prepare('DELETE FROM sessions WHERE token = ?').run(cookieToken);
  }
  clearSessionCookie(res);
  res.redirect('/login');
}

export const authRouter = router;

// Exported for testing
export { hashPassword, verifyPassword, createSession, getUserBySession };
