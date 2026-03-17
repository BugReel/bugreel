import { TrackerIntegration } from './base.js'

const API_BASE = 'https://api.github.com'
const API_HEADERS = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'BugReel',
}

/**
 * GitHub Issues integration for BugReel.
 * Screenshots are embedded as markdown image links (GitHub has no attachment API).
 */
export class GitHubIntegration extends TrackerIntegration {
  name = 'github'
  displayName = 'GitHub Issues'
  supportsOAuth = true
  supportsAttachments = false // GitHub has NO API for attaching files to issues

  constructor(config) {
    super(config)
    // config: { clientId, clientSecret, owner, repo }
  }

  // --- OAuth 2.0 ---

  getOAuthURL(redirectUri, state) {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: redirectUri,
      scope: 'repo',
      state,
    })
    return { url: `https://github.com/login/oauth/authorize?${params}`, state }
  }

  async handleOAuthCallback(code, redirectUri) {
    // Exchange code for access token
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        code,
      }),
    })
    if (!tokenRes.ok) throw new Error(`Token exchange failed: ${tokenRes.status}`)
    const tokenData = await tokenRes.json()

    if (tokenData.error) {
      throw new Error(`OAuth error: ${tokenData.error_description || tokenData.error}`)
    }

    // Get authenticated user info
    const userRes = await fetch(`${API_BASE}/user`, {
      headers: {
        ...API_HEADERS,
        Authorization: `Bearer ${tokenData.access_token}`,
      },
    })
    if (!userRes.ok) throw new Error(`Failed to get user info: ${userRes.status}`)
    const userData = await userRes.json()

    return {
      user: {
        id: userData.id,
        name: userData.name || userData.login,
        email: userData.email,
        avatar: userData.avatar_url,
      },
      tokens: {
        access: tokenData.access_token,
      },
    }
  }

  // GitHub OAuth tokens don't expire (no refresh flow)
  async refreshToken() {
    throw new Error('GitHub OAuth tokens do not expire and cannot be refreshed')
  }

  // --- Issue Management ---

  async createIssue(card, frames = [], options = {}) {
    const token = options.token || this.config.token
    const owner = options.owner || this.config.owner
    const repo = options.repo || this.config.repo

    // Build markdown body with embedded screenshot links
    let body = card.description || ''

    if (frames.length > 0 && options.baseUrl) {
      body += '\n\n## Screenshots\n\n'
      body += this.embedScreenshotLinks(frames, options.baseUrl)
    }

    const res = await fetch(`${API_BASE}/repos/${owner}/${repo}/issues`, {
      method: 'POST',
      headers: {
        ...API_HEADERS,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: card.title || 'Untitled',
        body,
        labels: ['bug'],
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`GitHub create issue failed (${res.status}): ${err}`)
    }

    const issue = await res.json()
    return {
      id: issue.id,
      url: issue.html_url,
      key: `#${issue.number}`,
    }
  }

  async searchIssues(query, options = {}) {
    const token = options.token || this.config.token
    const owner = options.owner || this.config.owner
    const repo = options.repo || this.config.repo

    const q = encodeURIComponent(`${query} repo:${owner}/${repo}`)
    const res = await fetch(`${API_BASE}/search/issues?q=${q}`, {
      headers: {
        ...API_HEADERS,
        Authorization: `Bearer ${token}`,
      },
    })

    if (!res.ok) return []
    const data = await res.json()

    return (data.items || []).map(issue => ({
      id: issue.id,
      key: `#${issue.number}`,
      summary: issue.title,
      url: issue.html_url,
    }))
  }

  async addComment(issueId, text, options = {}) {
    const token = options.token || this.config.token
    const owner = options.owner || this.config.owner
    const repo = options.repo || this.config.repo

    const res = await fetch(`${API_BASE}/repos/${owner}/${repo}/issues/${issueId}/comments`, {
      method: 'POST',
      headers: {
        ...API_HEADERS,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ body: text }),
    })

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`GitHub add comment failed (${res.status}): ${err}`)
    }

    return await res.json()
  }

  // --- Team ---

  async getProjects(options = {}) {
    const token = options.token || this.config.token

    const res = await fetch(`${API_BASE}/user/repos?sort=updated&per_page=30`, {
      headers: {
        ...API_HEADERS,
        Authorization: `Bearer ${token}`,
      },
    })

    if (!res.ok) return []
    const repos = await res.json()

    return (repos || []).map(r => ({
      id: r.id,
      key: r.full_name,
      name: r.name,
    }))
  }

  async getUsers(options = {}) {
    const token = options.token || this.config.token
    const owner = options.owner || this.config.owner
    const repo = options.repo || this.config.repo

    const res = await fetch(`${API_BASE}/repos/${owner}/${repo}/collaborators`, {
      headers: {
        ...API_HEADERS,
        Authorization: `Bearer ${token}`,
      },
    })

    if (!res.ok) return []
    const users = await res.json()

    return (users || []).map(u => ({
      id: u.id,
      name: u.login,
      email: u.email || null,
      avatar: u.avatar_url,
    }))
  }

  // --- Configuration ---

  getSetupSchema() {
    return {
      type: 'object',
      required: ['clientId', 'clientSecret', 'owner', 'repo'],
      properties: {
        clientId: {
          type: 'string',
          title: 'OAuth Client ID',
          description: 'GitHub OAuth App client ID',
        },
        clientSecret: {
          type: 'string',
          title: 'OAuth Client Secret',
          description: 'GitHub OAuth App client secret',
          format: 'password',
        },
        owner: {
          type: 'string',
          title: 'Repository Owner',
          description: 'GitHub username or organization (e.g. octocat)',
        },
        repo: {
          type: 'string',
          title: 'Repository Name',
          description: 'Repository name (e.g. my-project)',
        },
      },
    }
  }

  async testConnection(options = {}) {
    const token = options.token || this.config.token
    try {
      const res = await fetch(`${API_BASE}/user`, {
        headers: {
          ...API_HEADERS,
          Authorization: `Bearer ${token}`,
        },
      })

      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
      const user = await res.json()
      return { ok: true, user: user.login }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  }
}
