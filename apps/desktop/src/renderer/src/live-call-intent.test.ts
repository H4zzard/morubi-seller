import { describe, expect, it } from 'vitest';
import type { LiveCallRuntimeCapabilities, MeetingCandidateDto } from '../../shared/ipc';
import { createLiveCallRequest, shouldPollMeetingDetection } from './live-call-intent.js';

const capabilities: LiveCallRuntimeCapabilities = {
  simulatorEnabled: false,
  meetingDetection: {
    enabled: true,
    supported: true,
    available: false,
    method: 'LEGACY_SCREEN_METADATA',
    permission: 'OPTIONAL_PERMISSION_REQUIRED'
  },
  audioCapture: {
    enabled: true,
    microphoneSupported: true,
    systemAudioSupported: true,
    systemAudioMethod: 'MACOS_BLACKHOLE_2CH',
    nativeSystemAudioSupported: false,
    microphonePermission: 'granted'
  },
  liveCallSession: { enabled: true, manualStartSupported: true },
  platform: 'darwin',
  maxBufferBytes: 4_194_304,
  observationIntervalMs: 3_000
};

describe('live call intent', () => {
  it('creates a canonical manual call without detector evidence', () => {
    expect(createLiveCallRequest({ kind: 'MANUAL', provider: 'ZOOM' }, '')).toEqual({
      meetingProvider: 'ZOOM',
      meetingTitle: 'Zoom',
      detectionConfidence: 1,
      detectionEvidence: 'MANUAL'
    });
  });

  it('preserves detected browser evidence', () => {
    const candidate: MeetingCandidateDto = {
      id: 'candidate-1',
      provider: 'MEET',
      processId: 42,
      processName: 'chrome',
      applicationName: 'Google Chrome',
      windowTitle: 'Google Meet',
      visible: true,
      confidence: 0.68,
      evidence: 'WINDOW_TITLE',
      confirmationRequired: true,
      observedAt: new Date(0).toISOString()
    };
    expect(createLiveCallRequest({ kind: 'DETECTED', candidate }, 'conversation-1')).toMatchObject({
      meetingProvider: 'MEET',
      meetingTitle: 'Google Meet',
      conversationId: 'conversation-1',
      detectionConfidence: 0.68,
      detectionEvidence: 'WINDOW_TITLE'
    });
  });

  it('keeps manual calls available when the optional detector is unavailable', () => {
    expect(capabilities.liveCallSession.manualStartSupported).toBe(true);
    expect(capabilities.audioCapture.enabled).toBe(true);
    expect(shouldPollMeetingDetection(capabilities, false)).toBe(false);
  });

  it('stops polling while a live session is active', () => {
    const available = {
      ...capabilities,
      meetingDetection: { ...capabilities.meetingDetection, available: true }
    };
    expect(shouldPollMeetingDetection(available, false)).toBe(true);
    expect(shouldPollMeetingDetection(available, true)).toBe(false);
  });
});
