import fs from 'fs';
import path from 'path';

/**
 * Server-side meta-tag injection for the public share page (/share/:id).
 *
 * report.html is a static SPA page — its <title> and content are filled in
 * client-side after the browser executes JS. Chat-app / messenger / search
 * crawlers (Telegram, Slack, WhatsApp, iMessage link previews) do NOT run
 * that JS: they read <head> as delivered. Since /share/<id> is the single
 * most-visited screen in the product (per docs/../audit-view-page-and-limits),
 * every link shared into a chat currently previews as an unbranded, titleless
 * "BugReel" card with zero context — this fixes that by rendering the real
 * <head> per recording on the server, then handing off the same static
 * report.html body/scripts unchanged so client-side rendering still owns
 * the interactive page.
 */

let templateCache = null;

function loadTemplate(dashboardDir) {
  // Cached per-process; report.html doesn't change at runtime. Tests create
  // a fresh process per suite so this never serves a stale template across
  // deployments in practice (deploys restart the server).
  if (templateCache) return templateCache;
  templateCache = fs.readFileSync(path.join(dashboardDir, 'report.html'), 'utf8');
  return templateCache;
}

function escapeHTML(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(str) {
  return escapeHTML(str);
}

/**
 * Resolve the recording's display title/description using the same
 * precedence as the client-side render() in dashboard/report.html, so the
 * crawler preview and the page a human lands on agree.
 */
export function resolveShareContent(recording, card) {
  const BUG_LIKE_AI = new Set(['bug', 'feature', 'enhancement']);
  const preferAi = recording.ai_type && !BUG_LIKE_AI.has(recording.ai_type);
  const title = (preferAi ? recording.ai_title : card?.title)
    || recording.ai_title || card?.title || recording.id;
  const description = (preferAi ? recording.ai_summary : card?.summary)
    || recording.ai_summary || card?.summary || '';
  return { title, description };
}

/**
 * Build an absolute URL for a path, using DASHBOARD_URL (config.dashboardUrl)
 * when set, falling back to the request's own scheme+host (same pattern as
 * server/routes/embed.js and server/auth.js).
 */
export function absoluteUrl(req, dashboardUrl, pathname) {
  const base = dashboardUrl || `${req.protocol}://${req.get('host')}`;
  return `${base.replace(/\/$/, '')}${pathname}`;
}

/**
 * Render report.html with per-recording <head> meta tags injected.
 *
 * @param {object} opts
 * @param {object} opts.recording - recordings row (id, share_token, ai_title, ai_summary, ai_type, thumbnail_filename, duration_seconds)
 * @param {object|null} opts.card - cards row (title, summary) or null
 * @param {object} opts.branding - result of getBrandingConfig() (name, url)
 * @param {string} opts.dashboardDir - absolute path to dashboard/
 * @param {string} opts.dashboardUrl - config.dashboardUrl (may be '')
 * @param {object} opts.req - express request (for protocol/host fallback)
 * @param {string} opts.shareToken - the token/id used in the visited URL (for canonical/image URLs)
 * @param {string|null} [opts.thumbnailFrameFilename] - fallback frame filename when no thumbnail_filename
 */
export function renderSharePage({ recording, card, branding, dashboardDir, dashboardUrl, req, shareToken, thumbnailFrameFilename }) {
  const template = loadTemplate(dashboardDir);
  const { title, description } = resolveShareContent(recording, card);
  const brandName = branding?.name || 'BugReel';

  const pageTitle = `${title} — ${brandName}`;
  const ogDescription = description
    ? (description.length > 200 ? `${description.slice(0, 197)}...` : description)
    : `Screen recording shared via ${brandName}.`;

  const thumbFilename = recording.thumbnail_filename || thumbnailFrameFilename || null;
  const pageUrl = absoluteUrl(req, dashboardUrl, `/share/${encodeURIComponent(shareToken)}`);
  const imageUrl = thumbFilename
    ? absoluteUrl(req, dashboardUrl, `/data/${encodeURIComponent(recording.id)}/frames/${encodeURIComponent(thumbFilename)}`)
    : null;

  const metaTags = [
    `<meta property="og:type" content="video.other">`,
    `<meta property="og:site_name" content="${escapeAttr(brandName)}">`,
    `<meta property="og:title" content="${escapeAttr(title)}">`,
    `<meta property="og:description" content="${escapeAttr(ogDescription)}">`,
    `<meta property="og:url" content="${escapeAttr(pageUrl)}">`,
    imageUrl ? `<meta property="og:image" content="${escapeAttr(imageUrl)}">` : '',
    `<meta name="twitter:card" content="${imageUrl ? 'summary_large_image' : 'summary'}">`,
    `<meta name="twitter:title" content="${escapeAttr(title)}">`,
    `<meta name="twitter:description" content="${escapeAttr(ogDescription)}">`,
    imageUrl ? `<meta name="twitter:image" content="${escapeAttr(imageUrl)}">` : '',
  ].filter(Boolean).join('\n  ');

  return template
    .replace('<title>BugReel</title>', `<title>${escapeHTML(pageTitle)}</title>\n  ${metaTags}`);
}
