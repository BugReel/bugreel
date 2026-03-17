import crypto from 'crypto';
import { config } from './config.js';
import { getDB } from './db.js';

// License tiers and their limits
const TIERS = {
  community: {
    maxUsers: 5,
    integrations: ['webhook', 'youtrack'],
    oauth: false,
    removeBranding: false,
  },
  team: {
    maxUsers: 50,
    integrations: 'all',
    oauth: true,
    removeBranding: true,
  },
  enterprise: {
    maxUsers: Infinity,
    integrations: 'all',
    oauth: true,
    removeBranding: true,
  },
};

// Tier hierarchy for comparison
const TIER_ORDER = ['community', 'team', 'enterprise'];

// Placeholder RSA public key for JWT verification.
// Replace with your actual public key when issuing production licenses.
const LICENSE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0placeholder0replace0
with0your0actual0public0key0when0you0start0issuing0
license0keys0from0your0licensing0server00000000000000
00000000000000000000000000000000000000000000000000
PLACEHOLDER0KEY
-----END PUBLIC KEY-----`;

/**
 * Decode a JWT token manually using Node.js crypto (no external deps).
 * Returns the payload object or null if verification fails.
 */
function decodeJWT(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [headerB64, payloadB64, signatureB64] = parts;

    // Decode header to verify algorithm
    const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString());
    if (header.alg !== 'RS256') return null;

    // Verify signature
    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(`${headerB64}.${payloadB64}`);
    const signatureValid = verifier.verify(
      LICENSE_PUBLIC_KEY,
      Buffer.from(signatureB64, 'base64url')
    );

    if (!signatureValid) return null;

    // Decode payload
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());

    // Check expiration
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }

    // Check required fields
    if (!payload.tier || !TIERS[payload.tier]) return null;

    return payload;
  } catch {
    return null;
  }
}

/**
 * Get the current license information.
 * Priority:
 *   1. JWT license key (verified with public key)
 *   2. Dev shorthand: LICENSE_KEY=dev-team or dev-enterprise (non-production only)
 *   3. Fallback: community tier
 */
export function getLicense() {
  const key = config.licenseKey;

  if (!key) {
    return { tier: 'community', ...TIERS.community, source: 'default' };
  }

  // Dev shorthand keys (only in non-production)
  if (process.env.NODE_ENV !== 'production' && key.startsWith('dev-')) {
    const tierName = key.slice(4); // "dev-team" -> "team"
    if (TIERS[tierName]) {
      return {
        tier: tierName,
        ...TIERS[tierName],
        exp: null,
        iss: 'dev',
        source: 'dev-shorthand',
      };
    }
  }

  // Try JWT decoding
  const payload = decodeJWT(key);
  if (payload) {
    const tierDef = TIERS[payload.tier];
    return {
      tier: payload.tier,
      maxUsers: payload.maxUsers || tierDef.maxUsers,
      integrations: tierDef.integrations,
      oauth: tierDef.oauth,
      removeBranding: tierDef.removeBranding,
      exp: payload.exp || null,
      iss: payload.iss || null,
      source: 'jwt',
    };
  }

  // Invalid key — fall back to community
  return { tier: 'community', ...TIERS.community, source: 'invalid-key' };
}

/**
 * Compare two tiers. Returns true if `current` >= `required`.
 */
function isTierSufficient(current, required) {
  return TIER_ORDER.indexOf(current) >= TIER_ORDER.indexOf(required);
}

/**
 * Express middleware factory: require a minimum license tier.
 * Usage: router.post('/sso', requireTier('team'), handler)
 */
export function requireTier(minTier) {
  return (req, res, next) => {
    const license = getLicense();
    if (isTierSufficient(license.tier, minTier)) {
      req.license = license;
      return next();
    }

    const tierLabel = minTier.charAt(0).toUpperCase() + minTier.slice(1);
    return res.status(403).json({
      error: 'upgrade_required',
      message: `This feature requires the ${tierLabel} plan.`,
      tier_required: minTier,
      current_tier: license.tier,
      upgrade_url: 'https://bugreel.io/pricing',
    });
  };
}

/**
 * Express middleware: check if a specific integration is allowed
 * by the current license tier.
 * Usage: router.post('/integrations/jira', checkIntegration('jira'), handler)
 */
export function checkIntegration(name) {
  return (req, res, next) => {
    const license = getLicense();
    const allowed = license.integrations === 'all'
      || (Array.isArray(license.integrations) && license.integrations.includes(name));

    if (allowed) {
      req.license = license;
      return next();
    }

    return res.status(403).json({
      error: 'integration_not_available',
      message: `The "${name}" integration requires the Team plan. Your current plan (${license.tier}) includes: ${Array.isArray(license.integrations) ? license.integrations.join(', ') : license.integrations}.`,
      integration: name,
      current_tier: license.tier,
      allowed_integrations: license.integrations,
      upgrade_url: 'https://bugreel.io/pricing',
    });
  };
}

/**
 * Express middleware: check if adding a new user would exceed the
 * license tier's maxUsers limit.
 * Counts distinct authors from the recordings table.
 */
export function checkUserLimit() {
  return (req, res, next) => {
    const license = getLicense();

    // Unlimited users (enterprise or Infinity)
    if (license.maxUsers === Infinity) {
      req.license = license;
      return next();
    }

    try {
      const db = getDB();
      const row = db.prepare('SELECT COUNT(DISTINCT author) as count FROM recordings').get();
      const currentUsers = row?.count || 0;

      // Check if the request author is already known (not a new user)
      const author = req.body?.author || req.query?.author;
      if (author) {
        const exists = db.prepare('SELECT 1 FROM recordings WHERE author = ? LIMIT 1').get(author);
        if (exists) {
          // Existing user — no limit concern
          req.license = license;
          return next();
        }
      }

      if (currentUsers >= license.maxUsers) {
        return res.status(403).json({
          error: 'user_limit_reached',
          message: `Your ${license.tier} plan allows up to ${license.maxUsers} users. You currently have ${currentUsers}.`,
          current_users: currentUsers,
          max_users: license.maxUsers,
          current_tier: license.tier,
          upgrade_url: 'https://bugreel.io/pricing',
        });
      }

      req.license = license;
      return next();
    } catch {
      // If DB is unavailable, don't block the request
      req.license = license;
      return next();
    }
  };
}

/**
 * Route handler: GET /api/license
 * Returns current license info without exposing the raw key.
 */
export function handleGetLicense(req, res) {
  const license = getLicense();

  // Count current users for context
  let currentUsers = 0;
  try {
    const db = getDB();
    const row = db.prepare('SELECT COUNT(DISTINCT author) as count FROM recordings').get();
    currentUsers = row?.count || 0;
  } catch {
    // DB unavailable — report 0
  }

  res.json({
    tier: license.tier,
    maxUsers: license.maxUsers === Infinity ? 'unlimited' : license.maxUsers,
    currentUsers,
    integrations: license.integrations,
    oauth: license.oauth,
    removeBranding: license.removeBranding,
    expires: license.exp ? new Date(license.exp * 1000).toISOString() : null,
    issuer: license.iss || null,
    source: license.source,
  });
}
