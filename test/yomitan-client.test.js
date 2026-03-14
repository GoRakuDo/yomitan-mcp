import { describe, it, expect, vi, beforeEach } from 'vitest';
import { YomitanClient } from '../src/yomitan-client.js';

describe('YomitanClient', () => {
  let client;

  beforeEach(() => {
    client = new YomitanClient('http://localhost:19633');
    global.fetch = vi.fn();
  });

  it('should successfully make an API call to termsFind', async () => {
    const mockResponse = {
      responseStatusCode: 200,
      data: [{ headword: '食べる', reading: 'たべる' }]
    };

    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse
    });

    const result = await client.findTerms('食べる');

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const fetchArgs = global.fetch.mock.calls[0];
    expect(fetchArgs[0]).toBe('http://localhost:19633/termEntries');
    expect(fetchArgs[1].method).toBe('POST');
    
    // タイムアウト設定が追加されたため、signalが含まれている
    expect(fetchArgs[1].signal).toBeDefined();

    const payload = JSON.parse(fetchArgs[1].body);
    expect(payload.action).toBe('termEntries');
    expect(JSON.parse(payload.body).term).toBe('食べる');

    expect(result).toEqual(mockResponse.data);
  });

  it('should throw immediately (after retries) if connection is refused', async () => {
    const connError = new Error('fetch failed');
    connError.cause = { code: 'ECONNREFUSED' };
    
    // retry 3 times exactly
    global.fetch.mockRejectedValue(connError);

    await expect(client.findTerms('食べる')).rejects.toThrow(/Failed to connect to Yomitan API/);
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  it('should throw if Yomitan returns a non-200 application error', async () => {
    const mockResponse = {
      responseStatusCode: 400,
      data: 'Invalid query parameters'
    };

    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse
    });

    await expect(client.findTerms('err')).rejects.toThrow(/Yomitan API Error \(400\)/);
  });
});
