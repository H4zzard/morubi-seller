import { describe, expect, it } from 'vitest';
import { extractSseData } from './realtime-client.js';

describe('desktop realtime stream', () => {
  it('keeps partial frames for reconnect-safe parsing', () => {
    const first = extractSseData('id: one\ndata: {"id":"one"}\n\ndata: {"id"');
    expect(first.events).toEqual(['{"id":"one"}']);
    expect(first.remainder).toBe('data: {"id"');
    const second = extractSseData(`${first.remainder}:"two"}\n\n`);
    expect(second.events).toEqual(['{"id":"two"}']);
    expect(second.remainder).toBe('');
  });
});
