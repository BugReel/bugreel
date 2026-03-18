---
title: "Jira Integration Guide: Connect BugReel to Jira Cloud"
description: "Set up BugReel's Jira integration to automatically export AI-generated bug reports. OAuth setup, configuration, and tips."
date: 2026-03-05
author: "BugReel Team"
image: "/og-image.png"
tags: ["jira", "integration", "bugreel", "tutorial"]
---

Jira is where most development teams manage their work. Bug reports that live outside Jira — in Slack threads, email chains, or standalone recording tools — tend to get lost, deprioritized, or forgotten. The most effective bug reporting workflow sends structured, AI-generated reports directly into Jira, properly formatted with screenshots, steps to reproduce, and severity fields populated automatically.

BugReel's Jira Cloud integration does exactly that. After a one-time OAuth setup, any recording processed by BugReel can be exported to Jira with a single click. The AI-generated title, description, steps to reproduce, key frame screenshots, and priority mapping are all included — the developer finds a complete, actionable ticket in their sprint board, not a link to a video they need to watch and document themselves.

This guide covers the complete setup process: creating the OAuth app in Atlassian, connecting BugReel, exporting your first bug report, and customizing the integration for your team's workflow.

## Why Connect BugReel to Jira?

Before diving into setup, here is what the integration enables:

### One-Click Export

After BugReel processes a recording, click "Export to Jira" on the dashboard. A new Jira issue is created with:

- **Summary:** AI-generated title describing the bug
- **Description:** Structured report with steps to reproduce, expected vs. actual behavior, environment details, and transcript
- **Priority:** Mapped from BugReel's severity assessment (Critical to Highest, High to High, Medium to Medium, Low to Low)
- **Issue Type:** Automatically set to Bug (or Story for feature requests)
- **Attachments:** Key frame screenshots uploaded as Jira attachments
- **Project:** Your configured default project (overridable per export)

### No Copy-Paste, No Reformatting

Without integration, exporting a bug report to Jira means copying the title, pasting the description, downloading screenshots and re-uploading them, setting the priority manually, and choosing the project. With integration, all of this happens in one click. The report arrives in Jira formatted in Atlassian Document Format (ADF), which means proper headings, bullet lists, and embedded content — not a blob of plain text.

### Duplicate Detection

When you export a recording, BugReel searches Jira for existing issues with similar descriptions. If a potential duplicate is found, you see a warning with links to the existing issues. You can then choose to add a comment to the existing issue instead of creating a new one — reducing backlog clutter and consolidating context.

### Bi-Directional Context

The exported Jira issue includes a link back to the BugReel recording. Developers can click through to watch the full video with synced console logs, network requests, and the interactive timeline. The Jira ticket provides the structured summary; the BugReel recording provides the deep context.

## Prerequisites

Before setting up the integration, ensure you have:

1. **A running BugReel instance** — If you have not set up BugReel yet, follow our [Docker setup guide](/blog/bugreel-docker-setup/)
2. **Jira Cloud** — The integration uses Atlassian's OAuth 2.0 (3-legged), which requires Jira Cloud. Jira Server/Data Center use a different authentication mechanism (not yet supported, but on the roadmap)
3. **Jira admin access** — You need permission to create OAuth apps in the Atlassian developer console
4. **BugReel Team plan** — Jira integration is available on the Team plan ($8/user/month) and above. The Community (free) tier supports YouTrack and webhook integrations
5. **HTTPS on your BugReel instance** — OAuth callbacks require HTTPS. See the [Docker setup guide](/blog/bugreel-docker-setup/) for reverse proxy configuration

## Step 1: Create an OAuth App in Atlassian

The first step happens in Atlassian's developer console, where you register BugReel as an OAuth 2.0 application that can access your Jira data.

### Navigate to the Developer Console

1. Go to [developer.atlassian.com/console/myapps/](https://developer.atlassian.com/console/myapps/)
2. Sign in with your Atlassian account (the one with admin access to your Jira instance)
3. Click **Create** > **OAuth 2.0 integration**

### Configure the App

1. **App name:** Enter "BugReel" (or any name your team will recognize)
2. **Description:** "AI-powered bug reporting tool"
3. Click **Create**

### Add API Permissions

After creating the app, you need to add the Jira API scopes that BugReel requires:

1. In the left sidebar, click **Permissions**
2. Find **Jira API** and click **Add**
3. Click **Configure** next to Jira API
4. Add the following scopes:
   - `read:jira-work` — Read project, issue, and attachment data
   - `write:jira-work` — Create issues, add comments, upload attachments
   - `read:jira-user` — Read user profiles (for assignee selection)
   - `offline_access` — Allow token refresh without re-authentication

These are the minimum scopes BugReel needs. It will not access any data beyond what is required for bug report export.

### Set Up the Callback URL

1. In the left sidebar, click **Authorization**
2. Click **Add** next to "OAuth 2.0 (3LO)"
3. **Callback URL:** Enter `https://bugreel.yourcompany.com/api/oauth/jira/callback`

Replace `bugreel.yourcompany.com` with your actual BugReel domain. This URL is where Atlassian redirects after the user authorizes the connection.

### Copy Your Credentials

1. In the left sidebar, click **Settings**
2. Copy the **Client ID** and **Client Secret** — you will need these in the next step

Keep the Client Secret secure. Do not share it in chat, email, or version control.

## Step 2: Configure BugReel

With your Atlassian OAuth app created, configure BugReel to use it.

### Via the Dashboard (Recommended)

1. Open your BugReel dashboard at `https://bugreel.yourcompany.com`
2. Go to **Settings** > **Integrations**
3. Click **Jira Cloud**
4. Enter the following:
   - **OAuth Client ID:** The Client ID from Step 1
   - **OAuth Client Secret:** The Client Secret from Step 1
   - **Jira Site Name:** Your Atlassian site name (e.g., `myteam` if your Jira is at `myteam.atlassian.net`)
   - **Default Project Key:** The Jira project key where bugs should be created by default (e.g., `BUG`, `PROJ`, `ENG`)
5. Click **Save**
6. Click **Connect with Jira** — this opens Atlassian's authorization page

### Via Environment Variables

For automated or headless deployments, you can configure the Jira integration in your `.env` file:

```bash
TRACKER_TYPE=jira
JIRA_CLIENT_ID=your-client-id
JIRA_CLIENT_SECRET=your-client-secret
JIRA_SITE_NAME=myteam
TRACKER_PROJECT=BUG
```

After updating `.env`, restart the container:

```bash
docker compose restart
```

Then complete the OAuth authorization through the dashboard.

## Step 3: Authorize the Connection

Whether you configured via dashboard or environment variables, you need to complete the OAuth authorization flow:

1. In BugReel Settings > Integrations > Jira, click **Connect with Jira**
2. You are redirected to Atlassian's authorization page
3. Review the permissions BugReel is requesting (read/write Jira issues, read users)
4. Click **Accept**
5. You are redirected back to BugReel with a success message

BugReel stores the OAuth tokens securely in its database. The access token is short-lived and automatically refreshed using the refresh token — you will not need to re-authorize unless you explicitly disconnect the integration.

### Verify the Connection

After authorization, BugReel displays:

- **Connected as:** Your Jira display name and avatar
- **Site:** Your Jira site name
- **Available projects:** A list of projects you have access to

If the connection test fails, check the Troubleshooting section below.

## Step 4: Export Your First Bug Report

With the integration configured, export a BugReel recording to Jira:

1. **Open a processed recording** in the BugReel dashboard (one that has completed AI analysis)
2. **Click "Export"** (or the Jira icon in the recording toolbar)
3. **Review the export preview:**
   - Title (editable)
   - Project (defaults to your configured project, changeable via dropdown)
   - Issue type (Bug or Story)
   - Priority (mapped from BugReel severity)
   - Description preview (ADF-formatted)
   - Screenshots to attach
4. **Click "Create Issue"**

BugReel creates the Jira issue and displays a link to it. The issue appears in your Jira project with all fields populated.

### What the Jira Issue Contains

The created issue includes:

**Summary:** The AI-generated title, e.g., "Payment form submits successfully with invalid credit card number"

**Description** (in Atlassian Document Format):

- Bug summary paragraph
- Steps to reproduce (numbered list)
- Expected behavior
- Actual behavior
- Environment details (browser, OS, viewport)
- Link back to the full BugReel recording
- Transcript excerpt

**Attachments:** Key frame screenshots extracted by BugReel's AI, named descriptively (e.g., `error-state-payment-form.png`, `console-error-500.png`)

**Priority:** Mapped from BugReel's severity:
- Critical → Highest
- High → High
- Medium → Medium
- Low → Low

**Issue Type:** Bug (default) or Story if BugReel classifies the recording as a feature request.

## Customizing the Integration

### Default Field Mapping

BugReel maps its fields to Jira fields automatically, but you can customize the mapping in Settings > Integrations > Jira > Field Mapping:

| BugReel Field | Default Jira Field | Customizable? |
|---|---|---|
| Title | Summary | Yes |
| Severity | Priority | Yes (custom mapping) |
| Type (bug/feature) | Issue Type | Yes |
| Steps + Description | Description | Template customizable |
| Screenshots | Attachments | Always included |
| Component | Component | Yes (manual selection) |
| Labels | Labels | Yes (auto or manual) |

### Custom Labels

Configure BugReel to automatically add labels to exported issues:

- **Source label:** Automatically adds `bugreel` label to all exported issues (helps with filtering)
- **Severity labels:** Optionally adds `severity-critical`, `severity-high`, etc.
- **Custom labels:** Add any fixed labels to all exports (e.g., `needs-triage`, `from-qa`)

### Project Selection Per Export

While a default project is configured, each export lets you choose a different project from the dropdown. This is useful for teams that use separate projects for different products or components.

### Adding Comments to Existing Issues

If BugReel's duplicate detection identifies a matching issue, or if you want to add context to an existing ticket:

1. In the export dialog, click **"Add to existing issue"** instead of "Create Issue"
2. Search for the issue by key (e.g., `BUG-123`) or by text
3. BugReel adds a comment with the recording analysis, screenshots, and a link to the full recording

This is particularly useful when multiple team members encounter the same bug — each recording adds context to the same ticket instead of creating duplicates.

## Working with Jira Workflows

### Sprint Board Integration

Exported issues appear in your Jira backlog immediately. If your team uses sprint boards, the issue will be in the backlog ready for sprint planning. BugReel's complexity scoring (included in the description) helps with estimation during planning.

### Automation Rules

Jira's automation engine can trigger rules based on BugReel exports. Common automations:

**Auto-assign based on component:**
- When: Issue created with label `bugreel`
- If: Component = "Payments"
- Then: Assign to payments team lead

**Auto-transition critical bugs:**
- When: Issue created with priority = Highest and label = `bugreel`
- Then: Move to "In Progress" and notify #critical-bugs Slack channel

**Auto-add to sprint:**
- When: Issue created with label `bugreel` and priority = High or Highest
- Then: Add to current active sprint

### JQL Queries for BugReel Issues

Filter BugReel-exported issues in Jira:

```
# All BugReel issues
labels = "bugreel"

# Critical BugReel issues from last week
labels = "bugreel" AND priority = Highest AND created >= -1w

# BugReel issues in current sprint
labels = "bugreel" AND sprint in openSprints()

# Unresolved BugReel issues by project
labels = "bugreel" AND project = BUG AND resolution = Unresolved ORDER BY priority DESC
```

## Security and Data Flow

Understanding what data moves between BugReel and Jira is important for security-conscious teams.

### What BugReel Sends to Jira

- Issue fields (title, description, priority, type)
- Screenshot images (uploaded as attachments)
- A URL link back to the BugReel recording

BugReel does **not** send:
- Raw video files (too large for Jira attachments, and unnecessary)
- Console logs or network request details (included in the text description, not as raw data)
- Any data from other recordings or users

### Token Security

- OAuth tokens are stored in BugReel's SQLite database on your server
- Access tokens expire after 1 hour and are automatically refreshed
- Refresh tokens are stored encrypted (using your `AUTH_SALT`)
- Revoking access in Atlassian's app management immediately invalidates all tokens

### Self-Hosted Advantage

Because BugReel is self-hosted, the OAuth flow happens between your server and Atlassian directly. No third-party service sits in the middle. Your Jira credentials and bug report data never pass through BugReel's infrastructure — because there is no BugReel cloud infrastructure. The code runs entirely on your server.

## Troubleshooting

### "Connection Failed" During OAuth

**Check your callback URL.** The callback URL in Atlassian's developer console must exactly match your BugReel instance URL plus `/api/oauth/jira/callback`. Common mistakes:
- Missing `https://` (HTTP will not work for OAuth)
- Trailing slash mismatch
- Wrong domain or port

**Check HTTPS.** Atlassian requires HTTPS for OAuth callbacks. If your BugReel instance does not have HTTPS configured, set up a reverse proxy with SSL first.

**Check the Client ID and Secret.** Copy them again from the Atlassian developer console — invisible whitespace or partial copies are common.

### "No Accessible Jira Sites Found"

This error means the OAuth token does not have access to any Jira sites. Common causes:
- The Atlassian account used for authorization does not have access to any Jira Cloud instances
- The OAuth app's scopes were not saved correctly — go back to the developer console and verify the Jira API permissions are added and configured

### "Create Issue Failed: 400"

A 400 error usually means a field mapping issue:
- The project key does not exist in your Jira instance
- The issue type "Bug" does not exist in the project's scheme (some projects use custom issue types)
- A required custom field is not being populated

Check the BugReel logs for the full error response:

```bash
docker compose logs bugreel | grep -i "jira"
```

### Screenshots Not Appearing as Attachments

Jira attachment upload requires the `write:jira-work` scope. Verify this scope is configured in your Atlassian OAuth app. Also ensure your Jira project allows attachments (some projects disable them via project settings).

If attachments fail but the issue creates successfully, BugReel falls back to embedding screenshot URLs in the description as image links (pointing back to your BugReel server).

### Token Refresh Failures

If exports stop working after a period of time, the refresh token may have expired or been revoked. Re-authorize by going to Settings > Integrations > Jira > **Reconnect**.

Refresh tokens can expire if:
- The OAuth app is modified in the Atlassian developer console
- An Atlassian admin revokes the app's access
- The refresh token has not been used for an extended period (Atlassian's policy)

## Frequently Asked Questions

### Does the Jira integration work with Jira Server or Data Center?

Currently, BugReel's Jira integration supports Jira Cloud only, which uses Atlassian's OAuth 2.0 (3-legged) authentication. Jira Server and Data Center use a different authentication mechanism (OAuth 1.0a or personal access tokens). Support for Jira Server/Data Center is on the roadmap. In the meantime, you can use BugReel's webhook integration to send reports to a middleware that creates Jira Server issues.

### Can multiple team members connect their own Jira accounts?

Yes. Each BugReel user can authorize their own Jira account through the OAuth flow. Issues created by each user will show that user as the reporter in Jira. If you prefer all issues to be created from a single service account, have one person authorize and all exports will use that account's credentials.

### What happens if I disconnect the Jira integration?

Disconnecting removes the stored OAuth tokens from BugReel. Previously exported issues remain in Jira — they are not affected. The links from Jira issues back to BugReel recordings continue to work as long as your BugReel instance is running. You can reconnect at any time by going through the OAuth flow again.
