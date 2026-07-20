import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

// Load .env from project root (not CWD) — works regardless of how the process is launched
dotenv.config({ path: path.join(projectRoot, '.env') });

export const config = {
  port: process.env.PORT || 3500,
  host: process.env.HOST || '0.0.0.0',
  dataDir: path.resolve(process.env.DATA_DIR || path.join(projectRoot, 'data')),
  whisper: {
    url: process.env.WHISPER_URL || 'https://api.openai.com/v1/audio/transcriptions',
  },
  gpt: {
    url: process.env.GPT_URL || 'https://api.openai.com/v1/chat/completions',
    apiKey: process.env.GPT_API_KEY || '',
    model: process.env.GPT_MODEL || 'gpt-4o',
  },
  // Vision-based key-frame selection. The model SEES dense candidate frames and
  // picks the distinct, meaningful screen states (+ captions) instead of guessing
  // timestamps from transcript text. Fixes blank/transition thumbnails on
  // screen-share recordings (demos, lessons). See docs/frame-selection-vision.md.
  frameSelect: {
    enabled: (process.env.FRAME_SELECT_ENABLED ?? '1') !== '0',
    model: process.env.FRAME_SELECT_MODEL || 'gpt-5-mini',
    reasoning: process.env.FRAME_SELECT_REASONING || 'minimal',
    candidateInterval: parseFloat(process.env.FRAME_SELECT_INTERVAL || '4'), // sec between candidates
    maxCandidates: parseInt(process.env.FRAME_SELECT_MAX_CANDIDATES || '600'), // safety: interval auto-stretches past this
    windowSize: parseInt(process.env.FRAME_SELECT_WINDOW || '50'), // candidates per vision call
    candidateWidth: parseInt(process.env.FRAME_SELECT_WIDTH || '1280'), // px — readability of UI text
    chapterSnapWindow: parseFloat(process.env.FRAME_SELECT_CHAPTER_SNAP || '20'), // sec: snap chapter thumb to nearest vision moment within this window
    // Speech window around each frame: attach the words spoken near that moment so the model
    // captions a frame by WHAT THE USER SAYS about that screen, not a standalone description.
    // See docs/frame-selection-vision.md.
    speechBefore: parseFloat(process.env.FRAME_SELECT_SPEECH_BEFORE || '5'), // sec of speech before frame
    speechAfter: parseFloat(process.env.FRAME_SELECT_SPEECH_AFTER || '6'), // sec of speech after frame
  },
  youtrack: {
    url: process.env.YOUTRACK_URL || '',
    token: process.env.YOUTRACK_TOKEN || '',
    project: process.env.YOUTRACK_PROJECT || 'BUG',
  },
  // 4 GB — a sanity ceiling against a runaway upload, NOT a business limit.
  // Per-plan limits (duration, storage) belong to the deployment's quota layer;
  // when this value is smaller than what a plan allows, the user records for the
  // time they paid for and is then refused at /upload/init with their recording
  // already made. Whatever this is set to, the browser recorder must cap itself
  // at or below it (dashboard/js/recorder-page.js MAX_RECORDING_BYTES).
  maxVideoSize: parseInt(process.env.MAX_VIDEO_SIZE || '4294967296'),
  maxVideoDuration: parseInt(process.env.MAX_VIDEO_DURATION || '300'),
  // 0 = no fixed limit (the vision model decides count — a long video has more
  // distinct moments). A positive value is a safety ceiling against runaway, not
  // a working cap.
  maxScreenshots: parseInt(process.env.MAX_SCREENSHOTS || '0'),
  maxScreenshotsCeiling: parseInt(process.env.MAX_SCREENSHOTS_CEILING || '200'),
  dashboardPassword: process.env.DASHBOARD_PASSWORD || '',
  dashboardUrl: process.env.DASHBOARD_URL || '',
  licenseKey: process.env.LICENSE_KEY || '',

  // Branding defaults — override via env vars or Settings UI (DB takes priority).
  // See docs/branding.md for details.
  branding: {
    name: process.env.BRAND_NAME || 'BugReel',
    url: process.env.BRAND_URL || 'https://bugreel.io',
    logoUrl: process.env.BRAND_LOGO_URL || '',
    logoLink: process.env.BRAND_LOGO_LINK || '',
    // White-label feature flags — hide sections when a host product doesn't
    // use them (e.g. a SaaS wrapper without issue-tracker integrations).
    hideGuide: /^(1|true|yes)$/i.test(process.env.BRAND_HIDE_GUIDE || ''),
    hideAnalytics: /^(1|true|yes)$/i.test(process.env.BRAND_HIDE_ANALYTICS || ''),
    hideIntegrations: /^(1|true|yes)$/i.test(process.env.BRAND_HIDE_INTEGRATIONS || ''),
    hideCards: /^(1|true|yes)$/i.test(process.env.BRAND_HIDE_CARDS || ''),
    // Hide the branding customization UI itself. A multi-tenant wrapper stores
    // branding as a single instance-wide value, so exposing the editor would let
    // one tenant rebrand the whole deployment — hide it and pin branding via env.
    hideBranding: /^(1|true|yes)$/i.test(process.env.BRAND_HIDE_BRANDING || ''),
    // Host-product URLs surfaced in the dashboard (empty on self-host). A SaaS
    // wrapper sets these to route "Settings" to its account cabinet and to point
    // the extension status badge/banner at its install + connect pages.
    settingsUrl: process.env.ACCOUNT_SETTINGS_URL || '',
    extensionInstallUrl: process.env.EXTENSION_INSTALL_URL || '',
    extensionConnectUrl: process.env.EXTENSION_CONNECT_URL || '',
  },

  // Analytics — inject counters into dashboard and embed pages.
  // DB settings take priority over env vars (same chain as branding).
  analytics: {
    yandexMetrikaId: process.env.ANALYTICS_YANDEX_METRIKA_ID || '',
    gtagId: process.env.ANALYTICS_GTAG_ID || '',
  },

  // Feedback — "Report a problem" button in the dashboard.
  // Button is hidden when no webhook is configured.
  feedback: {
    webhookUrl: process.env.FEEDBACK_WEBHOOK_URL || '',
  },
};
