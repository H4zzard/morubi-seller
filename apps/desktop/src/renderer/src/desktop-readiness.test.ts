import { describe, expect, it } from 'vitest';
import type { LiveCallRuntimeCapabilities } from '../../shared/ipc';
import { evaluateDesktopReadiness } from './desktop-readiness';

const capabilities: LiveCallRuntimeCapabilities = {
  simulatorEnabled: false,
  meetingDetection: {
    enabled: true,
    supported: true,
    available: true,
    method: 'WINDOW_TITLE',
    permission: 'NOT_APPLICABLE'
  },
  audioCapture: {
    enabled: true,
    microphoneSupported: true,
    systemAudioSupported: true,
    systemAudioMethod: 'WINDOWS_LOOPBACK',
    nativeSystemAudioSupported: true,
    microphonePermission: 'granted'
  },
  liveCallSession: { enabled: true, manualStartSupported: true },
  platform: 'win32',
  maxBufferBytes: 1_000,
  observationIntervalMs: 2_000
};

describe('desktop readiness', () => {
  it('never claims ready before both real signal checks pass', () => {
    const result = evaluateDesktopReadiness({
      authenticated: true,
      apiReachable: true,
      capabilities,
      microphoneCount: 1,
      systemAudioSourceCount: 1,
      microphoneSignal: true,
      systemAudioSignal: null
    });
    expect(result.status).toBe('ACTION_REQUIRED');
    expect(
      result.checks.find((check) => check.label === 'Sinal da reunião comprovado')?.passed
    ).toBe(false);
  });

  it('blocks when the runtime feature is disabled', () => {
    const result = evaluateDesktopReadiness({
      authenticated: true,
      apiReachable: true,
      capabilities: {
        ...capabilities,
        audioCapture: { ...capabilities.audioCapture, enabled: false }
      },
      microphoneCount: 1,
      systemAudioSourceCount: 1,
      microphoneSignal: true,
      systemAudioSignal: true
    });
    expect(result.status).toBe('BLOCKED');
  });

  it('reports ready only after permissions, devices, API and both signals pass', () => {
    const result = evaluateDesktopReadiness({
      authenticated: true,
      apiReachable: true,
      capabilities,
      microphoneCount: 1,
      systemAudioSourceCount: 1,
      microphoneSignal: true,
      systemAudioSignal: true
    });
    expect(result.status).toBe('READY');
    expect(result.checks.every((check) => check.passed)).toBe(true);
  });

  it('does not block audio readiness when automatic meeting detection is unavailable', () => {
    const result = evaluateDesktopReadiness({
      authenticated: true,
      apiReachable: true,
      capabilities: {
        ...capabilities,
        platform: 'darwin',
        meetingDetection: {
          enabled: true,
          supported: true,
          available: false,
          method: 'LEGACY_SCREEN_METADATA',
          permission: 'OPTIONAL_PERMISSION_REQUIRED'
        },
        audioCapture: {
          ...capabilities.audioCapture,
          systemAudioMethod: 'MACOS_BLACKHOLE_2CH',
          nativeSystemAudioSupported: false
        }
      },
      microphoneCount: 1,
      systemAudioSourceCount: 1,
      microphoneSignal: true,
      systemAudioSignal: true
    });

    expect(result.status).toBe('READY');
    expect(result.checks.map((check) => check.label)).not.toContain(
      'Permissão para detectar reuniões'
    );
  });
});
