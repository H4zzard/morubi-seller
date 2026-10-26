import { describe, expect, it } from 'vitest';
import { MacOSMeetingObservationProvider } from './macos-meeting-observation.js';

const now = new Date('2026-10-22T12:00:00.000Z');

describe('MacOSMeetingObservationProvider', () => {
  it('detects a visible Meet candidate in Chrome using window metadata only', async () => {
    const provider = new MacOSMeetingObservationProvider({
      platform: 'darwin',
      screenPermissionGranted: () => true,
      now: () => now,
      runner: () =>
        Promise.resolve(
          JSON.stringify([
            {
              processId: 73,
              processName: 'chrome',
              applicationName: 'Google Chrome',
              windowTitle: 'Meet - abc-defg-hij - Google Chrome',
              visible: true
            }
          ])
        )
    });

    await expect(provider.observe()).resolves.toEqual([
      expect.objectContaining({
        provider: 'MEET',
        processId: 73,
        applicationName: 'Google Chrome',
        confirmationRequired: true,
        observedAt: now.toISOString()
      })
    ]);
  });

  it('rejects false positives, hidden windows, and unsupported applications', async () => {
    const provider = new MacOSMeetingObservationProvider({
      platform: 'darwin',
      screenPermissionGranted: () => true,
      runner: () =>
        Promise.resolve(
          JSON.stringify([
            {
              processId: 1,
              processName: 'chrome',
              applicationName: 'Google Chrome',
              windowTitle: 'Meet the team - Google Chrome',
              visible: true
            },
            {
              processId: 2,
              processName: 'chrome',
              applicationName: 'Google Chrome',
              windowTitle: 'Google Meet Help - Google Chrome',
              visible: true
            },
            {
              processId: 3,
              processName: 'chrome',
              applicationName: 'Google Chrome',
              windowTitle: 'Google Meet - Sales',
              visible: false
            },
            {
              processId: 4,
              processName: 'chrome',
              applicationName: 'Untrusted Browser',
              windowTitle: 'Meet - abc-defg-hij',
              visible: true
            }
          ])
        )
    });

    await expect(provider.observe()).resolves.toEqual([]);
  });

  it('requires explicit Screen Recording permission and never invokes the runner without it', async () => {
    let calls = 0;
    const provider = new MacOSMeetingObservationProvider({
      platform: 'darwin',
      screenPermissionGranted: () => false,
      runner: () => {
        calls += 1;
        return Promise.resolve('[]');
      }
    });

    await expect(provider.observe()).rejects.toThrow('MACOS_SCREEN_PERMISSION_REQUIRED');
    expect(calls).toBe(0);
  });

  it('distinguishes no Chrome window from inaccessible Chrome window metadata', async () => {
    const noChrome = new MacOSMeetingObservationProvider({
      platform: 'darwin',
      screenPermissionGranted: () => true,
      runner: () =>
        Promise.resolve(JSON.stringify({ browserWindowCount: 0, observations: [] }))
    });
    await expect(noChrome.observe()).resolves.toEqual([]);

    const inaccessibleMetadata = new MacOSMeetingObservationProvider({
      platform: 'darwin',
      screenPermissionGranted: () => true,
      runner: () =>
        Promise.resolve(JSON.stringify({ browserWindowCount: 1, observations: [] }))
    });
    await expect(inaccessibleMetadata.observe()).rejects.toThrow(
      'MACOS_WINDOW_METADATA_UNAVAILABLE'
    );
  });

  it('checks TCC again after an explicit capture request', async () => {
    let granted = false;
    let calls = 0;
    const provider = new MacOSMeetingObservationProvider({
      platform: 'darwin',
      screenPermissionGranted: () => granted,
      runner: () => {
        calls += 1;
        granted = true;
        return Promise.resolve(JSON.stringify({ browserWindowCount: 0, observations: [] }));
      }
    });

    await expect(provider.requestPermissionAndVerify()).resolves.toBeUndefined();
    expect(calls).toBe(1);
  });

  it('reports missing permission when the explicit capture request is rejected by macOS', async () => {
    const provider = new MacOSMeetingObservationProvider({
      platform: 'darwin',
      screenPermissionGranted: () => false,
      runner: () => Promise.reject(new Error('capture rejected'))
    });

    await expect(provider.requestPermissionAndVerify()).rejects.toThrow(
      'MACOS_SCREEN_PERMISSION_REQUIRED'
    );
  });

  it('does not execute outside macOS', async () => {
    let calls = 0;
    const provider = new MacOSMeetingObservationProvider({
      platform: 'win32',
      screenPermissionGranted: () => true,
      runner: () => {
        calls += 1;
        return Promise.resolve('[]');
      }
    });

    await expect(provider.observe()).resolves.toEqual([]);
    expect(calls).toBe(0);
  });
});
