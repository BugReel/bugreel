# BugReel

**Record a bug. Get a complete report. Automatically.**

**Website:** [bugreel.io](https://bugreel.io) | **GitHub:** [github.com/BugReel/bugreel](https://github.com/BugReel/bugreel)

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
- **Webcam PiP** — picture-in-picture webcam overlay during screen recording
- **Complexity scoring** — 5-dimension system (scope, risk, domain, novelty, clarity)
- **Console & action capture** — JS errors, user clicks, URL changes synced to timeline
- **Interactive timeline** — video player with transcript, frames, and click-to-screenshot
- **Public reports** — shareable links with no auth required
- **Password protection** — optionally lock individual recordings with a password
- **Embeddable player** — embed recordings on any page via `<iframe>` with custom controls
- **Video comments** — timestamped comments on recordings for async feedback
- **View analytics** — track who watched your recordings and for how long
- **Bring your own AI** — works with any OpenAI-compatible API (OpenAI, Azure, Ollama)

## Quick start

```bash
git clone https://github.com/BugReel/bugreel.git
cd bugreel
cp .env.example .env
# Edit .env — add your OpenAI API key (GPT_API_KEY)
docker-compose up -d
```

Open `http://localhost:3500` — done.

**Requirements:** Docker with FFmpeg (included in image), OpenAI API key (or compatible endpoint).

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `DASHBOARD_PASSWORD` | **Yes (production)** | *(empty)* | Password for dashboard login. **Must be set in production** — without it, the dashboard is open to anyone. |
| `PORT` | No | `3500` | HTTP port for the server |
| `HOST` | No | `0.0.0.0` | Bind address |
| `DATA_DIR` | No | `./data` | Directory for recordings, frames, and SQLite database |
| `DASHBOARD_URL` | No | *(auto-detected)* | Public URL of your instance (used for share links, invite links, embed URLs) |
| `GPT_API_KEY` | No | *(empty)* | OpenAI API key (or compatible). Required for AI transcription and analysis |
| `WHISPER_URL` | No | `https://api.openai.com/v1/audio/transcriptions` | Whisper-compatible transcription endpoint |
| `GPT_URL` | No | `https://api.openai.com/v1/chat/completions` | GPT-compatible chat endpoint |
| `GPT_MODEL` | No | `gpt-4o` | Model name for AI analysis |
| `MAX_VIDEO_SIZE` | No | `104857600` (100 MB) | Maximum upload size in bytes |
| `MAX_VIDEO_DURATION` | No | `300` (5 min) | Maximum recording duration in seconds |
| `MAX_SCREENSHOTS` | No | `10` | Maximum key frames to extract |
| `AUTH_SALT` | No | *(built-in)* | Salt for legacy password hashing |
| `LICENSE_KEY` | No | *(empty)* | License key for Team/Enterprise tiers (Community tier works without it) |

## Behind a Reverse Proxy

When BugReel runs behind a reverse proxy (nginx, Traefik, Caddy, etc.), the proxy can handle authentication and pass user identity to BugReel via trusted HTTP headers. BugReel's `authGuard` middleware checks these headers before any other auth method:

| Header | Purpose | Example |
|---|---|---|
| `X-User-Id` | Unique user identifier | `user-42` or a UUID |
| `X-User-Email` | User's email address | `alice@example.com` |
| `X-User-Name` | Display name | `Alice` |

When `X-User-Id` is present, BugReel trusts it unconditionally — the proxy is responsible for authentication. If the user doesn't exist in BugReel's database, it is auto-created with `role: admin` and `auth_provider: proxy`.

**Important:** Strip these headers from external requests in your proxy config. If you don't, any client can impersonate any user by sending fake headers.

### Nginx example

```nginx
server {
    listen 443 ssl;
    server_name bugreel.example.com;

    # Your auth layer (OAuth2 Proxy, Authelia, custom, etc.)
    # ...

    location / {
        # Strip incoming headers to prevent spoofing
        proxy_set_header X-User-Id      "";
        proxy_set_header X-User-Email   "";
        proxy_set_header X-User-Name    "";

        # Set headers from your auth layer
        proxy_set_header X-User-Id      $authenticated_user_id;
        proxy_set_header X-User-Email   $authenticated_user_email;
        proxy_set_header X-User-Name    $authenticated_user_name;

        proxy_pass http://127.0.0.1:3500;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### Traefik example

```yaml
# docker-compose.yml labels
labels:
  - "traefik.http.middlewares.bugreel-headers.headers.customrequestheaders.X-User-Id="
  - "traefik.http.middlewares.bugreel-headers.headers.customrequestheaders.X-User-Email="
  - "traefik.http.middlewares.bugreel-headers.headers.customrequestheaders.X-User-Name="
```

### Caddy example

```
bugreel.example.com {
    # Strip and set auth headers
    request_header X-User-Id    "{http.auth.user.id}"
    request_header X-User-Email "{http.auth.user.email}"
    request_header X-User-Name  "{http.auth.user.name}"

    reverse_proxy localhost:3500
}
```

## Security

### Dashboard authentication

Set `DASHBOARD_PASSWORD` in `.env` for production deployments. Without it, if no users exist in the database, BugReel runs in dev mode with no authentication.

### Share tokens

Public report links use a UUID-based `share_token` (e.g., `/report/a1b2c3d4-...`) instead of sequential recording IDs. This prevents enumeration attacks — knowing one recording's URL does not help guess another. Share tokens are auto-generated for every recording.

### Password-protected recordings

Individual recordings can be locked with a password from the dashboard. Visitors to the public report link must enter the password before viewing. Authenticated dashboard users bypass the password check. Passwords are hashed with scrypt before storage.

### Extension authentication

The Chrome extension authenticates via a long-lived Bearer token generated in Settings. Tokens are stored as sessions (1-year expiry) and can be revoked from the dashboard.

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
