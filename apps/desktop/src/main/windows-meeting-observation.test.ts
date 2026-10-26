import { describe, expect, it } from 'vitest';
import { WindowsMeetingObservationProvider } from './windows-meeting-observation.js';

const now = new Date('2026-10-22T12:00:00.000Z');

describe('WindowsMeetingObservationProvider', () => {
  it('detects a visible Meet candidate owned by Chrome without reading a URL', async () => {
    const provider = new WindowsMeetingObservationProvider({
      platform: 'win32',
      now: () => now,
      runner: () =>
        Promise.resolve(
          JSON.stringify([
            {
              processId: 42,
              processName: 'chrome',
              windowTitle: 'Meet - abc-defg-hij - Google Chrome',
              visible: true
            }
          ])
        )
    });
    await expect(provider.observe()).resolves.toEqual([
      expect.objectContaining({
        provider: 'MEET',
        applicationName: 'Google Chrome',
        processId: 42,
        confirmationRequired: true,
        observedAt: now.toISOString()
      })
    ]);
  });

  it('rejects ordinary browsers, ambiguous titles, hidden windows, and lookalikes', async () => {
    const provider = new WindowsMeetingObservationProvider({
      platform: 'win32',
      runner: () =>
        Promise.resolve(
          JSON.stringify([
            { processId: 1, processName: 'chrome', windowTitle: 'Inbox', visible: true },
            { processId: 2, processName: 'chrome', windowTitle: 'Meet the team', visible: true },
            {
              processId: 3,
              processName: 'chrome',
              windowTitle: 'Google Meet Help - Google Chrome',
              visible: true
            },
            {
              processId: 4,
              processName: 'notepad',
              windowTitle: 'Meet - abc-defg-hij',
              visible: true
            },
            {
              processId: 5,
              processName: 'msedge',
              windowTitle: 'Google Meet - Microsoft Edge',
              visible: false
            }
          ])
        )
    });
    await expect(provider.observe()).resolves.toEqual([]);
  });

  it('does not execute observation outside Windows', async () => {
    let calls = 0;
    const provider = new WindowsMeetingObservationProvider({
      platform: 'darwin',
      runner: () => {
        calls += 1;
        return Promise.resolve('[]');
      }
    });
    await expect(provider.observe()).resolves.toEqual([]);
    expect(provider.supported()).toBe(false);
    expect(calls).toBe(0);
  });
});
