# Branding & White-Label

BugReel supports full white-labeling — you can replace the brand name, logo, and link across the entire product with a single configuration.

## Quick Start

### Option 1: Environment Variables (recommended for deployment)

```bash
# .env
BRAND_NAME=MyProduct
BRAND_URL=https://myproduct.com
BRAND_LOGO_URL=https://myproduct.com/logo.png
BRAND_LOGO_LINK=https://myproduct.com
```

Restart the server after changing env vars. These values become defaults for all branding throughout the app.

### Option 2: Settings UI (runtime override)

Go to **Dashboard → Settings → Branding** and set:

- **Brand Name** — displayed in header, page titles, embed player
- **Logo URL** — image shown instead of the default icon (PNG, SVG, JPG; recommended height: 28-40px)
- **Logo Link** — where clicking the logo navigates to

Settings UI values are saved to the database and **take priority** over env vars.

## Override Chain

Each branding property resolves in this order (first non-empty wins):

```
Database (Settings UI)  →  Environment Variable  →  Hardcoded Default
```

| Property | DB key | Env var | Default |
|----------|--------|---------|---------|
| Name | `branding_name` | `BRAND_NAME` | `BugReel` |
| URL | — | `BRAND_URL` | `https://bugreel.io` |
| Logo URL | `branding_logo_url` | `BRAND_LOGO_URL` | *(none — shows SVG icon)* |
| Logo Link | `branding_logo_link` | `BRAND_LOGO_LINK` | Falls back to `BRAND_URL` |

## Where Branding Appears

| Location | What's shown | Source |
|----------|-------------|--------|
| Dashboard header | Name + icon/logo | `/api/branding` (fetched async) |
| Dashboard page titles | `Page - {name}` | `/api/branding` |
| Embed player (public reports) | Logo or name + link | Server-side from `getBrandingConfig()` |
| Embed page `<title>` | `{title} — {name}` | Server-side |
| Settings page | Editable form fields | `/api/settings` |

## API

### `GET /api/branding`

Lightweight, no-auth endpoint. Returns the resolved branding config.

```json
{
  "name": "MyProduct",
  "logo_url": "https://myproduct.com/logo.png",
  "logo_link": "https://myproduct.com",
  "url": "https://myproduct.com"
}
```

### `GET /api/settings`

Returns all settings including branding fields (`branding_name`, `branding_logo_url`, `branding_logo_link`).

### `PUT /api/settings`

Save branding (and other settings). Send any combination of:

```json
{
  "branding_name": "MyProduct",
  "branding_logo_url": "https://myproduct.com/logo.png",
  "branding_logo_link": "https://myproduct.com"
}
```

## Extension Branding

The Chrome extension uses a separate build-time override mechanism (not runtime):

- `extension/_locales/*/messages.json` — `brandName`, `extName` keys
- `extension/icons/` — icon PNGs (16, 48, 128)

For white-label extension builds, create an overlay directory with your locale files and icons, then merge them during the build.

## Programmatic Setup

To set branding via API (e.g., during deployment):

```bash
curl -X PUT http://localhost:3500/api/settings \
  -H "Content-Type: application/json" \
  -d '{
    "branding_name": "MyProduct",
    "branding_logo_url": "https://cdn.example.com/logo.svg",
    "branding_logo_link": "https://myproduct.com"
  }'
```

## Files

| File | Role |
|------|------|
| `server/config.js` | Env var defaults (`config.branding.*`) |
| `server/routes/settings.js` | `getBrandingConfig()`, API endpoints |
| `server/routes/embed.js` | Server-side branding in embed player |
| `dashboard/js/shared.js` | Client-side branding fetch + header update |
| `dashboard/js/i18n-dashboard.js` | Translation keys for settings UI |
| `dashboard/settings-page.html` | Branding settings form |
