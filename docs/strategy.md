# BugReel — Commercial Product Strategy

> Date: 2026-03-17
> Status: Deployed
> Origin: internal-tool (internal tool, production since Dec 2025)
> Domain: bugreel.io (live)

---

## 1. Product Concept

### What is BugReel

AI-powered bug reporting tool for development teams: record a bug on video → get a complete bug card with description, steps to reproduce, screenshots, and priority. 60 seconds instead of 15 minutes.

### Problem

Bug reports are painful for every team:
- **QA engineers** spend 10-20 min per bug report: screenshots, steps, expected/actual
- **Developers** get "button doesn't work" with zero context, waste time reproducing
- **PMs** lose track — bugs get lost in chats, descriptions are incomplete
- **Support teams** can't properly hand off customer issues to dev

### Solution

1. Install browser extension (Chrome/Firefox)
2. Click Record → show the bug → stop
3. AI automatically: transcribes speech → analyzes context → creates a card with title, description, steps, screenshots, priority
4. One click → export to tracker (Jira, Linear, GitHub Issues, YouTrack)

### Competitive Advantage

| Feature | Loom/Jam.dev | Marker.io | Bird Eats Bug | **BugReel** |
|---|---|---|---|---|
| Screen recording | Yes | Yes | Yes | Yes |
| Auto transcription | Yes (Loom) | No | No | Yes |
| AI analysis → complete card | No | No | Partial | **Full card** |
| Auto screenshots from video | No | No | No | **Yes** |
| Complexity Scoring | No | No | No | **Yes (5 dimensions)** |
| Console errors capture | No | Yes | Yes | Yes |
| User actions tracking | No | Yes | No | Yes |
| Self-hosted option | No | No | No | **Yes** |
| **Starting price** | $12.50/user/mo | $39/mo | $25/mo | **$0 (free tier)** |

**Key differentiator:** BugReel is the only tool that generates a **complete, ready-to-work bug card** from a 60-second video — with AI description, reproduction steps, key frames, and complexity score. Others are just screen recording + annotations.

### Target Audience

| Segment | Pain | BugReel Value |
|---|---|---|
| **QA engineers** | 10-20 min per bug report | 60 sec + AI does the rest |
| **Dev teams** (5-50 people) | Bugs get lost, descriptions incomplete | Single stream, fully automated |
| **Freelancers/agencies** | Clients can't explain bugs | Client records → AI describes |
| **Support teams** | Handing off bugs from ticket to dev | Record → card → tracker automatically |
| **Open source projects** | Unstructured issues | Template + AI = quality reports |

---

## 2. Codebase & Fork Strategy

### Single codebase, NOT a fork

The original internal-tool continues to work as a **BugReel instance** with a private config file. One codebase, two products. Fixes and features benefit both.

### Repository Structure

```
bugreel/
├── server/
│   ├── core/                  # Pipeline: ffmpeg, whisper, gpt
│   ├── integrations/          # Plugin system: jira, linear, github, youtrack, webhook
│   ├── auth/                  # OAuth (via tracker) + invite links + simple
│   ├── routes/                # API endpoints
│   ├── services/              # Business logic
│   ├── prompts/               # AI prompt templates
│   └── config.js              # Unified .env config
├── dashboard/                 # Dark theme, responsive
├── extension/                 # Chrome MV3 + Firefox
├── landing/                   # Marketing site (static)
├── docs/                      # Documentation
├── deploy/
│   └── presets/
│       └── custom.env         # Internal-specific config (private, not in repo)
├── Dockerfile
├── docker-compose.yml
└── package.json
```

---

## 3. Core Changes Required

### 3.1 Remove Hardcoded References (CRITICAL)

18 files need sanitization. Full list:

| What | Where | Action |
|---|---|---|
| `tasktracker.example.com` | popup.js, review.js, background.js | → `config.serverUrl` |
| `internal-tool-widget` | content-script-widget.js | → `bugreel-widget` |
| `internal-tool-blobs` | idb-helper.js | → `bugreel-blobs` |
| `internal-tool-salt` | auth.js | → env variable |
| `BUG` project default | db.js, config.js | → `config.defaultProject` |
| 10 hardcoded team names | db.js seed | → remove, API for user management |
| `internal-tool@example.com` | manifest.firefox.json | → `bugreel@bugreel.io` |
| `lk.example.com` detection | content-script-actions.js | → remove |
| `api.openai.com` / `api.openai.com` | .env.example, config.js | → `api.openai.com` defaults |
| Russian UI text | All dashboard HTML files | → English |
| Russian GPT prompt (116 lines) | prompts/analyze-transcript.txt | → English |
| Russian extension strings | popup.js, setup.html, review.js | → English |
| Russian guide page | guide.html (`<html lang="ru">`) | → English |
| Internal IP addresses | README.md | → generic self-hosting guide |
| `extension-chrome-only/` | Old folder with hardcoded names | → remove entirely |

### 3.2 Authentication: OAuth via Tracker (HIGH)

No custom user management system. Users already exist in Jira/GitHub/Linear — use their OAuth.

**3 auth modes:**

| Mode | When | User Management |
|---|---|---|
| **OAuth via tracker** | Jira/GitHub/Linear connected | Automatic — imported from tracker |
| **Invite links** | Self-hosted without tracker | Admin sends link, user creates account |
| **Simple** | Dev/demo/backward compat | Shared password + pick from list |

**Flow:**
```
Team lead:
  Setup → "Connect Jira" → OAuth → BugReel imports projects + team

Team member:
  1. Installs extension from Chrome Web Store (or Load unpacked)
  2. Opens extension popup → clicks "Setup"
  3. Enters server URL → tests connection
  4. Opens BugReel dashboard → logs in (password/invite/OAuth)
  5. Dashboard: Settings → "Generate Extension Token" → copies token
  6. Pastes token in extension setup → "Connect"
  7. Extension shows "Signed in as [Name]" → ready to record
  8. All recordings automatically linked to their account via Bearer token
```

> **Future improvement:** automate token exchange via redirect flow (extension opens login page, dashboard passes token back via chrome.storage or custom protocol). For MVP, copy-paste is sufficient.

**One instance = one primary tracker.** Multiple trackers = enterprise tier.

**New DB tables:**
```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  avatar_url TEXT,
  auth_provider TEXT NOT NULL,    -- 'jira', 'github', 'linear', 'invite', 'simple'
  provider_user_id TEXT,
  provider_access_token TEXT,     -- encrypted
  role TEXT DEFAULT 'member',     -- 'admin', 'member', 'viewer'
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,              -- 'dashboard', 'extension'
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
```

### 3.3 Integration Plugin System (HIGH)

```javascript
export class TrackerIntegration {
  name = 'base'
  supportsOAuth = false
  supportsAttachments = false

  // OAuth (for user auth)
  getOAuthURL(state) { }
  handleOAuthCallback(code) { }
  refreshToken(refreshToken) { }

  // Issue management
  async createIssue(card, frames, user) { }
  async searchIssues(query, user) { }
  async addComment(issueId, text, user) { }

  // Attachments
  async attachScreenshots(issueId, frames, user) { }
  // fallback: embed as markdown ![](url)

  // Team
  async getProjects(user) { }
  async getUsers(user) { }

  // Config UI
  getSetupSchema() { }
}
```

### 3.4 AI Provider Abstraction (MEDIUM)

Support any OpenAI-compatible endpoint:
- OpenAI API directly
- Azure OpenAI
- Self-hosted (faster-whisper, ollama)
- Any proxy endpoint

Default in `.env.example`: standard `api.openai.com`.

### 3.5 Docker (HIGH)

```dockerfile
FROM node:20-alpine
RUN apk add --no-cache ffmpeg
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
EXPOSE 3500
VOLUME /app/data
CMD ["node", "server/index.js"]
```

```yaml
services:
  bugreel:
    image: bugreel/bugreel:latest
    ports: ["3500:3500"]
    volumes: ["./data:/app/data"]
    env_file: .env
```

### 3.6 Internationalization (MEDIUM)

- Dashboard: English only for MVP
- GPT prompt: English (handles multi-language transcriptions)
- Extension: English only for MVP
- Future: i18n framework for community translations

---

## 4. Integrations — Priority Map

### 4.1 Full Tracker Analysis (13 trackers researched)

| Tracker | OAuth | Issue Creation | Attachments | User Listing | Difficulty | Market Share |
|---|---|---|---|---|---|---|
| **Jira Cloud** | 2.0 (3LO) | REST | multipart | Yes | Medium | ~15% enterprise |
| **Linear** | 2.0 + PKCE | GraphQL | Yes | Yes | **Easy** | ~10% startups |
| **ClickUp** | 2.0 | REST | Yes | Yes | **Easy** | ~8% |
| **Asana** | 2.0 | REST | Yes | Yes | Medium | ~18% enterprise |
| **Monday.com** | 2.0 | GraphQL | Yes | Yes | Medium | ~10% |
| **GitHub Issues** | 2.0 | REST | **NO API** | Yes | Medium | ~20% dev |
| **GitLab Issues** | 2.0 | REST | Yes | Yes | Medium | ~5% |
| **Notion** | 2.0 | REST | URL only | Yes | Medium | ~6% |
| **YouTrack** | 2.0 (Hub) | REST | 2-step | Yes | Medium | ~3% |
| **Trello** | **1.0 only** | REST | 10/250MB | Yes | **Hard** | ~13% (50M users) |
| **Basecamp** | 2.0 | REST | Yes | Yes | Easy | ~1% |
| **Shortcut** | Token only | REST | Yes | Yes | Easy | ~1% |
| **Azure DevOps** | **Deprecated** | REST | Yes | Yes | — | ~9% |

### 4.2 Key Findings

**Trello: OAuth 1.0 only.** The only major tracker without OAuth 2.0. HMAC-SHA1 signatures, 3-step flow — 3x harder to implement. 50M users can't be ignored, but not for MVP. Workaround: API key auth (user pastes token manually). Full OAuth 1.0 later.

**GitHub Issues: no attachment API.** Screenshots can only be attached via browser drag-and-drop, NOT via API. Workaround: embed as markdown image links `![frame](https://server/api/recordings/REC-XXX/frames/001.jpg)`.

**Linear, ClickUp: easiest integrations.** Modern APIs, clean docs, fast implementation. Linear: PKCE (no client secret needed), GraphQL, refresh tokens.

**Azure DevOps: do NOT build.** OAuth deprecated April 2025, full shutdown 2026.

### 4.3 Integration Tiers

**Tier 1 — MVP launch (~55% market coverage):**

| # | Integration | Why | Difficulty |
|---|---|---|---|
| 1 | **Jira Cloud** | Enterprise standard, must-have | Medium |
| 2 | **Linear** | Easiest API, startups, growing fast | Easy |
| 3 | **GitHub Issues** | Dev audience (attachment workaround) | Medium |
| 4 | **Generic Webhook** | Covers everyone else | Minimal |
| 5 | **YouTrack** | Already built, needs refactor | Ready |

**Tier 2 — months 1-3 post-launch (~+30%):**

| # | Integration | Difficulty |
|---|---|---|
| 6 | ClickUp | Easy |
| 7 | Asana | Medium |
| 8 | GitLab Issues | Medium |
| 9 | Trello (OAuth 1.0) | Hard |
| 10 | Slack (notifications) | Easy |

**Tier 3 — on demand:**
Monday.com, Notion, Basecamp, Shortcut.

**Never:** Azure DevOps (deprecated).

---

## 5. MVP Checklist

### What's needed for public launch

**Core (2-3 weeks):**
- [x] New repository initialized
- [x] All Internal hardcodes removed (18 files, list in §3.1)
- [x] Config-driven architecture (.env for everything)
- [x] Dockerfile + docker-compose (one-command setup)
- [x] Auth: OAuth via Jira + GitHub + invite links (§3.2)
- [x] Extension token (link extension to user account)
- [x] English UI (dashboard + extension + GPT prompt)

**Integrations (1-2 weeks):**
- [x] Jira Cloud (OAuth 2.0 + create issue + multipart attachments)
- [x] Linear (OAuth 2.0 PKCE + GraphQL + attachments)
- [x] GitHub Issues (OAuth 2.0 + create issue + embedded image links)
- [x] Generic Webhook (POST JSON)
- [x] YouTrack (refactor to plugin interface)

**Extension (1 week):**
- [x] Rebrand: BugReel
- [x] Configurable server URL (already works)
- [ ] Chrome Web Store submission
- [ ] Firefox Add-ons submission

**Landing + Marketing (1-2 weeks):**
- [x] Landing page (hero + features + pricing + docs)
- [x] GitHub repo (open core)
- [ ] Product Hunt launch page
- [ ] 3-5 SEO articles

**Documentation:**
- [ ] README with GIF demo
- [ ] Quick Start (< 5 min to first bug)
- [ ] Self-hosting guide
- [ ] API documentation

### What's NOT needed for MVP

- Multi-tenant SaaS (one instance = one team is fine)
- OAuth/SSO beyond tracker auth
- Billing/subscriptions (manual or Stripe later)
- Mobile app
- Video hosting (self-hosted storage is a privacy advantage)
- Real-time collaboration
- AI chat with recordings

---

## 6. Business Model & Monetization

### 6.1 Pricing Tiers

| Tier | Price | Users | Integrations | Auth | Branding |
|---|---|---|---|---|---|
| **Community** (Free) | $0 | Up to 5 | Webhook + YouTrack | Simple + Invite links | BugReel badge |
| **Team** | $8/user/mo | Up to 50 | All (Jira, Linear, GitHub, etc.) | OAuth via tracker | Removable |
| **Enterprise** | Custom | Unlimited | All + custom | SSO/SAML | Removed |

### 6.2 Architecture: Single Codebase + License Key

**One repo, one codebase.** Paid features are in the open-source code but gated by a license key. No fork, no separate enterprise repo.

```
bugreel/                              ← ONE open-source repo
├── server/
│   ├── core/                         ← FREE: pipeline, ffmpeg, whisper, gpt
│   ├── license.js                    ← FREE: license key validation (visible in OSS)
│   ├── integrations/
│   │   ├── webhook.js                ← FREE
│   │   ├── youtrack.js               ← FREE
│   │   ├── jira.js                   ← GATED: requires license.tier >= 'team'
│   │   ├── linear.js                 ← GATED: requires license.tier >= 'team'
│   │   └── github-issues.js          ← GATED: requires license.tier >= 'team'
│   └── auth/
│       ├── simple.js                 ← FREE
│       ├── invite.js                 ← FREE
│       └── oauth.js                  ← GATED: requires license.tier >= 'team'
│
bugreel-cloud/                        ← PRIVATE repo (NOT open source)
├── billing.js                        ← Stripe subscriptions
├── license-server.js                 ← JWT key generation & validation
├── accounts.js                       ← Multi-tenant instance management
├── provisioning.js                   ← Auto-deploy instance on payment
└── admin-dashboard/                  ← Customer management, revenue, usage
```

### 6.3 How License Gating Works

```javascript
// server/license.js — IN open source, code is visible to everyone
import { config } from './config.js'

const TIERS = {
  community: { maxUsers: 5, integrations: ['webhook', 'youtrack'], oauth: false },
  team:      { maxUsers: 50, integrations: 'all', oauth: true },
  enterprise:{ maxUsers: Infinity, integrations: 'all', oauth: true }
}

export function getLicense() {
  const key = config.licenseKey  // from .env: LICENSE_KEY=breel-xxxx-xxxx
  if (!key) return { tier: 'community', ...TIERS.community }

  try {
    // JWT signed with our private key, verified with public key
    const decoded = verifyJWT(key, PUBLIC_KEY)
    return { tier: decoded.tier, ...TIERS[decoded.tier] }
  } catch {
    return { tier: 'community', ...TIERS.community }
  }
}

export function requireTier(minTier) {
  return (req, res, next) => {
    const license = getLicense()
    if (tierLevel(license.tier) < tierLevel(minTier)) {
      return res.status(403).json({
        error: 'upgrade_required',
        message: `This feature requires the ${minTier} plan.`,
        upgrade_url: 'https://bugreel.io/pricing'
      })
    }
    next()
  }
}
```

```javascript
// Example: server/integrations/jira.js
import { requireTier } from '../license.js'

// In route registration:
router.post('/api/cards/:id/export-jira', requireTier('team'), async (req, res) => {
  // ... Jira export logic
})
```

### 6.4 "But the code is open — they'll remove the check!"

Yes, technically possible. Why it doesn't matter:

1. **Who removes it** — a developer who could write their own Jira integration anyway. Not a paying customer.
2. **Who pays** — a team of 20 who wants support, updates, and doesn't want to maintain a fork. $160/mo is nothing vs. one engineer's hourly rate.
3. **License prohibits it** — AGPL/BSL explicitly forbids commercial use without a license. You're legally protected.
4. **Everyone does this** — GitLab, Sentry, Metabase, Cal.com, Supabase. Code is visible, business works.

### 6.5 Customer Journey

```
Step 1: Discovery
  Developer finds BugReel via GitHub / SEO article / Product Hunt
  → docker-compose up → working in 5 minutes
  → 5 users, Webhook integration, simple auth
  → FREE

Step 2: Team adoption
  QA team loves it, wants Jira integration
  → Clicks "Export to Jira" → sees "Requires Team plan"
  → Goes to bugreel.io/pricing → $8/user/mo

Step 3: Purchase
  → Stripe payment → receives LICENSE_KEY by email
  → Pastes into .env → restarts → all integrations unlocked, OAuth works
  → OR: chooses "Hosted" plan → gets app.bugreel.io/their-team → zero setup

Step 4: Growth
  → More team members → license auto-scales (per-user billing)
  → Needs SSO → upgrades to Enterprise → custom deal
```

### 6.6 Billing Implementation Phases

| Phase | When | How billing works |
|---|---|---|
| **MVP launch** | Week 6-8 | No billing. `license.js` exists but only checks for key. Free tier only. |
| **First customers** | Month 2-3 | Manual: Stripe Payment Link → email license key. 5-10 customers. |
| **Self-serve** | Month 4-6 | `bugreel-cloud`: Stripe checkout → auto-generate key → email. |
| **Full SaaS** | Month 6-12 | Hosted plan: auto-provisioned instances. Stripe subscriptions with webhooks. |

### 6.7 What's Free vs Paid (detailed)

| Feature | Community (Free) | Team ($8/user/mo) | Enterprise |
|---|---|---|---|
| Screen recording + AI analysis | Yes | Yes | Yes |
| Dashboard | Yes | Yes | Yes |
| Extension (Chrome + Firefox) | Yes | Yes | Yes |
| Max users per instance | 5 | 50 | Unlimited |
| Integrations | Webhook + YouTrack | All (Jira, Linear, GitHub, ClickUp, etc.) | All + custom |
| Auth mode | Simple + Invite links | OAuth via tracker | SSO/SAML |
| Complexity scoring | Yes | Yes | Yes |
| Public reports | Yes | Yes | Yes |
| "Powered by BugReel" badge | Shown | Removable | Removed |
| API access | Yes | Yes | Yes |
| Priority support | — | Email | Dedicated Slack |
| SLA | — | — | 99.9% uptime |
| Audit log | — | — | Yes |
| Hosted option | — | Yes (app.bugreel.io) | Yes (dedicated) |

### 6.8 License

**Recommended: BSL (Business Source License)**

- Allows: self-hosting, modification, internal use — everything a single company needs
- Prohibits: offering BugReel as a competing managed service/SaaS
- After 3 years: converts to Apache 2.0 (fully open)
- Used by: Sentry, CockroachDB, HashiCorp, MariaDB

BSL is better than AGPL for this product because:
- AGPL: allows competitors to build a SaaS if they open their code (some will)
- BSL: explicitly prohibits competing SaaS, period. Cleaner protection.

### 6.9 Unit Economics (projection)

| Metric | Value |
|---|---|
| CAC (SEO-led) | ~$30-50 |
| ARPU (Team tier, avg 10 users) | $80/mo |
| Gross margin | ~85% (server costs minimal: FFmpeg + SQLite + AI API pass-through) |
| Breakeven | ~30 paying teams |
| Target MRR (6 months) | $2,000-5,000 |
| Target MRR (12 months) | $10,000-20,000 |

### 6.10 bugreel-cloud (Private Repo) — Build Later

Tiny service, NOT a copy of the main product. Just the billing/licensing wrapper:

```
bugreel-cloud/
├── api/
│   ├── billing.js              # Stripe: create subscription, handle webhooks
│   ├── license-server.js       # Generate JWT license keys, validate, revoke
│   ├── accounts.js             # CRUD customer accounts
│   └── provisioning.js         # Auto-deploy Docker instance on new subscription
├── dashboard/                  # Admin: customers, revenue, usage metrics
├── emails/                     # Transactional: welcome, license key, invoice
└── landing/                    # bugreel.io marketing site
```

**Not needed until Month 4-6.** Before that, manual Stripe Payment Links + email works fine.

---

## 7. Landing Page & SEO Strategy

### Site Structure

```
bugreel.io
├── /               Hero + Demo GIF + CTA
├── /features       Detailed feature descriptions
├── /pricing        Free/Team/Enterprise
├── /docs           Documentation (VitePress)
├── /blog           SEO articles
├── /changelog      Public changelog
└── /download       Extension + Self-hosting
```

### Hero Section

**Headline:** "Record a bug. Get a complete report. Automatically."
**Subheadline:** "BugReel uses AI to turn screen recordings into detailed bug reports with steps, screenshots, and priority — in 60 seconds."
**CTA:** "Install Free Extension" | "Watch Demo"

### SEO Clusters

| Cluster | Example Articles | Volume |
|---|---|---|
| Bug reporting tools | "Best bug reporting tools 2026" | High |
| Screen recording for QA | "How to record bugs effectively" | Medium |
| Jira/GitHub integrations | "Best Jira integrations for QA" | Medium |
| AI in QA | "AI-powered bug reporting" | Growing |
| Alternative to X | "Jam.dev alternative open-source" | Medium |

### First 5 Articles (before launch)

1. "The Complete Guide to Writing Better Bug Reports (2026)" — pillar content, 3000+ words
2. "5 Best AI-Powered Bug Reporting Tools Compared" — include BugReel
3. "How to Set Up Automated Bug Reporting with AI" — BugReel tutorial
4. "Open-Source Bug Tracking: Self-Hosted Alternatives to Jira" — include BugReel
5. "From Screen Recording to Bug Report in 60 Seconds" — case study

### Distribution Channels

| Channel | Action | When |
|---|---|---|
| Product Hunt | Launch with demo video | Launch day |
| Hacker News | "Show HN: BugReel — AI turns screen recordings into bug reports" | Launch day |
| Reddit | r/webdev, r/QualityAssurance, r/selfhosted | Week 1 |
| Dev.to / Hashnode | Technical articles | Weeks 1-4 |
| GitHub | Open-source core, README with GIF | From repo creation |
| Twitter/X | Dev community, QA community | Ongoing |
| YouTube | 2-3 min demo video | Before launch |

---

## 8. Competitive Landscape

| Product | Model | Price | Strengths | Weaknesses |
|---|---|---|---|---|
| **Jam.dev** | SaaS | $12/user/mo | Fast recording, console capture | No AI analysis, no self-hosted |
| **Marker.io** | SaaS | $39/mo (3 users) | Website widget, annotations | Expensive, no AI, no self-hosted |
| **Bird Eats Bug** | SaaS | $25/mo | Console + network capture | Basic AI, no self-hosted |
| **Loom** | SaaS | $12.50/user/mo | Video communication, transcription | Not for bugs, no cards |
| **BugHerd** | SaaS | $39/mo | Visual feedback on page | Visual feedback only |
| **BugReel** | Open Core | **Free / $8/user/mo** | AI cards, self-hosted, open-source | New, no brand recognition |

**Positioning:** "The open-source, AI-powered alternative to Jam.dev"

---

## 9. Naming & Branding

**Chosen name: BugReel**

| Criteria | Status |
|---|---|
| Meaning | bug + reel (video clip) — exactly what the product does |
| Associations | Instagram Reels, highlight reel — modern, clear |
| Conflicts | None (verified: no TM, no GitHub, no npm, no competing products) |
| Domain | bugreel.io — purchased and live (Reg.ru) |
| Pronunciation | Unambiguous in any language |
| Length | 7 characters |

**GitHub organization:** `BugReel` (owner: owner) — [github.com/BugReel](https://github.com/BugReel)

---

## 10. Roadmap

### Phase 0: Setup (week 1-2)
- [x] Buy domain bugreel.io (+ bugreel.com if available)
- [x] Create GitHub organization + public repo
- [x] Copy internal-tool codebase
- [x] Basic rebranding (package.json, README)
- [x] Initialize project structure

### Phase 1: Core Abstraction (week 2-4)
- [x] Remove all Internal hardcodes (18 files)
- [x] Config-driven architecture (.env)
- [x] Dockerfile + docker-compose
- [x] English UI (dashboard + extension + prompt)
- [x] Auth: OAuth via Jira + GitHub + invite links
- [x] User management (DB tables + API)
- [x] Integration plugin interface
- [ ] **Switch Internal Tool to run as BugReel instance + custom.env**

### Phase 2: Integrations + Landing (week 4-6)
- [x] Jira Cloud integration
- [x] Linear integration
- [x] GitHub Issues integration
- [x] Generic Webhook
- [x] Landing page (hero + features + pricing + docs)
- [ ] Chrome Web Store submission
- [ ] 2-3 SEO articles

### Phase 3: Public Launch (week 6-8)
- [ ] GitHub repo → public
- [ ] Product Hunt launch
- [ ] Hacker News post
- [ ] Reddit/Dev.to posts
- [ ] Demo video (YouTube)
- [ ] 2-3 more SEO articles

### Phase 4: Growth (month 3-6)
- [ ] ClickUp, Asana, GitLab integrations
- [ ] Trello (OAuth 1.0)
- [ ] Slack notifications
- [ ] Stripe billing
- [ ] Hosted SaaS tier (app.bugreel.io)

### Phase 5: Scale (month 6-12)
- [ ] Enterprise features (SSO, audit log)
- [ ] Public API v2
- [ ] Community contributions
- [ ] Integration marketplace
- [ ] Localization (de, fr, es, ja)

---

## 11. Risks & Mitigation

| Risk | Probability | Mitigation |
|---|---|---|
| Competitors add AI analysis | High | Move fast, self-hosted = moat |
| Whisper/GPT costs at scale | Medium | Self-hosted Whisper (faster-whisper), prompt optimization |
| Chrome Web Store rejection | Low | Follow policies, minimal permissions |
| Low adoption | Medium | Free tier, open-source, SEO content |
| Security concerns (video PII) | Medium | Self-hosted by default, encryption at rest |

---

## 12. Current Codebase Metrics

| Metric | Value | Readiness |
|---|---|---|
| Lines of code | ~10,000 JS | Compact core, easy to refactor |
| Dependencies | 6 npm packages | Minimal, no bloat |
| DB tables | 5 (SQLite) | Simple schema, easy to extend |
| API endpoints | 25+ | Full CRUD coverage |
| External APIs | 3 (Whisper, GPT, YouTrack) | Abstraction needed |
| Internal hardcodes | ~18 places | Documented, mechanical replacement |
| Tests | 0 | Needed before public release |

---

## 13. Infrastructure

| Component | Current (Internal) | BugReel | URL | Cost |
|---|---|---|---|---|
| **Landing** | — | Vercel (Astro 6 static) | [bugreel.io](https://bugreel.io) | $0 |
| **Docs** | — | Vercel (VitePress) | TBD | $0 |
| **Demo SaaS** | — | Hetzner EU (VPS) | TBD | ~$5/mo |
| **GitHub** | — | Public repo | [github.com/BugReel/bugreel](https://github.com/BugReel/bugreel) | $0 |
| **Chrome Web Store** | — | developer.chrome.com | Not submitted yet | $5 one-time |
| **Domain** | — | bugreel.io (Reg.ru, DNS: A → 76.76.21.21, CNAME www → cname.vercel-dns.com) | [bugreel.io](https://bugreel.io) | ~$30/yr |
| **Email** | — | hello@bugreel.io (Cloudflare) | — | $0 |

**Vercel project:** "landing" under scope "your-vercel-scope". www.bugreel.io redirects to bugreel.io.

**GitHub org:** BugReel (owner: owner). Public repo, 107 files, 27K+ lines.

**Total launch cost: ~$40 + $5/mo.**

---

## 14. Sanitization Checklist (Russian → International)

### Principle

Not "hiding Russia" — building a proper international product. Zero country/team-specific references in public repo. All internal config stays in private `.env` (not committed).

### What stays private (NOT in repo)

- api.openai.com/api.openai.com endpoints → private `.env`
- Server IPs, SSH access → private `.env`
- Team member names → not seeded
- custom.env config → private preset

### Public `.env.example`

```env
# Server
PORT=3500
HOST=0.0.0.0
DATA_DIR=./data

# AI (any OpenAI-compatible endpoint)
WHISPER_URL=https://api.openai.com/v1/audio/transcriptions
GPT_URL=https://api.openai.com/v1/chat/completions
GPT_API_KEY=sk-your-openai-key
GPT_MODEL=gpt-4o-mini

# Tracker (configured via dashboard setup wizard)
TRACKER_TYPE=none
TRACKER_URL=
TRACKER_TOKEN=
TRACKER_PROJECT=

# Auth
AUTH_SALT=change-this-to-random-string
DASHBOARD_PASSWORD=

# Limits
MAX_VIDEO_SIZE=104857600
MAX_VIDEO_DURATION=300
MAX_SCREENSHOTS=10
```

### GitHub Organization

New GitHub account (organization `bugreel` or `getbugreel`). Not linked to personal accounts — looks professional and allows adding contributors.
