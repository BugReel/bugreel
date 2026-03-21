# BugReel — Development Instructions

> AI-powered bug reporting tool: screen recording → transcription → AI analysis → bug card → tracker export.
> Commercial product based on internal-tool codebase.
>
> Core features: AI analysis, smart screenshots, one-click export (Jira/Linear/GitHub/YouTrack/webhook),
> webcam PiP, password-protected recordings, embeddable player, video comments, view analytics.

## Project Status: Deployed

Code migrated from `../internal/internal-tool/` (internal tool) → this repo (commercial product). Landing and GitHub repo are live.

**Live URLs:**
- **Landing:** https://bugreel.io (Vercel, Astro 6 static, SSL working)
- **GitHub:** https://github.com/BugReel/bugreel (public, BugReel org, 107 files, 27K+ lines)
- **Vercel:** auto-deploys from GitHub on push to main (project "landing" under scope "your-vercel-scope")
- **Chrome Web Store:** not submitted yet
- **Firefox Add-ons:** not submitted yet

## Architecture

```
bugreel/
├── server/                    # Node.js 20, Express, SQLite
│   ├── core/                  # Pipeline: ffmpeg, whisper, gpt (from internal-tool)
│   ├── integrations/          # Plugin system: jira, linear, github, youtrack, webhook
│   ├── auth/                  # OAuth (via tracker) + invite links + simple (legacy)
│   ├── routes/                # API endpoints
│   ├── services/              # Business logic
│   ├── prompts/               # AI prompt templates (English)
│   └── config.js              # Unified .env config
├── dashboard/                 # Vanilla HTML/CSS/JS, dark theme, English
│   ├── js/                    # API client, timeline, shared utils
│   └── css/                   # Design system
├── extension/                 # Chrome MV3 + Firefox
│   ├── manifest.json
│   ├── background.js          # State machine
│   ├── popup.*                # Recording UI
│   └── content-scripts/       # Error capture, action tracking, widget
├── landing/                   # Marketing site (Astro/static)
├── docs/                      # Strategy, architecture, integration specs
├── deploy/                    # Docker, docker-compose, presets/
├── Dockerfile
├── docker-compose.yml
└── package.json
```

## Source codebase

Original code: `../internal/internal-tool/` (~10K lines JS, 6 npm deps, 5 SQLite tables, 25+ API endpoints).

**What needs to change (sanitization):**
- Remove all Internal hardcodes (18 files — full list in `docs/strategy.md` §14)
- Replace api.openai.com → standard OpenAI endpoints in defaults
- Translate UI: Russian → English
- Translate GPT prompt: Russian → English (multi-language transcription stays)
- Remove seed data (team names)
- Add config-driven architecture (everything via .env)

## Key Documentation

| Document | When to read |
|---|---|
| `docs/strategy.md` | Full commercial strategy, roadmap, competitive analysis |
| `docs/architecture.md` | Technical architecture decisions |
| `docs/integrations.md` | Tracker API research (13 trackers analyzed) |
| `README.md` | Public-facing product description |

## Development Phases

| Phase | Focus | Status |
|---|---|---|
| **0. Setup** | Repo, copy code, rebrand | **Done** |
| **1. Core** | Remove hardcodes, config, Docker, English UI, auth | **Done** |
| **2. Integrations** | Jira, Linear, GitHub Issues, Webhook, Landing | **Done** |
| **3. Launch** | Chrome Web Store, Product Hunt, SEO articles | **Current** |

## Auth Model

3 modes (configured per instance):

1. **OAuth via tracker** — "Sign in with Jira/GitHub/Linear". Users imported from tracker automatically
2. **Invite links** — Admin sends link, user creates account (name + email). For self-hosted without tracker
3. **Simple** — Shared password (dev/legacy mode)

Extension auth: User generates extension token in dashboard (Settings → "Generate Extension Token"), pastes in extension setup.
All uploads include Bearer token → server identifies user automatically. No author dropdown.

### Proxy auth (reverse proxy mode)

When behind a reverse proxy, BugReel trusts `X-User-Id`, `X-User-Email`, `X-User-Name` headers set by the proxy. Users are auto-created on first request. The proxy must strip these headers from external requests to prevent spoofing. See `server/auth.js` → `authenticateRequest()`.

### Security notes

- **share_token** (UUID) — public report links use `/report/{share_token}` instead of sequential IDs to prevent enumeration. Auto-generated for every recording in `server/db.js`.
- **Password protection** — individual recordings can be locked with a password (scrypt-hashed). See `server/middleware/password-check.js` and `server/routes/password.js`.
- **DASHBOARD_PASSWORD** — must be set in production. Without it and with no users in the DB, the dashboard is fully open (dev mode).

## Integration Plugin Interface

```javascript
export class TrackerIntegration {
  name = 'base'
  supportsOAuth = false
  supportsAttachments = false

  // OAuth
  getOAuthURL(state) { }
  handleOAuthCallback(code) { }
  refreshToken(refreshToken) { }

  // Issues
  async createIssue(card, frames, user) { }
  async searchIssues(query, user) { }

  // Team
  async getProjects(user) { }
  async getUsers(user) { }

  // Config
  getSetupSchema() { }
}
```

## Rules

### Language: English ONLY
- **This is an international open-source product. ALL content MUST be in English.**
- Code, comments, variable names — English
- UI strings (dashboard, extension) — English
- Documentation (README, docs/, CLAUDE.md) — English
- Git commits — English
- GPT/AI prompts — English
- Error messages, logs — English
- **No Russian, no Cyrillic anywhere in the repo.** Zero exceptions.
- Internal dev discussions happen in Russian, but nothing in Russian goes into the codebase.

### Code & Architecture
- **No hardcodes** — Everything configurable via .env
- **No PII in repo** — No API keys, tokens, team names, server IPs
- **Docker-ready** — Must work with `docker-compose up`
- **Minimal dependencies** — Keep it lean (currently 6 npm packages)
- **.env.example** — Always up to date, with standard OpenAI endpoints as defaults
- **No references to Internal, internal, gptproxy, or any internal infrastructure**

### Monetization: License Key Gating
- **Single codebase** — paid features are in this repo, gated by `server/license.js`
- **Free (Community):** 5 users, Webhook + YouTrack integrations, simple + invite auth
- **Paid (Team):** 50 users, all integrations (Jira, Linear, GitHub, etc.), OAuth via tracker
- **License key** via .env: `LICENSE_KEY=breel-xxxx` → JWT verified with public key
- **Gating pattern:** `requireTier('team')` middleware on paid routes
- **Billing is NOT in this repo** — separate private `bugreel-cloud` repo (Stripe + license server)
- When adding a new paid feature: wrap route with `requireTier()`, return 403 with `upgrade_url`
- Free features must always work without any license key or network access
