import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitHubIntegration } from '../../integrations/github.js';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

const defaultConfig = {
  clientId: 'gh-client-id',
  clientSecret: 'gh-client-secret',
  owner: 'octocat',
  repo: 'my-project',
  token: 'ghp_test_token',
};

describe('GitHubIntegration — Properties', () => {
  it('has correct name and displayName', () => {
    const gh = new GitHubIntegration(defaultConfig);
    expect(gh.name).toBe('github');
    expect(gh.displayName).toBe('GitHub Issues');
  });

  it('supports OAuth but not attachments', () => {
    const gh = new GitHubIntegration(defaultConfig);
    expect(gh.supportsOAuth).toBe(true);
    expect(gh.supportsAttachments).toBe(false);
  });
});

describe('GitHubIntegration — OAuth', () => {
  it('getOAuthURL builds correct GitHub authorization URL', () => {
    const gh = new GitHubIntegration(defaultConfig);
    const result = gh.getOAuthURL('https://app.com/callback', 'state-123');

    expect(result.url).toContain('https://github.com/login/oauth/authorize?');
    expect(result.url).toContain('client_id=gh-client-id');
    expect(result.url).toContain('scope=repo');
    expect(result.url).toContain('state=state-123');
    expect(result.state).toBe('state-123');
  });

  it('refreshToken throws because GitHub tokens do not expire', async () => {
    const gh = new GitHubIntegration(defaultConfig);
    await expect(gh.refreshToken('tok')).rejects.toThrow('do not expire');
  });
});

describe('GitHubIntegration — Issue Creation', () => {
  it('createIssue posts to correct API endpoint', async () => {
    const gh = new GitHubIntegration(defaultConfig);
    let capturedUrl, capturedBody;

    mockFetch.mockImplementation(async (url, opts) => {
      capturedUrl = url;
      capturedBody = JSON.parse(opts.body);
      return {
        ok: true,
        json: async () => ({ id: 101, number: 42, html_url: 'https://github.com/octocat/my-project/issues/42' }),
      };
    });

    const result = await gh.createIssue({ title: 'Bug report', description: 'Steps to reproduce' }, []);

    expect(capturedUrl).toBe('https://api.github.com/repos/octocat/my-project/issues');
    expect(capturedBody.title).toBe('Bug report');
    expect(capturedBody.body).toBe('Steps to reproduce');
    expect(capturedBody.labels).toContain('bug');
    expect(result.id).toBe(101);
    expect(result.key).toBe('#42');
    expect(result.url).toBe('https://github.com/octocat/my-project/issues/42');
  });

  it('createIssue embeds screenshot links in markdown body', async () => {
    const gh = new GitHubIntegration(defaultConfig);
    let capturedBody;

    mockFetch.mockImplementation(async (url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return {
        ok: true,
        json: async () => ({ id: 1, number: 1, html_url: 'https://github.com/o/r/issues/1' }),
      };
    });

    const frames = [
      { recording_id: 'rec-1', filename: 'frame001.jpg', description: 'Error dialog' },
      { recording_id: 'rec-1', filename: 'frame002.jpg', description: '' },
    ];
    await gh.createIssue({ title: 'Bug', description: 'Desc' }, frames, { baseUrl: 'https://app.com' });

    expect(capturedBody.body).toContain('## Screenshots');
    expect(capturedBody.body).toContain('![Error dialog](https://app.com/api/recordings/rec-1/frames/frame001.jpg)');
    expect(capturedBody.body).toContain('![Screenshot](https://app.com/api/recordings/rec-1/frames/frame002.jpg)');
  });

  it('createIssue uses Untitled when no title provided', async () => {
    const gh = new GitHubIntegration(defaultConfig);
    let capturedBody;

    mockFetch.mockImplementation(async (url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return {
        ok: true,
        json: async () => ({ id: 1, number: 1, html_url: 'https://github.com/o/r/issues/1' }),
      };
    });

    await gh.createIssue({}, []);
    expect(capturedBody.title).toBe('Untitled');
  });

  it('createIssue throws on API error', async () => {
    const gh = new GitHubIntegration(defaultConfig);

    mockFetch.mockResolvedValue({
      ok: false,
      status: 422,
      text: async () => 'Validation Failed',
    });

    await expect(gh.createIssue({ title: 'Test' }, [])).rejects.toThrow('GitHub create issue failed (422)');
  });

  it('createIssue uses owner/repo from options over config', async () => {
    const gh = new GitHubIntegration(defaultConfig);
    let capturedUrl;

    mockFetch.mockImplementation(async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ({ id: 1, number: 1, html_url: 'https://github.com/other/repo2/issues/1' }),
      };
    });

    await gh.createIssue({ title: 'Test' }, [], { owner: 'other', repo: 'repo2' });
    expect(capturedUrl).toContain('/repos/other/repo2/issues');
  });
});

describe('GitHubIntegration — Search', () => {
  it('searchIssues builds correct search query with repo scope', async () => {
    const gh = new GitHubIntegration(defaultConfig);
    let capturedUrl;

    mockFetch.mockImplementation(async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ({
          items: [
            { id: 1, number: 10, title: 'Found issue', html_url: 'https://github.com/octocat/my-project/issues/10' },
          ],
        }),
      };
    });

    const results = await gh.searchIssues('login error');
    expect(capturedUrl).toContain('search/issues');
    expect(capturedUrl).toContain('repo%3Aoctocat%2Fmy-project');
    expect(results).toHaveLength(1);
    expect(results[0].key).toBe('#10');
    expect(results[0].summary).toBe('Found issue');
  });

  it('searchIssues returns empty array on API error', async () => {
    const gh = new GitHubIntegration(defaultConfig);
    mockFetch.mockResolvedValue({ ok: false });
    const results = await gh.searchIssues('test');
    expect(results).toEqual([]);
  });
});

describe('GitHubIntegration — Comments', () => {
  it('addComment posts to correct endpoint', async () => {
    const gh = new GitHubIntegration(defaultConfig);
    let capturedUrl, capturedBody;

    mockFetch.mockImplementation(async (url, opts) => {
      capturedUrl = url;
      capturedBody = JSON.parse(opts.body);
      return { ok: true, json: async () => ({ id: 1 }) };
    });

    await gh.addComment(42, 'This is fixed', {});
    expect(capturedUrl).toBe('https://api.github.com/repos/octocat/my-project/issues/42/comments');
    expect(capturedBody.body).toBe('This is fixed');
  });

  it('addComment throws on API error', async () => {
    const gh = new GitHubIntegration(defaultConfig);
    mockFetch.mockResolvedValue({ ok: false, status: 403, text: async () => 'Forbidden' });
    await expect(gh.addComment(1, 'test')).rejects.toThrow('GitHub add comment failed (403)');
  });
});

describe('GitHubIntegration — Setup Schema', () => {
  it('requires clientId, clientSecret, owner, repo', () => {
    const gh = new GitHubIntegration(defaultConfig);
    const schema = gh.getSetupSchema();
    expect(schema.required).toContain('clientId');
    expect(schema.required).toContain('clientSecret');
    expect(schema.required).toContain('owner');
    expect(schema.required).toContain('repo');
  });
});

describe('GitHubIntegration — API Headers', () => {
  it('sends correct Accept and User-Agent headers', async () => {
    const gh = new GitHubIntegration(defaultConfig);
    let capturedHeaders;

    mockFetch.mockImplementation(async (url, opts) => {
      capturedHeaders = opts.headers;
      return {
        ok: true,
        json: async () => ({ id: 1, number: 1, html_url: 'https://github.com/o/r/issues/1' }),
      };
    });

    await gh.createIssue({ title: 'Test' }, []);
    expect(capturedHeaders['Accept']).toBe('application/vnd.github+json');
    expect(capturedHeaders['X-GitHub-Api-Version']).toBe('2022-11-28');
    expect(capturedHeaders['User-Agent']).toBe('BugReel');
    expect(capturedHeaders['Authorization']).toBe('Bearer ghp_test_token');
  });
});
