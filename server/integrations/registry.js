import { YouTrackIntegration } from './youtrack.js'
import { JiraIntegration } from './jira.js'
import { LinearIntegration } from './linear.js'
import { GitHubIntegration } from './github.js'
import { WebhookIntegration } from './webhook.js'

/**
 * Integration registry.
 * Maps integration names to their classes.
 * Add new integrations here (or via registerIntegration at runtime).
 */
const INTEGRATIONS = {
  youtrack: YouTrackIntegration,
  jira: JiraIntegration,
  linear: LinearIntegration,
  github: GitHubIntegration,
  webhook: WebhookIntegration,
}

/**
 * Get an integration instance by name.
 * @param {string} name - Integration identifier (e.g. 'youtrack', 'jira', 'webhook')
 * @param {object} config - Configuration object passed to the integration constructor
 * @returns {TrackerIntegration}
 */
export function getIntegration(name, config) {
  const Cls = INTEGRATIONS[name]
  if (!Cls) throw new Error(`Unknown integration: ${name}`)
  return new Cls(config)
}

/**
 * List all registered integrations with their metadata.
 * @returns {Array<{ name, displayName, supportsOAuth, supportsAttachments }>}
 */
export function listIntegrations() {
  return Object.entries(INTEGRATIONS).map(([name, Cls]) => {
    const instance = new Cls({})
    return {
      name,
      displayName: instance.displayName,
      supportsOAuth: instance.supportsOAuth,
      supportsAttachments: instance.supportsAttachments,
    }
  })
}

/**
 * Register a new integration at runtime.
 * @param {string} name - Integration identifier
 * @param {typeof TrackerIntegration} cls - Integration class
 */
export function registerIntegration(name, cls) {
  INTEGRATIONS[name] = cls
}
