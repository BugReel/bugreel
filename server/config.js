import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const config = {
  port: process.env.PORT || 3500,
  host: process.env.HOST || '0.0.0.0',
  dataDir: path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data', 'recordings')),
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
};
