import { TrackerIntegration } from './base.js'

/**
 * Jira Cloud integration via REST API v3 + OAuth 2.0 (3LO).
 */
export class JiraIntegration extends TrackerIntegration {
  name = 'jira'
  displayName = 'Jira Cloud'
  supportsOAuth = true
  supportsAttachments = true

  constructor(config) {
    super(config)
    // config: { clientId, clientSecret, cloudId, baseUrl (optional) }
  }

  get apiBase() {
    return `https://api.atlassian.com/ex/jira/${this.config.cloudId}/rest/api/3`
  }

  /** Browser-facing URL for the Jira site (used in issue links) */
  get siteUrl() {
    if (this.config.baseUrl) return this.config.baseUrl
    if (this.config.siteName) return `https://${this.config.siteName}.atlassian.net`
    return 'https://atlassian.net'
  }

  // --- OAuth 2.0 (3LO) ---

  getOAuthURL(redirectUri, state) {
    const params = new URLSearchParams({
      audience: 'api.atlassian.com',
      client_id: this.config.clientId,
      scope: 'read:jira-work write:jira-work read:jira-user offline_access',
      redirect_uri: redirectUri,
      state,
      response_type: 'code',
      prompt: 'consent',
    })
    return { url: `https://auth.atlassian.com/authorize?${params}`, state }
  }

  async handleOAuthCallback(code, redirectUri) {
    // Exchange code for token
    const tokenRes = await fetch('https://auth.atlassian.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
    })
    if (!tokenRes.ok) throw new Error(`Token exchange failed: ${tokenRes.status}`)
    const tokens = await tokenRes.json()

    // Get accessible resources (cloudId)
    const resourcesRes = await fetch('https://api.atlassian.com/oauth/token/accessible-resources', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })
    const resources = await resourcesRes.json()
    const cloudId = resources[0]?.id
    if (!cloudId) throw new Error('No accessible Jira sites found')

    // Get current user
    const userRes = await fetch(`https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/myself`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })
    const userData = await userRes.json()

    return {
      user: {
        id: userData.accountId,
        name: userData.displayName,
        email: userData.emailAddress,
        avatar: userData.avatarUrls?.['48x48'],
      },
      tokens: {
        access: tokens.access_token,
        refresh: tokens.refresh_token,
      },
      cloudId,
    }
  }

  async refreshToken(refreshToken) {
    const res = await fetch('https://auth.atlassian.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        refresh_token: refreshToken,
      }),
    })
    if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`)
    const data = await res.json()
    return { access_token: data.access_token, refresh_token: data.refresh_token }
  }

  // --- Issue Management ---

  async createIssue(card, frames, options = {}) {
    const token = options.token || this.config.token
    const projectKey = options.project || this.config.project

    const description = this.buildAdf(card, frames, options.baseUrl)

    const body = {
      fields: {
        project: { key: projectKey },
        summary: card.title || 'Untitled',
        description,
        issuetype: { name: card.type === 'feature' ? 'Story' : 'Bug' },
      },
    }

    if (card.priority) {
      const priorityMap = { critical: 'Highest', high: 'High', medium: 'Medium', low: 'Low' }
      if (priorityMap[card.priority]) {
        body.fields.priority = { name: priorityMap[card.priority] }
      }
    }

    const res = await fetch(`${this.apiBase}/issue`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const err = await res.text()
      throw new Error(`Jira create issue failed (${res.status}): ${err}`)
    }
    const issue = await res.json()

    // Attach screenshots
    if (frames.length > 0 && options.files) {
      await this.attachFiles(issue.key, options.files, token)
    }

    return {
      id: issue.id,
      url: `${this.siteUrl}/browse/${issue.key}`,
      key: issue.key,
    }
  }

  async searchIssues(query, options = {}) {
    const token = options.token || this.config.token
    const jql = `text ~ "${query.replace(/"/g, '\\"')}" ORDER BY updated DESC`
    const res = await fetch(`${this.apiBase}/search?jql=${encodeURIComponent(jql)}&maxResults=20&fields=summary`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return []
    const data = await res.json()
    return (data.issues || []).map(i => ({
      id: i.id,
      key: i.key,
      summary: i.fields.summary,
      url: `${this.siteUrl}/browse/${i.key}`,
    }))
  }

  async addComment(issueId, text, options = {}) {
    const token = options.token || this.config.token
    const res = await fetch(`${this.apiBase}/issue/${issueId}/comment`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        body: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
      }),
    })
    return res.ok
  }

  // --- Attachments ---

  async attachFiles(issueId, files, token) {
    token = token || this.config.token
    for (const file of files) {
      const formData = new FormData()
      formData.append('file', new Blob([file.buffer]), file.filename)

      await fetch(`${this.apiBase}/issue/${issueId}/attachments`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Atlassian-Token': 'no-check',
        },
        body: formData,
      })
    }
    return true
  }

  // --- Team ---

  async getProjects(options = {}) {
    const token = options.token || this.config.token
    const res = await fetch(`${this.apiBase}/project/search?maxResults=50`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return []
    const data = await res.json()
    return (data.values || []).map(p => ({ id: p.id, key: p.key, name: p.name }))
  }

  async getUsers(options = {}) {
    const token = options.token || this.config.token
    const res = await fetch(`${this.apiBase}/users/search?maxResults=50`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return []
    const data = await res.json()
    return data
      .filter(u => u.accountType === 'atlassian')
      .map(u => ({ id: u.accountId, name: u.displayName, email: u.emailAddress, avatar: u.avatarUrls?.['48x48'] }))
  }

  // --- Config ---

  getSetupSchema() {
    return {
      type: 'object',
      required: ['clientId', 'clientSecret'],
      properties: {
        clientId: { type: 'string', title: 'OAuth Client ID' },
        clientSecret: { type: 'string', title: 'OAuth Client Secret', format: 'password' },
        siteName: { type: 'string', title: 'Jira Site Name (e.g. myteam for myteam.atlassian.net)' },
        project: { type: 'string', title: 'Default Project Key (e.g. BUG)' },
      },
    }
  }

  async testConnection(options = {}) {
    const token = options.token || this.config.token
    try {
      const res = await fetch(`${this.apiBase}/myself`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
      const user = await res.json()
      return { ok: true, user: user.displayName }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  }

  // --- ADF (Atlassian Document Format) helper ---

  buildAdf(card, frames, baseUrl) {
    const content = []

    // Summary
    if (card.summary) {
      content.push({ type: 'paragraph', content: [{ type: 'text', text: card.summary }] })
    }

    // Description
    if (card.description) {
      content.push(
        { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Description' }] },
        ...this.markdownToAdfBlocks(card.description),
      )
    }

    // Screenshots
    if (frames.length > 0 && baseUrl) {
      content.push(
        { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Screenshots' }] },
      )
      for (const f of frames) {
        const url = `${baseUrl}/api/recordings/${f.recording_id}/frames/${f.filename}`
        content.push({
          type: 'mediaSingle',
          attrs: { layout: 'center' },
          content: [{
            type: 'media',
            attrs: { type: 'external', url },
          }],
        })
      }
    }

    return { type: 'doc', version: 1, content }
  }

  markdownToAdfBlocks(text) {
    const blocks = []
    const lines = text.split('\n')
    let listItems = []

    const flushList = () => {
      if (listItems.length > 0) {
        blocks.push({
          type: 'bulletList',
          content: listItems.map(item => ({
            type: 'listItem',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: item }] }],
          })),
        })
        listItems = []
      }
    }

    for (const line of lines) {
      if (line.startsWith('## ') || line.startsWith('### ')) {
        flushList()
        const level = line.startsWith('### ') ? 3 : 2
        const heading = line.replace(/^#{2,3}\s+/, '')
        blocks.push({ type: 'heading', attrs: { level }, content: [{ type: 'text', text: heading }] })
      } else if (line.startsWith('- ') || line.startsWith('* ')) {
        listItems.push(line.replace(/^[-*]\s+/, ''))
      } else if (line.trim() === '') {
        flushList()
      } else {
        flushList()
        blocks.push({ type: 'paragraph', content: [{ type: 'text', text: line }] })
      }
    }
    flushList()
    return blocks
  }
}
