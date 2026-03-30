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
  youtrack: {
    url: process.env.YOUTRACK_URL || '',
    token: process.env.YOUTRACK_TOKEN || '',
    project: process.env.YOUTRACK_PROJECT || 'BUG',
  },
  maxVideoSize: parseInt(process.env.MAX_VIDEO_SIZE || '104857600'),
  maxVideoDuration: parseInt(process.env.MAX_VIDEO_DURATION || '300'),
  maxScreenshots: parseInt(process.env.MAX_SCREENSHOTS || '10'),
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
  },

  // Analytics — inject counters into dashboard and embed pages.
  // DB settings take priority over env vars (same chain as branding).
  analytics: {
    yandexMetrikaId: process.env.ANALYTICS_YANDEX_METRIKA_ID || '',
    gtagId: process.env.ANALYTICS_GTAG_ID || '',
  },
};
