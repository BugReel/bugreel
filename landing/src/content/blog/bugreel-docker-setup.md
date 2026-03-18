---
title: "Setting Up BugReel with Docker in 5 Minutes"
description: "Get BugReel running on your server in under 5 minutes. Step-by-step Docker setup guide with configuration tips."
date: 2026-03-06
author: "BugReel Team"
image: "/og-image.png"
tags: ["bugreel", "docker", "setup", "tutorial", "self-hosted"]
---

BugReel is designed to be self-hosted. Your screen recordings, bug reports, and AI-generated analysis stay on your server — no third-party cloud storage, no data leaving your infrastructure. The entire setup takes a single Docker command and less than five minutes from start to first bug report.

This guide walks you through the complete process: prerequisites, installation, configuration, connecting the Chrome extension, and creating your first recording. By the end, you will have a fully functional AI-powered bug reporting system running on your own hardware.

## Prerequisites

Before starting, make sure you have the following:

### Docker and Docker Compose

BugReel runs as a single Docker container. You need Docker Engine 20.10+ and Docker Compose V2 installed on your server or local machine.

To verify your installation:

```bash
docker --version
# Docker version 24.0.0 or higher

docker compose version
# Docker Compose version v2.20.0 or higher
```

If you do not have Docker installed, follow the official installation guides:

- **Ubuntu/Debian:** [docs.docker.com/engine/install/ubuntu](https://docs.docker.com/engine/install/ubuntu/)
- **macOS:** [Docker Desktop for Mac](https://docs.docker.com/desktop/install/mac-install/)
- **Windows:** [Docker Desktop for Windows](https://docs.docker.com/desktop/install/windows-install/)

### OpenAI API Key (or Compatible Endpoint)

BugReel uses AI for transcription (Whisper) and analysis (GPT). You need an API key from one of these providers:

- **OpenAI** (recommended): Get a key at [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
- **Azure OpenAI:** Works with BugReel by configuring the endpoint URLs
- **Ollama or other local models:** Any OpenAI-compatible API endpoint works

The AI processing cost is minimal. A typical bug recording (60-second video with audio) costs approximately $0.02-0.05 per analysis using GPT-4o-mini.

### Server Requirements

BugReel is lightweight:

- **CPU:** 1 core minimum (2 recommended)
- **RAM:** 512 MB minimum (1 GB recommended)
- **Disk:** 1 GB for the application + storage for recordings (plan 50-100 MB per recording)
- **OS:** Any Linux distribution, macOS, or Windows with Docker

A $5/month VPS from any cloud provider is more than sufficient for small teams.

## Step 1: Clone the Repository

```bash
git clone https://github.com/BugReel/bugreel.git
cd bugreel
```

If you prefer not to clone the full repository, you only need three files: `docker-compose.yml`, `Dockerfile`, and `.env.example`. But cloning is the simplest approach and ensures you have everything for future updates.

## Step 2: Configure Environment Variables

Copy the example environment file and edit it:

```bash
cp .env.example .env
```

Open `.env` in your editor. Here is the complete configuration reference:

```bash
# Server
PORT=3500
HOST=0.0.0.0
DATA_DIR=./data

# AI (any OpenAI-compatible endpoint)
WHISPER_URL=https://api.openai.com/v1/audio/transcriptions
GPT_URL=https://api.openai.com/v1/chat/completions
GPT_API_KEY=sk-your-openai-key
GPT_MODEL=gpt-4o-mini

# Tracker (configured via dashboard)
TRACKER_TYPE=none
TRACKER_URL=
TRACKER_TOKEN=
TRACKER_PROJECT=

# Auth
AUTH_SALT=change-this-to-random-string
DASHBOARD_PASSWORD=

# License (optional — defaults to community tier)
LICENSE_KEY=

# Limits
MAX_VIDEO_SIZE=104857600
MAX_VIDEO_DURATION=300
MAX_SCREENSHOTS=10
```

### Required Changes

At minimum, you must set two values:

**`GPT_API_KEY`** — Your OpenAI API key (or compatible provider key). This is required for AI-powered transcription and analysis.

```bash
GPT_API_KEY=sk-proj-abc123...your-actual-key
```

**`AUTH_SALT`** — A random string used for session hashing. Generate one with:

```bash
openssl rand -hex 32
```

Paste the output as your `AUTH_SALT` value.

### Recommended Changes

**`DASHBOARD_PASSWORD`** — If set, the BugReel dashboard will require this password to access. Strongly recommended for any server-facing deployment.

```bash
DASHBOARD_PASSWORD=your-secure-password
```

**`GPT_MODEL`** — The default `gpt-4o-mini` offers the best balance of quality and cost. For higher quality analysis, use `gpt-4o`. For maximum speed, `gpt-4o-mini` is already optimized.

### Optional Configuration

**`PORT`** — Change from 3500 if you have a port conflict. Remember to update the `docker-compose.yml` port mapping if you change this.

**`DATA_DIR`** — Where recordings, frames, and the SQLite database are stored. The default `./data` maps to a Docker volume at `/app/data` inside the container.

**`MAX_VIDEO_SIZE`** — Maximum upload size in bytes. Default is 100 MB (104857600 bytes). Increase for teams that record longer sessions.

**`MAX_VIDEO_DURATION`** — Maximum recording duration in seconds. Default is 300 (5 minutes). Most bug recordings should be under 2 minutes, but complex reproduction paths may need more.

**`MAX_SCREENSHOTS`** — Maximum AI-extracted key frames per recording. Default is 10, which is sufficient for most bug reports.

**`TRACKER_TYPE`** — Pre-configure a tracker integration. Options: `none`, `youtrack`, `jira`, `linear`, `github`, `webhook`. You can also configure this through the dashboard UI after setup.

**`LICENSE_KEY`** — Required only for Team or Enterprise tiers. The Community tier (up to 5 users, unlimited recordings) requires no license key.

## Step 3: Start BugReel

```bash
docker compose up -d
```

That is it. Docker will:

1. Build the BugReel image (Node.js 20 Alpine + FFmpeg)
2. Create the data volume for persistent storage
3. Start the container on port 3500

The first build takes 1-2 minutes as Docker downloads the base image and installs dependencies. Subsequent starts are instant.

Verify the container is running:

```bash
docker compose ps
```

You should see:

```
NAME       IMAGE           STATUS          PORTS
bugreel    bugreel-bugreel Up 2 minutes    0.0.0.0:3500->3500/tcp
```

Open your browser and navigate to `http://localhost:3500` (or `http://your-server-ip:3500` for remote servers). You should see the BugReel dashboard.

### What the Docker Setup Includes

The BugReel Docker image is built from a minimal `node:20-alpine` base with FFmpeg added for video processing:

```dockerfile
FROM node:20-alpine
RUN apk add --no-cache ffmpeg
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY server/ ./server/
COPY dashboard/ ./dashboard/
EXPOSE 3500
VOLUME /app/data
ENV NODE_ENV=production
CMD ["node", "server/index.js"]
```

The `docker-compose.yml` maps port 3500 and mounts the `./data` directory as a persistent volume:

```yaml
services:
  bugreel:
    build: .
    ports:
      - "3500:3500"
    volumes:
      - ./data:/app/data
    env_file: .env
    restart: unless-stopped
```

The `restart: unless-stopped` policy ensures BugReel starts automatically after server reboots.

## Step 4: Connect the Chrome Extension

BugReel's Chrome extension is the recording interface. It captures your screen, audio, console logs, and user actions, then sends the recording to your BugReel server for AI processing.

### Install the Extension

1. Open the Chrome Web Store and search for "BugReel" (or install from the `.crx` file in the `extension/` directory for self-hosted installations)
2. Click "Add to Chrome"
3. Pin the BugReel icon to your toolbar for easy access

### Configure the Server URL

1. Click the BugReel extension icon in your toolbar
2. Open Settings (gear icon)
3. Set the **Server URL** to your BugReel instance: `http://localhost:3500` or `https://bugreel.yourcompany.com`
4. If you set a `DASHBOARD_PASSWORD`, enter it in the authentication field
5. Click Save

The extension will verify the connection and show a green checkmark when connected successfully.

### Grant Permissions

The first time you record, Chrome will ask for permission to:

- **Capture your screen:** Required for screen recording
- **Access your microphone:** Required for narration (optional but recommended)
- **Read console logs:** Required for technical context capture

Grant all permissions for the best experience.

## Step 5: Create Your First Recording

With the extension connected, create your first bug report to verify everything works:

1. **Navigate to any web page** — your application, a test site, or even a public website
2. **Click the BugReel extension icon** and click **Record**
3. **Select what to capture:** "This Tab" for the current tab, or "Entire Screen" for full desktop
4. **Reproduce a bug** (or simulate one) while narrating what you are doing: "I'm clicking the login button, and I expect to see the dashboard, but instead I get a blank page."
5. **Click Stop** when done
6. **Wait 30-60 seconds** for AI processing — BugReel will transcribe your audio, analyze the video, extract key frames, and generate a structured bug report

When processing completes, the dashboard will show your first recording with:

- **Title:** AI-generated from your narration
- **Steps to reproduce:** Extracted from your actions and narration
- **Key frame screenshots:** Automatically selected moments from the recording
- **Severity assessment:** Based on the described impact
- **Full transcript:** Your narration converted to searchable text
- **Technical context:** Console logs, network requests, and user actions from the recording

Congratulations — you have a self-hosted, AI-powered bug reporting system running.

## Configuring Tracker Integration

BugReel supports one-click export to popular issue trackers. You can configure integrations through the dashboard or via environment variables.

### Via Dashboard (Recommended)

1. Open the BugReel dashboard
2. Go to **Settings** > **Integrations**
3. Select your tracker (YouTrack, Jira, Linear, GitHub Issues, or Webhook)
4. Follow the tracker-specific setup instructions
5. Test the connection

### Via Environment Variables

For automated deployments, configure the tracker in `.env`:

```bash
# YouTrack example
TRACKER_TYPE=youtrack
TRACKER_URL=https://your-instance.youtrack.cloud
TRACKER_TOKEN=perm:your-permanent-token
TRACKER_PROJECT=BUG

# Jira Cloud example
TRACKER_TYPE=jira
TRACKER_URL=https://your-team.atlassian.net
TRACKER_TOKEN=your-api-token
TRACKER_PROJECT=BUG

# Generic Webhook example
TRACKER_TYPE=webhook
TRACKER_URL=https://your-server.com/api/bugs
TRACKER_TOKEN=your-hmac-secret
```

After configuring, each recording in the dashboard will show an **Export** button that sends the AI-generated report directly to your tracker with all fields populated.

## Production Deployment Tips

### Reverse Proxy with HTTPS

For production deployments, place BugReel behind a reverse proxy (Nginx, Caddy, or Traefik) with HTTPS:

**Nginx example:**

```nginx
server {
    listen 443 ssl;
    server_name bugreel.yourcompany.com;

    ssl_certificate /etc/letsencrypt/live/bugreel.yourcompany.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/bugreel.yourcompany.com/privkey.pem;

    client_max_body_size 200M;

    location / {
        proxy_pass http://localhost:3500;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

**Caddy example (automatic HTTPS):**

```
bugreel.yourcompany.com {
    reverse_proxy localhost:3500
}
```

Note the `client_max_body_size` directive in Nginx — video uploads can be large, so set this to at least 200 MB.

### Backup Strategy

BugReel stores all data in the `./data` directory:

- `data/bugreel.db` — SQLite database (recordings metadata, settings, users)
- `data/recordings/` — Video files and extracted frames

Back up this directory regularly. A simple cron job works:

```bash
# Daily backup at 2 AM
0 2 * * * tar -czf /backups/bugreel-$(date +\%Y\%m\%d).tar.gz /path/to/bugreel/data
```

### Resource Monitoring

BugReel is lightweight, but video processing (FFmpeg) and AI API calls can spike CPU briefly during processing. Monitor disk usage — recordings accumulate over time. Plan for approximately 50-100 MB per recording (video + extracted frames).

Set up alerts for:
- Disk usage above 80%
- Container restart events
- Failed AI API calls (check container logs: `docker compose logs -f`)

### Using a Local AI Model

If you want to avoid sending data to OpenAI (even temporarily during transcription), you can run a local AI model using Ollama or any OpenAI-compatible API:

```bash
# Install Ollama
curl -fsSL https://ollama.ai/install.sh | sh

# Pull a model
ollama pull llama3

# Configure BugReel to use Ollama
GPT_URL=http://localhost:11434/v1/chat/completions
GPT_API_KEY=ollama
GPT_MODEL=llama3
```

Note: Local models require significantly more server resources (8 GB+ RAM for most models) and may produce lower quality analysis than GPT-4o-mini. For transcription (Whisper), OpenAI's API is recommended unless you have specific compliance requirements.

## Updating BugReel

To update to the latest version:

```bash
cd bugreel
git pull origin main
docker compose build
docker compose up -d
```

Your data is preserved in the `./data` volume — rebuilding the container does not affect existing recordings or settings.

Check the changelog for breaking changes before updating. BugReel follows semantic versioning — patch and minor updates are backward compatible.

## Troubleshooting

### Container Fails to Start

**Check logs:**

```bash
docker compose logs bugreel
```

Common causes:
- **Port conflict:** Another service is using port 3500. Change the port in `docker-compose.yml` and `.env`.
- **Missing .env file:** Make sure `.env` exists and has at least `GPT_API_KEY` set.
- **Permission error on data directory:** Ensure the `data/` directory is writable by Docker.

### AI Processing Fails

If recordings upload but analysis never completes:

**Check your API key:**

```bash
curl https://api.openai.com/v1/models \
  -H "Authorization: Bearer sk-your-key-here"
```

If this returns an error, your API key is invalid or has no credits.

**Check the processing logs:**

```bash
docker compose logs -f bugreel | grep -i "error\|fail"
```

Common causes:
- Invalid or expired API key
- Insufficient OpenAI account credits
- Network connectivity issues (can the container reach api.openai.com?)
- Model not available (verify `GPT_MODEL` is a valid model name)

### Extension Cannot Connect

If the Chrome extension shows "Connection failed":

- Verify the server URL in extension settings matches your BugReel instance
- Check that the BugReel container is running: `docker compose ps`
- If using HTTPS, ensure your SSL certificate is valid
- If using a firewall, ensure port 3500 (or your custom port) is open
- Try accessing the dashboard URL directly in your browser to confirm the server is reachable

### Recordings Are Large

If video files are consuming too much disk space:

- Reduce `MAX_VIDEO_DURATION` to encourage shorter recordings
- Set up a retention policy — delete recordings older than 90 days
- Compress the data directory: recordings are already in WebM format (efficient), but extracted frames (PNG) can be large

### Permission Errors

If you see "EACCES: permission denied" in logs:

```bash
# Fix ownership of data directory
sudo chown -R 1000:1000 ./data
```

The Node.js process inside the container runs as user 1000 (default Alpine node user).

## Frequently Asked Questions

### Can BugReel run without Docker?

Yes. BugReel is a standard Node.js application. You can run it directly with `npm install && node server/index.js`. However, Docker is recommended because it includes FFmpeg (required for video processing) and ensures a consistent environment. Without Docker, you need to install FFmpeg manually and manage Node.js version compatibility yourself.

### How much does the AI processing cost per recording?

Using OpenAI's GPT-4o-mini (the default), a typical 60-second recording costs approximately $0.02-0.05 to process. This includes Whisper transcription (~$0.006/minute) and GPT analysis (~$0.01-0.04 depending on output length). A team processing 100 recordings per month would spend roughly $2-5/month on AI costs. Using GPT-4o increases quality slightly but costs approximately 10x more.

### Is my data sent to OpenAI during processing?

Audio is sent to OpenAI's Whisper API for transcription, and the transcript (plus extracted frame descriptions) is sent to GPT for analysis. The video file itself is never sent to OpenAI — only the audio track and text. If this is a concern, you can use a local Whisper model and a local LLM via Ollama to keep all processing on your server, though this requires more server resources.
