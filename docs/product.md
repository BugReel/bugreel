# BugReel — Product Definition

> Single source of truth for features, pricing, and positioning.
> All marketing materials (landing, README, articles, store listings) must be consistent with this document.
> Last updated: 2026-03-17

## Positioning

### One-liner

BugReel is an open-source, self-hosted, AI-powered bug reporting tool that turns screen recordings into complete bug reports with steps to reproduce, screenshots, and priority.

### Tagline

"Record a bug. Get a complete report. Automatically."

### Elevator Pitch

Development teams waste 10-20 minutes writing every bug report — capturing screenshots, writing reproduction steps, describing expected vs. actual behavior. BugReel replaces that entire workflow: record your screen, narrate the bug, and AI generates a complete, ready-to-assign card with title, description, reproduction steps, key frame screenshots, and severity assessment. Export to your tracker in one click.

### Target Audience

| Segment | Pain | BugReel Value |
|---|---|---|
| **QA engineers** | 10-20 min per manual bug report | Record + AI = complete card in minutes |
| **Dev teams (5-50 people)** | Bugs get lost, descriptions are incomplete | Single stream, structured, automated |
| **Freelancers & agencies** | Clients cannot explain bugs clearly | Client records screen, AI describes the bug |
| **Support teams** | Translating customer issues into dev-ready tickets | Record customer session, export to tracker |
| **Open source maintainers** | Unstructured issue reports | Structured AI-generated reports |

### Competitive Position

"The open-source, AI-powered alternative to Jam.dev"

| Feature | BugReel | Jam.dev | Marker.io | Bird Eats Bug | Loom |
|---|---|---|---|---|---|
| Screen recording | Yes | Yes | Yes | Yes | Yes |
| AI transcription | Yes | Partial | No | No | Yes |
| AI analysis (full card generation) | **Yes** | No | No | Partial | No |
| Auto screenshot extraction from video | **Yes** | No | No | No | No |
| Complexity scoring (5 dimensions) | **Yes** | No | No | No | No |
| Console error capture | Yes | Yes | Partial | Yes | No |
| User action tracking | Yes | No | Yes | No | No |
| Self-hosted option | **Yes** | No | No | No | No |
| Open source | **Yes** | No | No | No | No |
| Starting price | **Free** | $12.50/user/mo | $39/mo | $25/mo | $12.50/user/mo |

---

## Features — Status Matrix

Status definitions:
- **Shipped** — Code exists in the repo, functional, tested in production
- **Built** — Code exists in the repo, implemented, not yet tested with external users
- **Scaffold** — Code structure/interface exists, implementation partially complete
- **Planned** — In roadmap, no code yet
- **Not Planned** — Explicitly out of scope

| Feature | Description | Status | Tier | Notes |
|---|---|---|---|---|
| **Screen recording (Chrome extension)** | Chrome MV3 extension, tab capture + screen capture, popup UI | Shipped | Free | v1.4.1, production-tested since Dec 2025 |
| **Firefox extension** | Firefox MV3, manifest.firefox.json, build script | Built | Free | Manifest ready, `build.sh` handles packaging. No tabCapture (Firefox limitation) — uses screen capture |
| **Tab capture** | Record single browser tab (Chrome-only via tabCapture API) | Shipped | Free | Chrome only; Firefox falls back to screen capture |
| **Screen capture** | Record full screen or window (getDisplayMedia) | Shipped | Free | Works on Chrome + Firefox |
| **Microphone audio** | Capture microphone during recording | Shipped | Free | User grants permission via mic-permission.html |
| **System audio** | Capture tab/system audio during recording | Shipped | Free | Chrome tab capture includes system audio; screen capture depends on OS |
| **Manual screenshot markers (Ctrl+Shift+S)** | User presses hotkey during recording to mark key moments | Shipped | Free | Stored as `manual_markers_json`, merged with AI frames, deduplicated within 3s |
| **AI transcription (Whisper)** | Speech-to-text via OpenAI Whisper API (or compatible endpoint) | Shipped | Free | Word-level timestamps, multi-language support |
| **AI analysis (GPT)** | Full card generation: title, description, steps, severity, type | Shipped | Free | GPT-4o default, supports any OpenAI-compatible endpoint |
| **Automatic key frame extraction** | FFmpeg extracts screenshots at AI-determined timestamps | Shipped | Free | Merged with manual markers, max configurable (default 10) |
| **Interactive timeline** | Dashboard view with video, frames, transcript synced to timeline | Shipped | Free | Clickable frames, drag timeline, live preview |
| **Complexity scoring (5 dimensions)** | Scope, Risk, Domain, Novelty, Clarity scoring (5-15 scale) | Shipped | Free | Categories: easy/medium/hard/critical with weighted multipliers |
| **Console error capture** | JS errors, warnings, logs captured during recording | Shipped | Free | content-script-errors.js injected at document_start |
| **User action tracking** | Clicks, modal opens/closes, text selections, form submissions | Shipped | Free | content-script-actions.js, timestamped |
| **URL change tracking** | Page navigation events captured with timestamps | Shipped | Free | Stored as url_events_json |
| **Public shareable reports** | Unauthenticated access to report page by URL | Shipped | Free | `/report/:id` route, no auth required |
| **Video compression (VP9)** | FFmpeg VP9 re-encoding for smaller file sizes | Shipped | Free | Runs in parallel with transcription in pipeline |
| **Word-level transcript editing** | Edit individual words in the transcript | Shipped | Free | PUT /api/recordings/:id/transcript |
| **Context editing (remove events)** | Remove URL events, console events, action events from recording | Shipped | Free | PUT /api/recordings/:id/context |
| **Re-analysis (regenerate AI)** | Re-run GPT analysis on existing transcript | Shipped | Free | POST /api/recordings/:id/reanalyze — re-extracts frames too |
| **Card CRUD** | Edit title, description, summary, type, priority, status, assignee | Shipped | Free | PUT /api/cards/:id |
| **Comments on cards** | Add text comments to any card | Shipped | Free | POST /api/cards/:id/comment |
| **YouTrack integration** | Create issues, add comments, search, attach screenshots | Shipped | Free | Token-based auth, full implementation in youtrack.js + services/youtrack.js |
| **Generic Webhook integration** | POST card data as JSON to any URL, HMAC-SHA256 signing | Built | Free | webhook.js, supports test connection |
| **Jira Cloud integration** | OAuth 2.0 (3LO), REST API v3, ADF format, multipart attachments | Built | Team | Full implementation: create issue, search, comment, attach files, get projects/users |
| **Linear integration** | OAuth 2.0 PKCE, GraphQL API, embedded image links | Built | Team | Full implementation: create issue, search, comment, get teams/users |
| **GitHub Issues integration** | OAuth 2.0, REST API, embedded markdown images (no attachment API) | Built | Team | Full implementation: create issue, search, comment, get repos/collaborators |
| **Generic export endpoint** | POST /api/cards/:id/export with integration name | Built | Free | Uses integration registry, routes to any registered integration |
| **ClickUp integration** | REST API, OAuth 2.0 | Planned | Team | Tier 2 — months 1-3 post-launch |
| **Asana integration** | REST API, OAuth 2.0 | Planned | Team | Tier 2 — months 1-3 post-launch |
| **GitLab Issues integration** | REST API, OAuth 2.0 | Planned | Team | Tier 2 — months 1-3 post-launch |
| **Trello integration** | REST API, OAuth 1.0 (complex) | Planned | Team | Tier 2 — hard due to OAuth 1.0 |
| **Slack notifications** | Post to Slack channel on new card | Planned | Team | Tier 2 — easy to implement |
| **OAuth via tracker (auth)** | Sign in with Jira/GitHub/Linear, auto-import users | Built | Team | Integration classes implement getOAuthURL/handleOAuthCallback, not yet wired to auth flow |
| **Invite links (auth)** | Admin generates invite link, user registers with name/email/password | Built | Free | Full implementation in auth.js, invite CRUD, expiration |
| **Simple password auth** | Shared password + auto-created admin (backward compat/dev mode) | Shipped | Free | Legacy mode, DASHBOARD_PASSWORD env var |
| **Email + password auth** | User login with email + password, session management | Built | Free | POST /api/auth/login, scrypt hashing, HttpOnly cookies |
| **Extension token auth** | Long-lived Bearer token for extension, linked to user account | Built | Free | Setup page: enter server URL → paste extension token from dashboard. Token stored in chrome.storage, sent as Bearer header on all uploads. POST /api/auth/extension-token, 1-year expiry |
| **Extension token-based auth** | Extension authenticates via Bearer token instead of author dropdown. User copies token from dashboard settings. | Built | Free | Replaces old author-selection flow. User generates token in dashboard → pastes in extension setup → all recordings linked to their account |
| **License key gating** | JWT license keys, tier-based feature gating | Built | — | license.js with requireTier() and checkIntegration() middleware |
| **Docker deployment** | Dockerfile + docker-compose.yml, one-command setup | Built | Free | node:20-alpine + ffmpeg, data volume at /app/data |
| **User management (CRUD)** | Admin: list users, update roles, delete users | Built | Free | GET/PUT/DELETE /api/users, requireAdmin middleware |
| **Role-based access (admin/member/viewer)** | Three-tier role system | Built | Free | Enforced in auth.js, admin routes protected |
| **Team dashboard & analytics** | Usage stats, recording counts, storage monitoring | Shipped | Free | GET /api/status — queue, recordings count, disk usage |
| **SSO / SAML** | Enterprise single sign-on | Planned | Enterprise | Not started |
| **Branding removal** | Remove "Powered by BugReel" badge | Planned | Team | License tier check exists in code, UI badge not yet added |
| **SLA guarantee** | Uptime commitment for hosted version | Planned | Enterprise | Requires hosted offering |
| **On-premise support** | Dedicated deployment assistance | Planned | Enterprise | Human-delivered service |
| **i18n (multi-language UI)** | Dashboard and extension localization | Planned | Free | English-only for MVP, i18n framework future |
| **Bring-your-own OpenAI key** | User provides their own API key | Shipped | Free | WHISPER_URL + GPT_URL + GPT_API_KEY in .env |
| **Custom AI model (Ollama, Azure OpenAI)** | Any OpenAI-compatible endpoint | Shipped | Free | Config-driven: any URL that speaks OpenAI protocol works |
| **Concurrency queue** | Max 2 parallel pipelines to prevent CPU overload | Shipped | Free | pipeline.js queue with configurable concurrency |
| **Stuck recording retry** | Auto-retry recordings stuck in non-terminal states on server restart | Shipped | Free | retryStuckRecordings() on startup |
| **In-page recording widget** | Floating widget injected into pages for quick recording | Shipped | Free | content-script-widget.js |

---

## Pricing Tiers — Exact Features

### Community (Free)

Self-hosted, no license key required. Everything works out of the box.

- Unlimited recordings
- Full AI pipeline (Whisper transcription + GPT analysis)
- Automatic key frame extraction
- Manual screenshot markers (Ctrl+Shift+S)
- Chrome + Firefox extension
- Interactive timeline dashboard
- Complexity scoring (5 dimensions)
- Console error capture
- User action tracking
- URL change tracking
- Public shareable reports
- Video compression
- Word-level transcript editing
- Context editing (remove events)
- Re-analysis (regenerate AI report)
- Card CRUD (title, description, type, priority)
- Comments on cards
- Bring-your-own OpenAI key (or any compatible API)
- Docker one-command deployment
- **Up to 5 users** per instance
- **Integrations:** YouTrack + Generic Webhook
- **Auth:** Simple password + Invite links
- **Branding:** "Powered by BugReel" badge shown
- Community support (GitHub Issues)

### Team ($8/user/month)

For teams that need premium integrations and tracker-based authentication.

- Everything in Community, plus:
- **Up to 50 users** per instance
- **All integrations:** Jira Cloud, Linear, GitHub Issues, YouTrack, Webhook (+ ClickUp, Asana, GitLab as released)
- **OAuth via tracker** — Sign in with Jira/GitHub/Linear, auto-import team
- **Branding removable** — hide "Powered by BugReel" badge
- Priority email support
- License key via .env (`LICENSE_KEY=breel-xxxx`)
- Hosted option (app.bugreel.io) — when available

### Enterprise (Custom pricing)

For organizations with advanced security and compliance requirements.

- Everything in Team, plus:
- **Unlimited users**
- SSO / SAML authentication (coming soon)
- Custom AI model integration support
- On-premise deployment assistance
- SLA guarantee (99.9% uptime for hosted)
- Audit log (coming soon)
- Dedicated account manager
- Branding fully removed

---

## Integrations — Status

| Integration | Status | Tier | OAuth Support | File Attachments | Notes |
|---|---|---|---|---|---|
| **YouTrack** | Shipped | Free | No (token auth) | Yes (2-step, HTTP/1.1 forced) | Production-tested, full feature set |
| **Generic Webhook** | Built | Free | N/A | No (JSON payload + HMAC signing) | POST to any URL, configurable secret |
| **Jira Cloud** | Built | Team | Yes (OAuth 2.0 3LO) | Yes (multipart) | ADF document format, refresh tokens |
| **Linear** | Built | Team | Yes (OAuth 2.0 PKCE) | No (embedded markdown images) | GraphQL API, no client secret needed |
| **GitHub Issues** | Built | Team | Yes (OAuth 2.0) | No (GitHub has no attachment API) | Screenshots as embedded markdown links |
| **ClickUp** | Planned | Team | Yes (OAuth 2.0) | Yes | Tier 2, easy implementation |
| **Asana** | Planned | Team | Yes (OAuth 2.0) | Yes | Tier 2, medium difficulty |
| **GitLab Issues** | Planned | Team | Yes (OAuth 2.0) | Yes | Tier 2, medium difficulty |
| **Trello** | Planned | Team | OAuth 1.0 only | Yes (10MB/250MB limit) | Tier 2, hard — requires HMAC-SHA1 |
| **Slack** | Planned | Team | Yes (OAuth 2.0) | N/A | Notifications only, not issue creation |
| **Azure DevOps** | Not Planned | — | Deprecated | — | OAuth deprecated Apr 2025, shutdown 2026 |

---

## Browser Support

| Browser | Status | Notes |
|---|---|---|
| **Google Chrome** | Shipped | Full support: tab capture + screen capture, MV3 |
| **Microsoft Edge** | Shipped | Chromium-based, same extension works |
| **Brave** | Shipped | Chromium-based, same extension works |
| **Arc** | Shipped | Chromium-based, same extension works |
| **Opera** | Shipped | Chromium-based, same extension works |
| **Firefox** | Built | Separate manifest (manifest.firefox.json), screen capture only (no tabCapture API), not yet submitted to Add-ons store |
| **Safari** | Not Planned | Would require complete rewrite as Safari Web Extension |

---

## Claims — Approved Marketing Language

### What we CAN say (with evidence)

| Claim | Evidence |
|---|---|
| "Open source and self-hosted" | Code is in public repo, BSL license, Docker deployment works |
| "AI-powered bug reporting" | Whisper + GPT pipeline, production-tested since Dec 2025 |
| "Turns screen recordings into complete bug reports" | Pipeline: video -> audio -> transcript -> GPT -> card with title, steps, screenshots, severity |
| "Automatic key frame extraction" | FFmpeg frame extraction at AI-determined + manual timestamps |
| "Steps to reproduce, generated automatically" | GPT analysis returns structured steps, expected/actual behavior |
| "One-command Docker setup" | `docker-compose up -d` with Dockerfile and docker-compose.yml |
| "Console errors and user actions captured" | content-script-errors.js + content-script-actions.js |
| "Works with any OpenAI-compatible API" | Config-driven: WHISPER_URL, GPT_URL, GPT_API_KEY |
| "5-dimension complexity scoring" | Scope, Risk, Domain, Novelty, Clarity — implemented and functional |
| "Export to Jira, Linear, GitHub Issues, YouTrack" | Integration classes fully implemented in server/integrations/ |
| "Free tier with no limits on recordings" | Community tier has no recording limits, only user count (5) |
| "Your data stays on your server" | Self-hosted architecture, SQLite + local file storage |
| "6 npm dependencies" | package.json: express, multer, better-sqlite3, node-fetch, form-data, dotenv |
| "Word-level transcript editing" | PUT /api/recordings/:id/transcript endpoint |
| "Shareable public reports" | /report/:id route, no auth required |
| "No manual author selection — extension is linked to your account" | Extension uses Bearer token from dashboard; recordings are automatically attributed to the authenticated user |

### What we CANNOT say (yet)

| Claim | Why not |
|---|---|
| "60 seconds" for full report | Not validated with external users. Pipeline time depends on video length, API latency, and server specs. Safer to say "minutes, not hours" |
| "Thousands of developers use BugReel" | No external users yet — product is pre-launch |
| "Production-ready" | Tested internally at one org. Needs broader validation |
| "Chrome Web Store" | Extension not yet submitted to Chrome Web Store |
| "Firefox Add-ons" | Extension not yet submitted to Mozilla Add-ons |
| "Hosted cloud version" / "app.bugreel.io" | Does not exist yet. Self-hosted only |
| "SSO / SAML" | Planned, not implemented |
| "Audit log" | Planned, not implemented |
| "SLA guarantee" | Requires hosted infrastructure that doesn't exist yet |
| "ClickUp / Asana / Trello / Slack integration" | Planned, no code yet |
| "MIT license" | License not finalized. FAQ on landing says MIT but strategy doc recommends BSL. Must be decided and fixed |

---

## Messaging Guidelines

### Do say

- "Open source and self-hosted"
- "AI-powered bug reporting"
- "Turns screen recordings into detailed bug reports"
- "Steps to reproduce, screenshots, and severity — generated by AI"
- "Export to Jira, Linear, GitHub Issues, YouTrack, or any tool via webhook"
- "One-command Docker deployment"
- "Bring your own OpenAI key"
- "Works with any OpenAI-compatible API"
- "Free tier — no credit card required"
- "Your data stays on your server"
- "5-dimension complexity scoring for task estimation"
- "Chrome extension with console capture and action tracking"
- "In minutes, not hours" (for time claims)

### Don't say

- "60 seconds" — not validated, depends on many factors. Use "minutes, not hours" instead
- "Thousands of developers" — no users yet
- "Production-ready" — only internal testing so far
- "Hosted version" or "cloud version" — does not exist
- "Available on Chrome Web Store" — not submitted yet
- "Available for Firefox" — built but not submitted to Add-ons store
- "SSO" or "SAML" — not implemented
- "Enterprise-grade" — no enterprise customers yet
- "MIT license" — license not finalized (BSL is recommended in strategy)
- "Unlimited users" — Free tier is capped at 5
- "Full Jira/Linear/GitHub integration" without noting these are Team tier (paid)
- "AI-powered" without being clear it requires an OpenAI API key (or compatible)
- "No setup required" — requires Docker + OpenAI API key
- "Seamless OAuth from extension" — token is copy-paste for now (user generates in dashboard, pastes in extension setup)

---

## Known Inconsistencies to Fix

These are places where current marketing materials contradict this document:

| Location | Issue | Correct Statement |
|---|---|---|
| Landing FAQ (`en.json`) | Says "MIT license" | License not decided. Strategy recommends BSL. Must pick one |
| Landing FAQ | Says "no limits on recordings, users, or features" for Community | Community tier is limited to 5 users and 2 integrations |
| Landing FAQ | Mentions "hosted version" with "US or EU" region choice | Hosted version does not exist |
| Landing pricing (Community) | Lists "GitHub Issues export" as free feature | GitHub Issues integration is Team tier (gated by license) |
| Landing pricing (Team) | Lists "Team dashboard & analytics" and "Complexity scoring" as Team features | Both are actually Free tier features (no license gating) |
| README | Says "in 60 seconds" | Not validated — use "in minutes, not hours" |
| README | Lists YouTrack as "Ready" and all others as "Planned" | Jira, Linear, GitHub, Webhook are all Built (code exists) |
| Landing hero subheadline | Good: already says "in minutes, not hours" | Consistent with this document |

---

## Store Listings

### Chrome Web Store

- **Name:** BugReel — AI Bug Reporter
- **Summary (132 chars max):** Record a bug, get a full report. AI generates steps, screenshots, and severity from your screen recording. Open source.
- **Category:** Developer Tools
- **Description:**

```
BugReel turns screen recordings into complete bug reports — automatically.

HOW IT WORKS:
1. Click Record and reproduce the bug
2. AI transcribes your narration and analyzes the recording
3. Get a structured card: title, steps to reproduce, screenshots, severity
4. Export to Jira, Linear, GitHub Issues, YouTrack, or any tool via webhook

FEATURES:
- AI-powered analysis — transcription, step extraction, severity assessment
- Automatic key frame screenshots at the right moments
- Console error and user action capture, synced to video timeline
- Manual screenshot markers (Ctrl+Shift+S) during recording
- 5-dimension complexity scoring for sprint planning
- Shareable public report links
- Word-level transcript editing

SELF-HOSTED:
Your recordings and data stay on your server. BugReel runs via Docker with SQLite — no external database needed. Bring your own OpenAI API key.

OPEN SOURCE:
BugReel is open source. Inspect the code, contribute, or customize for your team.

FREE TIER:
Unlimited recordings, AI analysis, and screenshots. Up to 5 users with YouTrack and webhook integrations included.

Requires a self-hosted BugReel server. See https://github.com/bugreel/bugreel for setup instructions.
```

### Firefox Add-ons

- **Name:** BugReel — AI Bug Reporter
- **Summary:** Record bugs, get AI-generated reports with steps, screenshots, and severity. Open source and self-hosted.
- **Note:** Same description as Chrome Web Store, adjusted for Firefox (remove tab capture mentions, note screen capture only)

### GitHub README

Located at `/Users/mac/MyDev/3-READY/bugreel/README.md` — must be updated to match this document. Key changes needed:
- Remove "60 seconds" claim (use "minutes, not hours")
- Update integration status table to reflect Built status for Jira, Linear, GitHub, Webhook
- Add note that OpenAI API key is required
- Clarify license (currently "TBD")

---

## Technical Constraints (for marketing accuracy)

These constraints affect what we can honestly claim:

1. **OpenAI API key required** — BugReel does not include AI. Users must provide their own API key (or compatible endpoint). This is a privacy advantage but also a setup step.
2. **Self-hosted only** — No hosted/cloud version exists. Users must run Docker.
3. **FFmpeg required** — Included in Docker image, but bare-metal installs need FFmpeg.
4. **Single-instance architecture** — One BugReel instance = one team. No multi-tenant SaaS.
5. **No real-time collaboration** — Dashboard is single-user UI, no concurrent editing.
6. **No mobile support** — Browser extension only, desktop browsers.
7. **Video stays on server** — No CDN, no streaming optimization. File served directly.
8. **SQLite** — Simple and fast, but not designed for massive scale (fine for teams up to 50).

---

## Deployment

| Component | URL | Platform | Status |
|---|---|---|---|
| **Landing page** | [bugreel.io](https://bugreel.io) | Vercel (Astro 6 static) | Live |
| **GitHub repo** | [github.com/BugReel/bugreel](https://github.com/BugReel/bugreel) | GitHub (public, BugReel org) | Live |
| **Chrome Web Store** | — | Not submitted yet | Pending |
| **Firefox Add-ons** | — | Not submitted yet | Pending |
| **Hosted SaaS (app.bugreel.io)** | — | Does not exist yet | Not started |

**Domain:** bugreel.io (Reg.ru). DNS: A @ -> 76.76.21.21, CNAME www -> cname.vercel-dns.com. www.bugreel.io redirects to bugreel.io. SSL working.

**Vercel project:** auto-deploys from GitHub on push to main.

---

## Revision History

- 2026-03-17: Added Deployment section with live URLs. Landing deployed to Vercel, GitHub repo public.
- 2026-03-17: Initial version. Comprehensive audit of codebase, landing page, README, and strategy document. Identified 8 inconsistencies to fix.
