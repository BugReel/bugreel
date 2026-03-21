import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LinearIntegration } from '../../integrations/linear.js';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

const defaultConfig = {
  clientId: 'linear-client-id',
  teamId: 'team-abc',
  token: 'linear-test-token',
};

describe('LinearIntegration — Properties', () => {
  it('has correct name and displayName', () => {
    const linear = new LinearIntegration(defaultConfig);
    expect(linear.name).toBe('linear');
    expect(linear.displayName).toBe('Linear');
  });

  it('supports OAuth but not attachments', () => {
    const linear = new LinearIntegration(defaultConfig);
    expect(linear.supportsOAuth).toBe(true);
    expect(linear.supportsAttachments).toBe(false);
  });
});

describe('LinearIntegration — OAuth PKCE', () => {
  it('getOAuthURL builds URL with PKCE challenge', () => {
    const linear = new LinearIntegration(defaultConfig);
    const result = linear.getOAuthURL('https://app.com/callback', 'state-abc');

    expect(result.url).toContain('https://linear.app/oauth/authorize?');
    expect(result.url).toContain('client_id=linear-client-id');
    expect(result.url).toContain('response_type=code');
    expect(result.url).toContain('code_challenge=');
    expect(result.url).toContain('code_challenge_method=S256');
    expect(result.state).toBe('state-abc');
    expect(result.codeVerifier).toBeTruthy();
    expect(result.codeVerifier.length).toBeGreaterThan(10);
  });

  it('getOAuthURL generates unique code verifiers', () => {
    const linear = new LinearIntegration(defaultConfig);
    const r1 = linear.getOAuthURL('https://app.com/cb', 's1');
    const r2 = linear.getOAuthURL('https://app.com/cb', 's2');
    expect(r1.codeVerifier).not.toBe(r2.codeVerifier);
  });

  it('getOAuthURL includes required scopes', () => {
    const linear = new LinearIntegration(defaultConfig);
    const result = linear.getOAuthURL('https://app.com/cb', 'state');
    expect(result.url).toContain('scope=');
    // URL-encoded comma: %2C
    expect(result.url).toMatch(/scope=read/);
  });
});

describe('LinearIntegration — Issue Creation', () => {
  it('createIssue sends GraphQL mutation with correct variables', async () => {
    const linear = new LinearIntegration(defaultConfig);
    let capturedBody;

    mockFetch.mockImplementation(async (url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return {
        ok: true,
        json: async () => ({
          data: {
            issueCreate: {
              success: true,
              issue: { id: 'issue-1', identifier: 'ENG-42', title: 'Bug report', url: 'https://linear.app/team/issue/ENG-42' },
            },
          },
        }),
      };
    });

    const card = { title: 'Bug report', summary: 'Cannot login', priority: 'high' };
    const result = await linear.createIssue(card, []);

    expect(capturedBody.query).toContain('mutation IssueCreate');
    expect(capturedBody.variables.input.teamId).toBe('team-abc');
    expect(capturedBody.variables.input.title).toBe('Bug report');
    expect(capturedBody.variables.input.priority).toBe(2); // high → 2
    expect(result.id).toBe('issue-1');
    expect(result.key).toBe('ENG-42');
    expect(result.url).toBe('https://linear.app/team/issue/ENG-42');
  });

  it('createIssue maps all priority levels correctly', async () => {
    const linear = new LinearIntegration(defaultConfig);
    const expectedMap = { critical: 1, urgent: 1, high: 2, medium: 3, low: 4 };

    for (const [input, expected] of Object.entries(expectedMap)) {
      let capturedVars;
      mockFetch.mockImplementation(async (url, opts) => {
        capturedVars = JSON.parse(opts.body).variables;
        return {
          ok: true,
          json: async () => ({
            data: { issueCreate: { success: true, issue: { id: '1', identifier: 'X-1', title: '', url: '' } } },
          }),
        };
      });

      await linear.createIssue({ title: 'test', priority: input }, []);
      expect(capturedVars.input.priority).toBe(expected);
    }
  });

  it('createIssue defaults priority to 0 when none specified', async () => {
    const linear = new LinearIntegration(defaultConfig);
    let capturedVars;

    mockFetch.mockImplementation(async (url, opts) => {
      capturedVars = JSON.parse(opts.body).variables;
      return {
        ok: true,
        json: async () => ({
          data: { issueCreate: { success: true, issue: { id: '1', identifier: 'X-1', title: '', url: '' } } },
        }),
      };
    });

    await linear.createIssue({ title: 'No priority' }, []);
    expect(capturedVars.input.priority).toBe(0);
  });

  it('createIssue throws when teamId is missing', async () => {
    const linear = new LinearIntegration({ clientId: 'c' });
    await expect(linear.createIssue({ title: 'test' }, [])).rejects.toThrow('teamId is required');
  });

  it('createIssue embeds screenshot links in description', async () => {
    const linear = new LinearIntegration(defaultConfig);
    let capturedVars;

    mockFetch.mockImplementation(async (url, opts) => {
      capturedVars = JSON.parse(opts.body).variables;
      return {
        ok: true,
        json: async () => ({
          data: { issueCreate: { success: true, issue: { id: '1', identifier: 'X-1', title: '', url: '' } } },
        }),
      };
    });

    const frames = [
      { recording_id: 'rec-1', filename: 'frame001.jpg', description: 'Error page' },
    ];
    await linear.createIssue({ title: 'Bug' }, frames, { baseUrl: 'https://app.com' });

    expect(capturedVars.input.description).toContain('## Screenshots');
    expect(capturedVars.input.description).toContain('![Error page](https://app.com/api/recordings/rec-1/frames/frame001.jpg)');
  });

  it('createIssue includes assigneeId when provided', async () => {
    const linear = new LinearIntegration(defaultConfig);
    let capturedVars;

    mockFetch.mockImplementation(async (url, opts) => {
      capturedVars = JSON.parse(opts.body).variables;
      return {
        ok: true,
        json: async () => ({
          data: { issueCreate: { success: true, issue: { id: '1', identifier: 'X-1', title: '', url: '' } } },
        }),
      };
    });

    await linear.createIssue({ title: 'Test' }, [], { assigneeId: 'user-42' });
    expect(capturedVars.input.assigneeId).toBe('user-42');
  });

  it('createIssue throws on unsuccessful creation', async () => {
    const linear = new LinearIntegration(defaultConfig);

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: { issueCreate: { success: false, issue: null } },
      }),
    });

    await expect(linear.createIssue({ title: 'Fail' }, [])).rejects.toThrow('Linear issue creation failed');
  });
});

describe('LinearIntegration — Search', () => {
  it('searchIssues sends GraphQL query and maps results', async () => {
    const linear = new LinearIntegration(defaultConfig);

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          searchIssues: {
            nodes: [
              { id: 'i1', identifier: 'ENG-1', title: 'First issue', url: 'https://linear.app/t/ENG-1' },
              { id: 'i2', identifier: 'ENG-2', title: 'Second issue', url: 'https://linear.app/t/ENG-2' },
            ],
          },
        },
      }),
    });

    const results = await linear.searchIssues('login bug');
    expect(results).toHaveLength(2);
    expect(results[0].key).toBe('ENG-1');
    expect(results[0].summary).toBe('First issue');
    expect(results[1].key).toBe('ENG-2');
  });
});

describe('LinearIntegration — Setup Schema', () => {
  it('getSetupSchema requires clientId only', () => {
    const linear = new LinearIntegration(defaultConfig);
    const schema = linear.getSetupSchema();
    expect(schema.required).toContain('clientId');
    expect(schema.required).not.toContain('clientSecret'); // PKCE, no secret
    expect(schema.properties.teamId).toBeDefined();
  });
});

describe('LinearIntegration — GraphQL Error Handling', () => {
  it('graphql throws on GraphQL errors', async () => {
    const linear = new LinearIntegration(defaultConfig);

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        errors: [{ message: 'Authentication required' }],
      }),
    });

    await expect(
      linear.graphql('query { viewer { id } }', {}, 'bad-token')
    ).rejects.toThrow('Authentication required');
  });
});
