/**
 * Base class for tracker integrations.
 * Each integration implements this interface.
 */
export class TrackerIntegration {
  /** Integration identifier (e.g. 'jira', 'linear', 'youtrack') */
  name = 'base'

  /** Display name for UI */
  displayName = 'Base'

  /** Whether this integration supports OAuth for user auth */
  supportsOAuth = false

  /** Whether this integration can attach files to issues */
  supportsAttachments = false

  constructor(config) {
    this.config = config
  }

  // === OAuth (for user authentication) ===

  /** Get OAuth authorization URL. Returns { url, state } */
  getOAuthURL(redirectUri, state) {
    throw new Error('OAuth not supported by this integration')
  }

  /** Handle OAuth callback. Returns { user: { id, name, email, avatar }, tokens: { access, refresh } } */
  async handleOAuthCallback(code, redirectUri) {
    throw new Error('OAuth not supported by this integration')
  }

  /** Refresh expired OAuth token. Returns { access_token, refresh_token? } */
  async refreshToken(refreshToken) {
    throw new Error('OAuth not supported by this integration')
  }

  // === Issue Management ===

  /** Create an issue from a BugReel card. Returns { id, url, key } */
  async createIssue(card, frames, options = {}) {
    throw new Error('createIssue not implemented')
  }

  /** Search issues by query string. Returns [{ id, key, summary, url }] */
  async searchIssues(query, options = {}) {
    throw new Error('searchIssues not implemented')
  }

  /** Add a comment to an issue */
  async addComment(issueId, text) {
    throw new Error('addComment not implemented')
  }

  // === Attachments ===

  /** Attach screenshot files to an issue. Returns boolean */
  async attachFiles(issueId, files) {
    if (!this.supportsAttachments) return false
    throw new Error('attachFiles not implemented')
  }

  /** Generate markdown for embedded screenshots (fallback when no attachment API) */
  embedScreenshotLinks(frames, baseUrl) {
    return frames.map(f =>
      `![${f.description || 'Screenshot'}](${baseUrl}/api/recordings/${f.recording_id}/frames/${f.filename})`
    ).join('\n')
  }

  // === Team ===

  /** List available projects. Returns [{ id, key, name }] */
  async getProjects() { return [] }

  /** List team members. Returns [{ id, name, email, avatar }] */
  async getUsers() { return [] }

  // === Configuration ===

  /** JSON Schema describing configuration fields for setup UI */
  getSetupSchema() {
    return { type: 'object', properties: {} }
  }

  /** Validate that the integration is properly configured */
  async testConnection() {
    return { ok: false, error: 'Not implemented' }
  }
}
