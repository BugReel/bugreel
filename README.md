# BugReel

**Record a bug. Get a complete report. Automatically.**

BugReel is an open-source, self-hosted, AI-powered bug reporting tool. Record your screen, narrate the bug, and AI generates a complete card with title, steps to reproduce, key frame screenshots, and severity — in minutes, not hours.

## How it works

1. **Record** — Click the Chrome extension, reproduce the bug, stop
2. **AI analyzes** — Whisper transcribes speech, GPT extracts steps, severity, and key frames
3. **Export** — One click to send to your tracker (Jira, Linear, GitHub Issues, YouTrack, or webhook)

## Features

- **AI-powered analysis** — automatic transcription, step extraction, severity assessment
- **Smart screenshots** — key frames extracted from video at important moments
- **One-click export** — Jira, Linear, GitHub Issues, YouTrack, or any tool via webhook
- **Self-hosted** — your data stays on your server. One-command Docker setup
- **Complexity scoring** — 5-dimension system (scope, risk, domain, novelty, clarity)
- **Console & action capture** — JS errors, user clicks, URL changes synced to timeline
- **Interactive timeline** — video player with transcript, frames, and click-to-screenshot
- **Public reports** — shareable links with no auth required
- **Bring your own AI** — works with any OpenAI-compatible API (OpenAI, Azure, Ollama)

## Quick start

```bash
git clone https://github.com/bugreel/bugreel.git
cd bugreel
cp .env.example .env
# Edit .env — add your OpenAI API key (GPT_API_KEY)
docker-compose up -d
```

Open `http://localhost:3500` — done.

**Requirements:** Docker with FFmpeg (included in image), OpenAI API key (or compatible endpoint).

## Integrations

| Tracker | Auth | Attachments | Tier | Status |
|---|---|---|---|---|
| YouTrack | Token | Yes (2-step) | Free | Shipped |
| Generic Webhook | HMAC-SHA256 | JSON payload | Free | Built |
| Jira Cloud | OAuth 2.0 | Multipart | Team | Built |
| Linear | OAuth 2.0 PKCE | Embedded links | Team | Built |
| GitHub Issues | OAuth 2.0 | Embedded links* | Team | Built |
| ClickUp | OAuth 2.0 | Yes | Team | Planned |
| Asana | OAuth 2.0 | Yes | Team | Planned |

\* GitHub has no API for file attachments — screenshots embedded as markdown image links.

## Pricing

| | Community (Free) | Team ($8/user/mo) | Enterprise |
|---|---|---|---|
| Users | Up to 5 | Up to 50 | Unlimited |
| AI analysis | Unlimited | Unlimited | Unlimited |
| Integrations | Webhook + YouTrack | All | All + custom |
| Auth | Password + Invite | + OAuth via tracker | + SSO/SAML |
| Support | GitHub Issues | Priority | Dedicated |

Free tier requires no license key. Team tier: set `LICENSE_KEY` in `.env`.

## Tech stack

- **Backend:** Node.js 20, Express, SQLite (better-sqlite3), FFmpeg
- **Dashboard:** Vanilla HTML/CSS/JS, dark theme
- **Extension:** Chrome Manifest V3 (Firefox support built, not yet published)
- **AI:** OpenAI Whisper (transcription) + GPT (analysis) — any OpenAI-compatible endpoint
- **Dependencies:** 6 npm packages

## Browser support

| Browser | Status |
|---|---|
| Chrome, Edge, Brave, Arc, Opera | Shipped |
| Firefox | Built (not yet in Add-ons store) |
| Safari | Not planned |

## License

BSL (Business Source License) — free for self-hosting and internal use. See [LICENSE](LICENSE) for details.
