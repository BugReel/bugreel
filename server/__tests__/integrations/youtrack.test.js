import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock node-fetch before importing YouTrackIntegration
vi.mock('node-fetch', () => ({
  default: vi.fn(),
}));

// Mock form-data
vi.mock('form-data', () => ({
  default: vi.fn().mockImplementation(() => ({
    append: vi.fn(),
    getHeaders: () => ({ 'content-type': 'multipart/form-data; boundary=---' }),
    pipe: vi.fn(),
  })),
}));

// Mock fs
vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: vi.fn().mockReturnValue(true),
      createReadStream: vi.fn().mockReturnValue('mock-stream'),
      mkdirSync: actual.mkdirSync,
      rmSync: actual.rmSync,
    },
    existsSync: vi.fn().mockReturnValue(true),
    createReadStream: vi.fn().mockReturnValue('mock-stream'),
  };
});

const { default: fetch } = await import('node-fetch');
const { YouTrackIntegration } = await import('../../integrations/youtrack.js');

beforeEach(() => {
  fetch.mockReset();
});

const defaultConfig = {
  url: 'https://myteam.youtrack.cloud',
  token: 'perm:abc123',
  project: 'BUG',
};

describe('YouTrackIntegration — Properties', () => {
  it('has correct name and displayName', () => {
    const yt = new YouTrackIntegration(defaultConfig);
    expect(yt.name).toBe('youtrack');
    expect(yt.displayName).toBe('YouTrack');
  });

  it('does not support OAuth', () => {
    const yt = new YouTrackIntegration(defaultConfig);
    expect(yt.supportsOAuth).toBe(false);
  });

  it('supports attachments', () => {
    const yt = new YouTrackIntegration(defaultConfig);
    expect(yt.supportsAttachments).toBe(true);
  });
});

describe('YouTrackIntegration — isConfigured', () => {
  it('returns true when url and token are set', () => {
    const yt = new YouTrackIntegration(defaultConfig);
    expect(yt.isConfigured()).toBe(true);
  });

  it('returns false when url is missing', () => {
    const yt = new YouTrackIntegration({ token: 'abc' });
    expect(yt.isConfigured()).toBe(false);
  });

  it('returns false when token is missing', () => {
    const yt = new YouTrackIntegration({ url: 'https://yt.example.com' });
    expect(yt.isConfigured()).toBe(false);
  });

  it('returns false when both are missing', () => {
    const yt = new YouTrackIntegration({});
    expect(yt.isConfigured()).toBe(false);
  });
});

describe('YouTrackIntegration — Issue Creation', () => {
  it('createIssue posts to correct API endpoint', async () => {
    const yt = new YouTrackIntegration(defaultConfig);
    let capturedUrl, capturedBody;

    fetch.mockImplementation(async (url, opts) => {
      capturedUrl = url;
      capturedBody = JSON.parse(opts.body);
      return {
        ok: true,
        json: async () => ({ id: 'yt-1', idReadable: 'BUG-42' }),
      };
    });

    const result = await yt.createIssue({ title: 'Test bug', description: 'Desc' }, []);

    expect(capturedUrl).toContain('https://myteam.youtrack.cloud/api/issues');
    expect(capturedUrl).toContain('fields=id,idReadable');
    expect(capturedBody.project.shortName).toBe('BUG');
    expect(capturedBody.summary).toBe('Test bug');
    expect(capturedBody.description).toBe('Desc');
    expect(result.id).toBe('yt-1');
    expect(result.key).toBe('BUG-42');
    expect(result.url).toBe('https://myteam.youtrack.cloud/issue/BUG-42');
  });

  it('createIssue includes reporterId when provided', async () => {
    const yt = new YouTrackIntegration(defaultConfig);
    let capturedBody;

    fetch.mockImplementation(async (url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return { ok: true, json: async () => ({ id: '1', idReadable: 'BUG-1' }) };
    });

    await yt.createIssue({ title: 'Bug' }, [], { reporterId: 'user-42' });
    expect(capturedBody.reporter.id).toBe('user-42');
  });

  it('createIssue uses project from options over config', async () => {
    const yt = new YouTrackIntegration(defaultConfig);
    let capturedBody;

    fetch.mockImplementation(async (url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return { ok: true, json: async () => ({ id: '1', idReadable: 'FEAT-1' }) };
    });

    await yt.createIssue({ title: 'Feature' }, [], { project: 'FEAT' });
    expect(capturedBody.project.shortName).toBe('FEAT');
  });

  it('createIssue returns null when not configured', async () => {
    const yt = new YouTrackIntegration({});
    const result = await yt.createIssue({ title: 'Test' }, []);
    expect(result).toBeNull();
  });

  it('createIssue returns null on API error', async () => {
    const yt = new YouTrackIntegration(defaultConfig);

    fetch.mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => 'Bad Request',
    });

    const result = await yt.createIssue({ title: 'Test' }, []);
    expect(result).toBeNull();
  });

  it('createIssue returns null on network error', async () => {
    const yt = new YouTrackIntegration(defaultConfig);
    fetch.mockRejectedValue(new Error('Network error'));

    const result = await yt.createIssue({ title: 'Test' }, []);
    expect(result).toBeNull();
  });
});

describe('YouTrackIntegration — Search', () => {
  it('searchIssues builds query params correctly', async () => {
    const yt = new YouTrackIntegration(defaultConfig);
    let capturedUrl;

    fetch.mockImplementation(async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ([
          { id: 'yt-1', idReadable: 'BUG-1', summary: 'First', resolved: null, customFields: [] },
          { id: 'yt-2', idReadable: 'BUG-2', summary: 'Second', resolved: 12345, customFields: [] },
        ]),
      };
    });

    const results = await yt.searchIssues('#Unresolved', { top: 10 });

    expect(capturedUrl).toContain('query=%23Unresolved');
    expect(capturedUrl).toContain('%24top=10');
    expect(results).toHaveLength(2);
    expect(results[0].key).toBe('BUG-1');
    expect(results[0].resolved).toBe(false);
    expect(results[1].resolved).toBe(true);
    expect(results[0].url).toBe('https://myteam.youtrack.cloud/issue/BUG-1');
  });

  it('searchIssues returns empty when not configured', async () => {
    const yt = new YouTrackIntegration({});
    const results = await yt.searchIssues('test');
    expect(results).toEqual([]);
  });
});

describe('YouTrackIntegration — Comments', () => {
  it('addComment posts to correct endpoint', async () => {
    const yt = new YouTrackIntegration(defaultConfig);
    let capturedUrl, capturedBody;

    fetch.mockImplementation(async (url, opts) => {
      capturedUrl = url;
      capturedBody = JSON.parse(opts.body);
      return { ok: true, json: async () => ({ id: 'comment-1' }) };
    });

    const result = await yt.addComment('BUG-42', 'This is fixed');
    expect(capturedUrl).toBe('https://myteam.youtrack.cloud/api/issues/BUG-42/comments');
    expect(capturedBody.text).toBe('This is fixed');
    expect(result).toEqual({ id: 'comment-1' });
  });

  it('addComment returns null when not configured', async () => {
    const yt = new YouTrackIntegration({});
    const result = await yt.addComment('BUG-1', 'text');
    expect(result).toBeNull();
  });
});

describe('YouTrackIntegration — Setup Schema', () => {
  it('requires url and token', () => {
    const yt = new YouTrackIntegration(defaultConfig);
    const schema = yt.getSetupSchema();
    expect(schema.required).toContain('url');
    expect(schema.required).toContain('token');
    expect(schema.properties.project).toBeDefined();
    expect(schema.properties.project.default).toBe('BUG');
  });
});
