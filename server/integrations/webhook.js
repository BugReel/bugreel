import crypto from 'crypto'
import { TrackerIntegration } from './base.js'

/**
 * Webhook integration for BugReel.
 * POSTs card data as JSON to a configured URL.
 */
export class WebhookIntegration extends TrackerIntegration {
  name = 'webhook'
  displayName = 'Webhook'
  supportsOAuth = false
  supportsAttachments = false

  constructor(config) {
    super(config)
    // config expects: { webhookUrl, webhookSecret? }
  }

  /**
   * Sign a payload with HMAC-SHA256 using the configured secret.
   * @param {string} payload - JSON string to sign
   * @returns {string} hex digest
   * @private
   */
  _sign(payload) {
    return crypto
      .createHmac('sha256', this.config.webhookSecret)
      .update(payload)
      .digest('hex')
  }

  /**
   * Build common headers for webhook requests.
   * Adds X-BugReel-Signature if webhookSecret is configured.
   * @param {string} body - JSON string payload
   * @returns {object} headers
   * @private
   */
  _buildHeaders(body) {
    const headers = { 'Content-Type': 'application/json' }
    if (this.config.webhookSecret) {
      headers['X-BugReel-Signature'] = this._sign(body)
    }
    return headers
  }

  /**
   * Create an issue by POSTing card data to the webhook URL.
   * @param {object} card - Card data (title, description, summary, type, priority, etc.)
   * @param {object[]} frames - Frame objects for screenshot URLs
   * @param {object} options - { baseUrl }
   * @returns {{ id: string, url: null, key: null }}
   */
  async createIssue(card, frames = [], options = {}) {
    if (!this.config.webhookUrl) {
      throw new Error('Webhook URL is not configured')
    }

    const frameUrls = frames.map(f => {
      const base = options.baseUrl || ''
      return {
        url: `${base}/api/recordings/${f.recording_id}/frames/${f.filename}`,
        description: f.description || '',
        time: f.time_seconds,
      }
    })

    const payload = {
      event: 'issue_created',
      title: card.title || 'Untitled',
      description: card.description || '',
      summary: card.summary || '',
      type: card.type || 'bug',
      priority: card.priority || 'medium',
      frames: frameUrls,
    }

    const body = JSON.stringify(payload)
    const headers = this._buildHeaders(body)

    const res = await fetch(this.config.webhookUrl, {
      method: 'POST',
      headers,
      body,
    })

    if (!res.ok) {
      const errBody = await res.text().catch(() => '')
      throw new Error(`Webhook POST failed (${res.status}): ${errBody.substring(0, 200)}`)
    }

    return { id: 'sent', url: null, key: null }
  }

  /**
   * Search is not supported for webhooks.
   * @returns {Array}
   */
  async searchIssues() {
    return []
  }

  /**
   * Add a comment by POSTing a comment event to the webhook URL.
   * @param {string} issueId - Issue identifier
   * @param {string} text - Comment text
   */
  async addComment(issueId, text) {
    if (!this.config.webhookUrl) {
      throw new Error('Webhook URL is not configured')
    }

    const payload = { event: 'comment', issueId, text }
    const body = JSON.stringify(payload)
    const headers = this._buildHeaders(body)

    const res = await fetch(this.config.webhookUrl, {
      method: 'POST',
      headers,
      body,
    })

    if (!res.ok) {
      const errBody = await res.text().catch(() => '')
      throw new Error(`Webhook comment failed (${res.status}): ${errBody.substring(0, 200)}`)
    }

    return true
  }

  // === Configuration ===

  getSetupSchema() {
    return {
      type: 'object',
      required: ['webhookUrl'],
      properties: {
        webhookUrl: {
          type: 'string',
          title: 'Webhook URL',
          description: 'URL to POST card data to (must accept JSON)',
        },
        webhookSecret: {
          type: 'string',
          title: 'Secret (optional)',
          description: 'HMAC-SHA256 secret for signing payloads (sent in X-BugReel-Signature header)',
          format: 'password',
        },
      },
    }
  }

  async testConnection() {
    if (!this.config.webhookUrl) {
      return { ok: false, error: 'Webhook URL is required' }
    }

    try {
      const payload = { event: 'test', timestamp: new Date().toISOString() }
      const body = JSON.stringify(payload)
      const headers = this._buildHeaders(body)

      const res = await fetch(this.config.webhookUrl, {
        method: 'POST',
        headers,
        body,
      })

      if (!res.ok) {
        const errBody = await res.text().catch(() => '')
        return { ok: false, error: `HTTP ${res.status}: ${errBody.substring(0, 200)}` }
      }

      return { ok: true, message: `Webhook responded with ${res.status}` }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  }
}
