import { describe, it, expect, beforeEach, vi } from 'vitest';

const fetchMock = vi.fn();
vi.mock('node-fetch', () => ({ default: (...args) => fetchMock(...args) }));

const { analyzeTranscript } = await import('../../services/gpt.js');

const transcript = {
  text: 'user narrates a short demo',
  words: [{ word: 'hi', start: 0, end: 0.5 }],
};

const ok = (payload) => ({
  ok: true,
  json: async () => ({ choices: [{ message: { content: JSON.stringify(payload) } }] }),
  text: async () => '',
});

describe('analyzeTranscript — keyFrames safety net', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  const fetchSpy = fetchMock;

  it('returns GPT keyFrames when model obeys the prompt', async () => {
    const frames = [
      { time: 1, description: 'a', detail: '' },
      { time: 2, description: 'b', detail: '' },
      { time: 3, description: 'c', detail: '' },
    ];
    fetchSpy.mockResolvedValueOnce(ok({ type: 'demo', title: 't', keyFrames: frames }));

    const out = await analyzeTranscript(transcript, null, null, null, 60);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(out.keyFrames).toEqual(frames);
  });

  it('retries once when first response is missing keyFrames and uses the retry result', async () => {
    fetchSpy
      .mockResolvedValueOnce(ok({ type: 'bug', title: 't', steps: [] }))
      .mockResolvedValueOnce(ok({
        type: 'bug',
        title: 't',
        keyFrames: [{ time: 5, description: 'fix', detail: 'retry worked' }],
      }));

    const out = await analyzeTranscript(transcript, null, null, null, 60);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(out.keyFrames).toHaveLength(1);
    expect(out.keyFrames[0].description).toBe('fix');
  });

  it('returns empty keyFrames when both the initial call and the retry omit them', async () => {
    fetchSpy
      .mockResolvedValueOnce(ok({ type: 'bug', title: 't' }))
      .mockResolvedValueOnce(ok({ type: 'bug', title: 't', keyFrames: [] }));

    const out = await analyzeTranscript(transcript, null, null, null, 120);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(out.keyFrames).toEqual([]);
    expect(out.type).toBe('bug');
  });
});
