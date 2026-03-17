import { TrackerIntegration } from './base.js';
import fetch from 'node-fetch';
import https from 'https';
import FormData from 'form-data';
import fs from 'fs';

/**
 * YouTrack integration for BugReel.
 * Wraps the YouTrack REST API for issue creation, search, comments, and attachments.
 */
export class YouTrackIntegration extends TrackerIntegration {
  name = 'youtrack'
  displayName = 'YouTrack'
  supportsOAuth = false
  supportsAttachments = true

  constructor(config) {
    super(config)
    // config expects: { url, token, project }
  }

  /** Check if URL and token are configured */
  isConfigured() {
    return !!(this.config.url && this.config.token)
  }

  // === Issue Management ===

  /**
   * Create an issue from a BugReel card.
   * @param {object} card - Card data (title, description, type, etc.)
   * @param {object[]} frames - Frame objects for screenshot embedding
   * @param {object} options - { reporterId, project, dashboardUrl }
   * @returns {{ id, url, key } | null}
   */
  async createIssue(card, frames = [], options = {}) {
    if (!this.isConfigured()) {
      console.log('[YouTrack] Not configured, skipping')
      return null
    }

    const body = {
      project: { shortName: options.project || this.config.project },
      summary: card.title || 'Untitled',
      description: card.description || '',
    }

    if (options.reporterId) {
      body.reporter = { id: options.reporterId }
    }

    let res
    try {
      res = await fetch(`${this.config.url}/api/issues?fields=id,idReadable,reporter(login,name)`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })
    } catch (err) {
      console.error(`[YouTrack] Request failed: ${err.message}`)
      return null
    }

    if (!res.ok) {
      const errBody = await res.text().catch(() => '')
      console.error(`[YouTrack] Error ${res.status}: ${errBody}`)
      return null
    }

    const issue = await res.json()
    const key = issue.idReadable || issue.id

    return {
      id: issue.id,
      url: `${this.config.url}/issue/${key}`,
      key,
      raw: issue,
    }
  }

  /**
   * Search issues by query string.
   * @param {string} query - YouTrack query
   * @param {object} options - { top }
   * @returns {Array<{ id, key, summary, url }>}
   */
  async searchIssues(query, options = {}) {
    if (!this.isConfigured()) return []

    const top = options.top || 20
    const params = new URLSearchParams({
      query,
      fields: 'id,idReadable,summary,resolved,customFields(name,value(name))',
      $top: String(top),
    })

    let res
    try {
      res = await fetch(`${this.config.url}/api/issues?${params}`, {
        headers: {
          'Authorization': `Bearer ${this.config.token}`,
        },
      })
    } catch (err) {
      console.error(`[YouTrack] Search failed: ${err.message}`)
      return []
    }

    if (!res.ok) {
      const errBody = await res.text().catch(() => '')
      console.error(`[YouTrack] Search error ${res.status}: ${errBody}`)
      return []
    }

    const issues = await res.json()
    return (issues || []).map(issue => ({
      id: issue.id,
      key: issue.idReadable,
      summary: issue.summary,
      url: `${this.config.url}/issue/${issue.idReadable}`,
      resolved: !!issue.resolved,
      customFields: issue.customFields,
      raw: issue,
    }))
  }

  /**
   * Add a comment to an existing issue.
   * @param {string} issueId - Issue ID or readable ID
   * @param {string} text - Comment text (markdown)
   * @returns {object|null}
   */
  async addComment(issueId, text) {
    if (!this.isConfigured()) return null

    let res
    try {
      res = await fetch(`${this.config.url}/api/issues/${issueId}/comments`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text }),
      })
    } catch (err) {
      console.error(`[YouTrack] Comment failed: ${err.message}`)
      return null
    }

    if (!res.ok) {
      const errBody = await res.text().catch(() => '')
      console.error(`[YouTrack] Comment error ${res.status}: ${errBody}`)
      return null
    }

    return await res.json()
  }

  // === Attachments ===

  /**
   * Attach files to a YouTrack issue.
   * Uses native https to force HTTP/1.1 (YouTrack Cloud has HTTP/2 issues with file uploads).
   * @param {string} issueId - Issue ID
   * @param {Array<{ path: string }>} files - Array of file objects with `path` property
   * @returns {boolean}
   */
  async attachFiles(issueId, files) {
    if (!this.isConfigured()) return false

    let attached = 0
    for (const file of files) {
      const filePath = typeof file === 'string' ? file : file.path
      const result = await this._attachSingleFile(issueId, filePath)
      if (result) attached++
    }

    return attached > 0
  }

  /**
   * Attach a single file to a YouTrack issue.
   * @private
   */
  _attachSingleFile(issueId, filePath) {
    if (!fs.existsSync(filePath)) {
      console.error(`[YouTrack] File not found: ${filePath}`)
      return Promise.resolve(null)
    }

    const form = new FormData()
    form.append('file', fs.createReadStream(filePath))

    const url = new URL(`${this.config.url}/api/issues/${issueId}/attachments`)

    return new Promise((resolve) => {
      const req = https.request({
        hostname: url.hostname,
        port: 443,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.token}`,
          ...form.getHeaders(),
        },
        // Force HTTP/1.1 — YouTrack Cloud returns PROTOCOL_ERROR on HTTP/2 file uploads
        ALPNProtocols: ['http/1.1'],
      }, (res) => {
        let data = ''
        res.on('data', chunk => data += chunk)
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try { resolve(JSON.parse(data)) } catch { resolve({ ok: true }) }
          } else {
            console.error(`[YouTrack] Attachment error ${res.statusCode}: ${data.substring(0, 200)}`)
            resolve(null)
          }
        })
      })

      req.on('error', (err) => {
        console.error(`[YouTrack] Attachment failed: ${err.message}`)
        resolve(null)
      })

      req.setTimeout(60000, () => {
        console.error('[YouTrack] Attachment timeout')
        req.destroy()
        resolve(null)
      })

      form.pipe(req)
    })
  }

  // === Configuration ===

  getSetupSchema() {
    return {
      type: 'object',
      required: ['url', 'token'],
      properties: {
        url: {
          type: 'string',
          title: 'YouTrack URL',
          description: 'Base URL of your YouTrack instance (e.g. https://myteam.youtrack.cloud)',
        },
        token: {
          type: 'string',
          title: 'Permanent Token',
          description: 'YouTrack permanent token for API access',
          format: 'password',
        },
        project: {
          type: 'string',
          title: 'Default Project',
          description: 'Default project short name for new issues (e.g. BUG)',
          default: 'BUG',
        },
      },
    }
  }

  async testConnection() {
    if (!this.isConfigured()) {
      return { ok: false, error: 'URL and token are required' }
    }

    try {
      const res = await fetch(`${this.config.url}/api/admin/projects?fields=id,shortName,name&$top=1`, {
        headers: {
          'Authorization': `Bearer ${this.config.token}`,
        },
      })

      if (!res.ok) {
        const errBody = await res.text().catch(() => '')
        return { ok: false, error: `HTTP ${res.status}: ${errBody.substring(0, 200)}` }
      }

      const projects = await res.json()
      return { ok: true, message: `Connected. ${projects.length > 0 ? `Found project: ${projects[0].name}` : 'No projects found.'}` }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  }

  async getProjects() {
    if (!this.isConfigured()) return []

    try {
      const res = await fetch(`${this.config.url}/api/admin/projects?fields=id,shortName,name&$top=100`, {
        headers: {
          'Authorization': `Bearer ${this.config.token}`,
        },
      })

      if (!res.ok) return []

      const projects = await res.json()
      return (projects || []).map(p => ({
        id: p.id,
        key: p.shortName,
        name: p.name,
      }))
    } catch {
      return []
    }
  }
}
