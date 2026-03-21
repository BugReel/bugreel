import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JiraIntegration } from '../../integrations/jira.js';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

const defaultConfig = {
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
  cloudId: 'cloud-123',
  siteName: 'myteam',
  project: 'BUG',
  token: 'test-token',
};

describe('JiraIntegration — Properties', () => {
  it('has correct name and displayName', () => {
    const jira = new JiraIntegration(defaultConfig);
    expect(jira.name).toBe('jira');
    expect(jira.displayName).toBe('Jira Cloud');
  });

  it('supports OAuth and attachments', () => {
    const jira = new JiraIntegration(defaultConfig);
    expect(jira.supportsOAuth).toBe(true);
    expect(jira.supportsAttachments).toBe(true);
  });

  it('apiBase uses cloudId', () => {
    const jira = new JiraIntegration(defaultConfig);
    expect(jira.apiBase).toBe('https://api.atlassian.com/ex/jira/cloud-123/rest/api/3');
  });

  it('siteUrl uses baseUrl if provided', () => {
    const jira = new JiraIntegration({ ...defaultConfig, baseUrl: 'https://custom.atlassian.net' });
    expect(jira.siteUrl).toBe('https://custom.atlassian.net');
  });

  it('siteUrl falls back to siteName', () => {
    const jira = new JiraIntegration({ ...defaultConfig, baseUrl: undefined });
    expect(jira.siteUrl).toBe('https://myteam.atlassian.net');
  });
});

describe('JiraIntegration — OAuth', () => {
  it('getOAuthURL builds correct authorization URL', () => {
    const jira = new JiraIntegration(defaultConfig);
    const result = jira.getOAuthURL('https://app.com/callback', 'state-xyz');
    expect(result.url).toContain('https://auth.atlassian.com/authorize?');
    expect(result.url).toContain('client_id=test-client-id');
    expect(result.url).toContain('redirect_uri=');
    expect(result.url).toContain('response_type=code');
    expect(result.url).toContain('scope=');
    expect(result.url).toContain('offline_access');
    expect(result.state).toBe('state-xyz');
  });
});

describe('JiraIntegration — Issue Payload', () => {
  it('createIssue builds correct fields for a bug', async () => {
    const jira = new JiraIntegration(defaultConfig);
    let capturedBody;

    mockFetch.mockImplementation(async (url, opts) => {
      if (url.includes('/issue') && opts?.method === 'POST') {
        capturedBody = JSON.parse(opts.body);
        return { ok: true, json: async () => ({ id: '10001', key: 'BUG-42' }) };
      }
      return { ok: true, json: async () => ({}) };
    });

    const card = { title: 'Login button broken', type: 'bug', priority: 'high', description: 'Cannot click' };
    await jira.createIssue(card, [], { token: 'tok' });

    expect(capturedBody.fields.project.key).toBe('BUG');
    expect(capturedBody.fields.summary).toBe('Login button broken');
    expect(capturedBody.fields.issuetype.name).toBe('Bug');
    expect(capturedBody.fields.priority.name).toBe('High');
  });

  it('createIssue maps feature type to Story', async () => {
    const jira = new JiraIntegration(defaultConfig);
    let capturedBody;

    mockFetch.mockImplementation(async (url, opts) => {
      if (opts?.method === 'POST') {
        capturedBody = JSON.parse(opts.body);
        return { ok: true, json: async () => ({ id: '10002', key: 'BUG-43' }) };
      }
      return { ok: true, json: async () => ({}) };
    });

    const card = { title: 'Add dark mode', type: 'feature' };
    await jira.createIssue(card, []);

    expect(capturedBody.fields.issuetype.name).toBe('Story');
  });

  it('createIssue maps all priority levels', async () => {
    const jira = new JiraIntegration(defaultConfig);
    const priorities = { critical: 'Highest', high: 'High', medium: 'Medium', low: 'Low' };

    for (const [input, expected] of Object.entries(priorities)) {
      let capturedBody;
      mockFetch.mockImplementation(async (url, opts) => {
        if (opts?.method === 'POST') {
          capturedBody = JSON.parse(opts.body);
          return { ok: true, json: async () => ({ id: '1', key: 'BUG-1' }) };
        }
        return { ok: true, json: async () => ({}) };
      });

      await jira.createIssue({ title: 'test', priority: input }, []);
      expect(capturedBody.fields.priority.name).toBe(expected);
    }
  });

  it('createIssue returns id, url, key', async () => {
    const jira = new JiraIntegration(defaultConfig);

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: '10001', key: 'BUG-42' }),
    });

    const result = await jira.createIssue({ title: 'Test' }, []);
    expect(result.id).toBe('10001');
    expect(result.key).toBe('BUG-42');
    expect(result.url).toBe('https://myteam.atlassian.net/browse/BUG-42');
  });

  it('createIssue uses Untitled when no title', async () => {
    const jira = new JiraIntegration(defaultConfig);
    let capturedBody;

    mockFetch.mockImplementation(async (url, opts) => {
      if (opts?.method === 'POST') {
        capturedBody = JSON.parse(opts.body);
        return { ok: true, json: async () => ({ id: '1', key: 'BUG-1' }) };
      }
      return { ok: true, json: async () => ({}) };
    });

    await jira.createIssue({}, []);
    expect(capturedBody.fields.summary).toBe('Untitled');
  });
});

describe('JiraIntegration — ADF Builder', () => {
  it('buildAdf includes summary as paragraph', () => {
    const jira = new JiraIntegration(defaultConfig);
    const card = { summary: 'User cannot log in' };
    const adf = jira.buildAdf(card, [], 'https://app.com');

    expect(adf.type).toBe('doc');
    expect(adf.version).toBe(1);
    const textContent = adf.content[0];
    expect(textContent.type).toBe('paragraph');
    expect(textContent.content[0].text).toBe('User cannot log in');
  });

  it('buildAdf includes screenshot media nodes', () => {
    const jira = new JiraIntegration(defaultConfig);
    const frames = [
      { recording_id: 'rec-1', filename: 'frame001.jpg', description: 'Error page' },
    ];
    const adf = jira.buildAdf({}, frames, 'https://app.com');

    const mediaSingle = adf.content.find(n => n.type === 'mediaSingle');
    expect(mediaSingle).toBeTruthy();
    expect(mediaSingle.content[0].attrs.url).toBe('https://app.com/api/recordings/rec-1/frames/frame001.jpg');
  });

  it('markdownToAdfBlocks handles headings, lists, paragraphs', () => {
    const jira = new JiraIntegration(defaultConfig);
    const md = '## Steps\n- Step 1\n- Step 2\n\nSome text\n### Details\nMore info';
    const blocks = jira.markdownToAdfBlocks(md);

    const heading2 = blocks.find(b => b.type === 'heading' && b.attrs.level === 2);
    expect(heading2).toBeTruthy();
    expect(heading2.content[0].text).toBe('Steps');

    const bulletList = blocks.find(b => b.type === 'bulletList');
    expect(bulletList).toBeTruthy();
    expect(bulletList.content).toHaveLength(2);

    const heading3 = blocks.find(b => b.type === 'heading' && b.attrs.level === 3);
    expect(heading3).toBeTruthy();
    expect(heading3.content[0].text).toBe('Details');
  });
});

describe('JiraIntegration — Search', () => {
  it('searchIssues builds JQL with escaped quotes', async () => {
    const jira = new JiraIntegration(defaultConfig);
    let capturedUrl;

    mockFetch.mockImplementation(async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ({
          issues: [{ id: '1', key: 'BUG-1', fields: { summary: 'Test issue' } }],
        }),
      };
    });

    const results = await jira.searchIssues('login "error"');
    expect(capturedUrl).toContain('text');
    expect(capturedUrl).toContain('maxResults=20');
    expect(results).toHaveLength(1);
    expect(results[0].key).toBe('BUG-1');
    expect(results[0].summary).toBe('Test issue');
    expect(results[0].url).toContain('/browse/BUG-1');
  });
});

describe('JiraIntegration — Setup Schema', () => {
  it('getSetupSchema requires clientId and clientSecret', () => {
    const jira = new JiraIntegration(defaultConfig);
    const schema = jira.getSetupSchema();
    expect(schema.required).toContain('clientId');
    expect(schema.required).toContain('clientSecret');
    expect(schema.properties.siteName).toBeDefined();
    expect(schema.properties.project).toBeDefined();
  });
});
