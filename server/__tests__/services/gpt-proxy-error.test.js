import { describe, it, expect, beforeEach, vi } from 'vitest';

// Regression: an OpenAI-compatible proxy
// answers HTTP 200 with an `error` body when the key is revoked.
// callGptJson used to swallow it and classifyAndSummarize returned
// { title: 'Untitled', summary: '' } as if the model had answered.

const fetchMock = vi.fn();
vi.mock('node-fetch', () => ({ default: (...args) => fetchMock(...args) }));

const { classifyAndSummarize } = await import('../../services/gpt.js');

const transcript = {
  text: 'short narrated demo of the settings page',
  words: [{ word: 'short', start: 0, end: 0.5 }],
};

const http200 = (body) => ({
  ok: true,
  status: 200,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

describe('callGptJson — HTTP 200 with error body (proxy auth failure)', () => {
  beforeEach(() => fetchMock.mockReset());

  it('throws on invalid_api_key instead of returning an Untitled fallback', async () => {
    fetchMock.mockResolvedValue(http200({
      error: { message: 'Incorrect API key provided', type: 'invalid_request_error', code: 'invalid_api_key' },
    }));
    await expect(classifyAndSummarize(transcript, 60)).rejects.toThrow(/invalid_api_key/);
  });

  it('throws when the response has no choices/content', async () => {
    fetchMock.mockResolvedValue(http200({ status: 'ok' }));
    await expect(classifyAndSummarize(transcript, 60)).rejects.toThrow(/no choices/);
  });

  it('still returns the real result on a normal response', async () => {
    fetchMock.mockResolvedValue(http200({
      choices: [{ message: { content: JSON.stringify({ type: 'demo', title: 'Settings demo', summary: 'Shows settings.', chapters: [] }) } }],
    }));
    const out = await classifyAndSummarize(transcript, 60);
    expect(out.title).toBe('Settings demo');
    expect(out.summary).toBe('Shows settings.');
  });
});
