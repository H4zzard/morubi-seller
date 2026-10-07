import { describe, expect, it } from 'vitest';
import { ipcChannels } from './ipc.js';

describe('IPC contract', () => {
  it('uses a closed set of unique namespaced channels', () => {
    const channels = Object.values(ipcChannels);
    expect(new Set(channels).size).toBe(channels.length);
    expect(
      channels.every((channel) =>
        /^(system|auth|commercial|intervention|realtime|notifications|liveCalls):/.test(channel)
      )
    ).toBe(true);
  });
});
