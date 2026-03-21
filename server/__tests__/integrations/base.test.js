import { describe, it, expect } from 'vitest';
import { TrackerIntegration } from '../../integrations/base.js';

describe('TrackerIntegration — Base Class', () => {
  it('has default name and displayName', () => {
    const base = new TrackerIntegration({});
    expect(base.name).toBe('base');
    expect(base.displayName).toBe('Base');
  });

  it('defaults supportsOAuth to false', () => {
    const base = new TrackerIntegration({});
    expect(base.supportsOAuth).toBe(false);
  });

  it('defaults supportsAttachments to false', () => {
    const base = new TrackerIntegration({});
    expect(base.supportsAttachments).toBe(false);
  });

  it('stores config from constructor', () => {
    const cfg = { url: 'https://example.com', token: 'abc' };
    const base = new TrackerIntegration(cfg);
    expect(base.config).toEqual(cfg);
  });

  it('getOAuthURL throws by default', () => {
    const base = new TrackerIntegration({});
    expect(() => base.getOAuthURL('http://cb', 'state123')).toThrow('OAuth not supported');
  });

  it('handleOAuthCallback throws by default', async () => {
    const base = new TrackerIntegration({});
    await expect(base.handleOAuthCallback('code', 'http://cb')).rejects.toThrow('OAuth not supported');
  });

  it('refreshToken throws by default', async () => {
    const base = new TrackerIntegration({});
    await expect(base.refreshToken('tok')).rejects.toThrow('OAuth not supported');
  });

  it('createIssue throws by default', async () => {
    const base = new TrackerIntegration({});
    await expect(base.createIssue({}, [])).rejects.toThrow('createIssue not implemented');
  });

  it('searchIssues throws by default', async () => {
    const base = new TrackerIntegration({});
    await expect(base.searchIssues('test')).rejects.toThrow('searchIssues not implemented');
  });

  it('addComment throws by default', async () => {
    const base = new TrackerIntegration({});
    await expect(base.addComment('issue-1', 'hello')).rejects.toThrow('addComment not implemented');
  });

  it('attachFiles returns false when supportsAttachments is false', async () => {
    const base = new TrackerIntegration({});
    const result = await base.attachFiles('issue-1', []);
    expect(result).toBe(false);
  });

  it('embedScreenshotLinks generates markdown image links', () => {
    const base = new TrackerIntegration({});
    const frames = [
      { recording_id: 'rec-1', filename: 'frame001.jpg', description: 'Login page' },
      { recording_id: 'rec-1', filename: 'frame002.jpg', description: '' },
    ];
    const result = base.embedScreenshotLinks(frames, 'https://app.example.com');
    expect(result).toContain('![Login page](https://app.example.com/api/recordings/rec-1/frames/frame001.jpg)');
    expect(result).toContain('![Screenshot](https://app.example.com/api/recordings/rec-1/frames/frame002.jpg)');
  });

  it('getProjects returns empty array by default', async () => {
    const base = new TrackerIntegration({});
    const projects = await base.getProjects();
    expect(projects).toEqual([]);
  });

  it('getUsers returns empty array by default', async () => {
    const base = new TrackerIntegration({});
    const users = await base.getUsers();
    expect(users).toEqual([]);
  });

  it('getSetupSchema returns minimal object schema', () => {
    const base = new TrackerIntegration({});
    const schema = base.getSetupSchema();
    expect(schema.type).toBe('object');
    expect(schema.properties).toBeDefined();
  });

  it('testConnection returns not implemented by default', async () => {
    const base = new TrackerIntegration({});
    const result = await base.testConnection();
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Not implemented');
  });
});
