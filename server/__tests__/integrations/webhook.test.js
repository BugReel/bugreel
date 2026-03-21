import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';
import { WebhookIntegration } from '../../integrations/webhook.js';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

const defaultConfig = {
  webhookUrl: 'https://hooks.example.com/bugreel',
  webhookSecret: 'my-secret-key',
};

describe('WebhookIntegration — Properties', () => {
  it('has correct name and displayName', () => {
    const wh = new WebhookIntegration(defaultConfig);
    expect(wh.name).toBe('webhook');
    expect(wh.displayName).toBe('Webhook');
  });

  it('does not support OAuth or attachments', () => {
    const wh = new WebhookIntegration(defaultConfig);
    expect(wh.supportsOAuth).toBe(false);
    expect(wh.supportsAttachments).toBe(false);
  });
});

describe('WebhookIntegration — Payload Signing', () => {
  it('_sign produces valid HMAC-SHA256 hex digest', () => {
    const wh = new WebhookIntegration(defaultConfig);
    const payload = '{"event":"test"}';
    const signature = wh._sign(payload);

    // Verify independently
    const expected = crypto
      .createHmac('sha256', 'my-secret-key')
      .update(payload)
      .digest('hex');
    expect(signature).toBe(expected);
  });

  it('_buildHeaders includes signature when secret is configured', () => {
    const wh = new WebhookIntegration(defaultConfig);
    const body = '{"event":"test"}';
    const headers = wh._buildHeaders(body);

    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['X-BugReel-Signature']).toBeTruthy();
    expect(headers['X-BugReel-Signature']).toHaveLength(64); // SHA-256 hex = 64 chars
  });

  it('_buildHeaders omits signature when no secret', () => {
    const wh = new WebhookIntegration({ webhookUrl: 'https://hooks.example.com' });
    const body = '{"event":"test"}';
    const headers = wh._buildHeaders(body);

    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['X-BugReel-Signature']).toBeUndefined();
  });
});

describe('WebhookIntegration — Issue Creation', () => {
  it('createIssue posts correct payload structure', async () => {
    const wh = new WebhookIntegration(defaultConfig);
    let capturedUrl, capturedBody, capturedHeaders;

    mockFetch.mockImplementation(async (url, opts) => {
      capturedUrl = url;
      capturedBody = JSON.parse(opts.body);
      capturedHeaders = opts.headers;
      return { ok: true };
    });

    const card = { title: 'Bug found', description: 'Steps here', summary: 'Quick summary', type: 'bug', priority: 'high' };
    const frames = [
      { recording_id: 'rec-1', filename: 'frame001.jpg', description: 'Error state', time_seconds: 12.5 },
    ];

    const result = await wh.createIssue(card, frames, { baseUrl: 'https://app.com' });

    expect(capturedUrl).toBe('https://hooks.example.com/bugreel');
    expect(capturedBody.event).toBe('issue_created');
    expect(capturedBody.title).toBe('Bug found');
    expect(capturedBody.description).toBe('Steps here');
    expect(capturedBody.summary).toBe('Quick summary');
    expect(capturedBody.type).toBe('bug');
    expect(capturedBody.priority).toBe('high');
    expect(capturedBody.frames).toHaveLength(1);
    expect(capturedBody.frames[0].url).toBe('https://app.com/api/recordings/rec-1/frames/frame001.jpg');
    expect(capturedBody.frames[0].description).toBe('Error state');
    expect(capturedBody.frames[0].time).toBe(12.5);

    // Signature header should be present
    expect(capturedHeaders['X-BugReel-Signature']).toBeTruthy();

    expect(result).toEqual({ id: 'sent', url: null, key: null });
  });

  it('createIssue throws when webhookUrl is not configured', async () => {
    const wh = new WebhookIntegration({});
    await expect(wh.createIssue({ title: 'Test' }, [])).rejects.toThrow('Webhook URL is not configured');
  });

  it('createIssue throws on HTTP error response', async () => {
    const wh = new WebhookIntegration(defaultConfig);

    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    });

    await expect(wh.createIssue({ title: 'Test' }, [])).rejects.toThrow('Webhook POST failed (500)');
  });

  it('createIssue uses defaults for missing card fields', async () => {
    const wh = new WebhookIntegration(defaultConfig);
    let capturedBody;

    mockFetch.mockImplementation(async (url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return { ok: true };
    });

    await wh.createIssue({}, []);
    expect(capturedBody.title).toBe('Untitled');
    expect(capturedBody.description).toBe('');
    expect(capturedBody.type).toBe('bug');
    expect(capturedBody.priority).toBe('medium');
  });
});

describe('WebhookIntegration — Comments', () => {
  it('addComment posts comment event', async () => {
    const wh = new WebhookIntegration(defaultConfig);
    let capturedBody;

    mockFetch.mockImplementation(async (url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return { ok: true };
    });

    const result = await wh.addComment('issue-42', 'Fixed in v2');
    expect(capturedBody.event).toBe('comment');
    expect(capturedBody.issueId).toBe('issue-42');
    expect(capturedBody.text).toBe('Fixed in v2');
    expect(result).toBe(true);
  });

  it('addComment throws when webhookUrl is missing', async () => {
    const wh = new WebhookIntegration({});
    await expect(wh.addComment('id', 'text')).rejects.toThrow('Webhook URL is not configured');
  });
});

describe('WebhookIntegration — Search', () => {
  it('searchIssues always returns empty array', async () => {
    const wh = new WebhookIntegration(defaultConfig);
    const results = await wh.searchIssues('anything');
    expect(results).toEqual([]);
  });
});

describe('WebhookIntegration — Setup Schema', () => {
  it('requires webhookUrl', () => {
    const wh = new WebhookIntegration(defaultConfig);
    const schema = wh.getSetupSchema();
    expect(schema.required).toContain('webhookUrl');
    expect(schema.properties.webhookSecret).toBeDefined();
    expect(schema.properties.webhookSecret.format).toBe('password');
  });
});

describe('WebhookIntegration — Test Connection', () => {
  it('testConnection returns error when no URL', async () => {
    const wh = new WebhookIntegration({});
    const result = await wh.testConnection();
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Webhook URL is required');
  });

  it('testConnection sends test event and reports success', async () => {
    const wh = new WebhookIntegration(defaultConfig);
    let capturedBody;

    mockFetch.mockImplementation(async (url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return { ok: true, status: 200 };
    });

    const result = await wh.testConnection();
    expect(result.ok).toBe(true);
    expect(result.message).toContain('200');
    expect(capturedBody.event).toBe('test');
    expect(capturedBody.timestamp).toBeTruthy();
  });

  it('testConnection reports HTTP error', async () => {
    const wh = new WebhookIntegration(defaultConfig);

    mockFetch.mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => 'Forbidden',
    });

    const result = await wh.testConnection();
    expect(result.ok).toBe(false);
    expect(result.error).toContain('403');
  });
});
