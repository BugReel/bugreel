import crypto from 'crypto'
import { TrackerIntegration } from './base.js'

/**
 * Linear integration via GraphQL API + OAuth 2.0 with PKCE.
 * No client secret needed — uses code_challenge/code_verifier flow.
 */
export class LinearIntegration extends TrackerIntegration {
  name = 'linear'
  displayName = 'Linear'
  supportsOAuth = true
  supportsAttachments = false // use embedded image links

  constructor(config) {
    super(config)
    // config: { clientId }
  }

  // --- GraphQL helper ---

  async graphql(query, variables, token) {
    const res = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    })
    const data = await res.json()
    if (data.errors) throw new Error(data.errors[0].message)
    return data.data
  }

  // --- OAuth 2.0 with PKCE ---

  getOAuthURL(redirectUri, state) {
    const codeVerifier = crypto.randomBytes(32).toString('base64url')
    const codeChallenge = crypto
      .createHash('sha256')
      .update(codeVerifier)
      .digest('base64url')

    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'read,write,issues:create',
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    })

    return {
      url: `https://linear.app/oauth/authorize?${params}`,
      state,
      codeVerifier,
    }
  }

  async handleOAuthCallback(code, redirectUri, codeVerifier) {
    // Exchange authorization code for access token
    const tokenRes = await fetch('https://api.linear.app/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: this.config.clientId,
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      }),
    })
    if (!tokenRes.ok) {
      const err = await tokenRes.text()
      throw new Error(`Token exchange failed (${tokenRes.status}): ${err}`)
    }
    const tokens = await tokenRes.json()

    // Fetch authenticated user profile
    const data = await this.graphql(
      `query { viewer { id name email avatarUrl } }`,
      {},
      tokens.access_token,
    )

    return {
      user: {
        id: data.viewer.id,
        name: data.viewer.name,
        email: data.viewer.email,
        avatar: data.viewer.avatarUrl,
      },
      tokens: {
        access: tokens.access_token,
        refresh: tokens.refresh_token || null,
      },
    }
  }

  async refreshToken(refreshToken) {
    const res = await fetch('https://api.linear.app/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        client_id: this.config.clientId,
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
    const teamId = options.teamId || this.config.teamId

    if (!teamId) throw new Error('teamId is required to create a Linear issue')

    // Build markdown description
    let description = ''
    if (card.summary) description += `${card.summary}\n\n`
    if (card.description) description += `${card.description}\n\n`

    // Embed screenshot links (Linear supports markdown images)
    if (frames.length > 0 && options.baseUrl) {
      description += '## Screenshots\n\n'
      description += this.embedScreenshotLinks(frames, options.baseUrl)
      description += '\n'
    }

    // Map priority: Linear uses 0=none, 1=urgent, 2=high, 3=medium, 4=low
    let priority = 0
    if (card.priority) {
      const priorityMap = { critical: 1, urgent: 1, high: 2, medium: 3, low: 4 }
      priority = priorityMap[card.priority] || 0
    }

    const input = {
      teamId,
      title: card.title || 'Untitled',
      description: description.trim(),
      priority,
    }

    if (options.assigneeId) input.assigneeId = options.assigneeId

    const data = await this.graphql(
      `mutation IssueCreate($input: IssueCreateInput!) {
        issueCreate(input: $input) {
          success
          issue {
            id
            identifier
            title
            url
          }
        }
      }`,
      { input },
      token,
    )

    if (!data.issueCreate.success) {
      throw new Error('Linear issue creation failed')
    }

    const issue = data.issueCreate.issue
    return {
      id: issue.id,
      url: issue.url,
      key: issue.identifier,
    }
  }

  async searchIssues(query, options = {}) {
    const token = options.token || this.config.token

    const data = await this.graphql(
      `query SearchIssues($query: String!) {
        searchIssues(term: $query, first: 20) {
          nodes {
            id
            identifier
            title
            url
          }
        }
      }`,
      { query },
      token,
    )

    return (data.searchIssues.nodes || []).map(issue => ({
      id: issue.id,
      key: issue.identifier,
      summary: issue.title,
      url: issue.url,
    }))
  }

  async addComment(issueId, text, options = {}) {
    const token = options.token || this.config.token

    const data = await this.graphql(
      `mutation CommentCreate($input: CommentCreateInput!) {
        commentCreate(input: $input) {
          success
        }
      }`,
      { input: { issueId, body: text } },
      token,
    )

    return data.commentCreate.success
  }

  // --- Team ---

  async getProjects(options = {}) {
    const token = options.token || this.config.token

    const data = await this.graphql(
      `query {
        teams {
          nodes {
            id
            key
            name
          }
        }
      }`,
      {},
      token,
    )

    return (data.teams.nodes || []).map(team => ({
      id: team.id,
      key: team.key,
      name: team.name,
    }))
  }

  async getUsers(options = {}) {
    const token = options.token || this.config.token

    const data = await this.graphql(
      `query {
        users {
          nodes {
            id
            name
            email
            avatarUrl
          }
        }
      }`,
      {},
      token,
    )

    return (data.users.nodes || []).map(user => ({
      id: user.id,
      name: user.name,
      email: user.email,
      avatar: user.avatarUrl,
    }))
  }

  // --- Configuration ---

  getSetupSchema() {
    return {
      type: 'object',
      required: ['clientId'],
      properties: {
        clientId: {
          type: 'string',
          title: 'OAuth Client ID',
          description: 'Linear OAuth application client ID. No client secret needed (PKCE flow).',
        },
        teamId: {
          type: 'string',
          title: 'Default Team ID',
          description: 'Default team for new issues (retrieve via getProjects after connecting).',
        },
      },
    }
  }

  async testConnection(options = {}) {
    const token = options.token || this.config.token
    if (!token) return { ok: false, error: 'No access token configured' }

    try {
      const data = await this.graphql(
        `query { viewer { id name } }`,
        {},
        token,
      )
      return { ok: true, user: data.viewer.name }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  }
}
