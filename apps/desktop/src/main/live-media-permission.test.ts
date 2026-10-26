import { describe, expect, it } from 'vitest';
import { LiveMediaPermissionGate } from './live-media-permission.js';

describe('live media permission gate', () => {
  it('rejects both audio grants before a live session is activated', () => {
    const gate = new LiveMediaPermissionGate(true);
    expect(() => gate.authorizeMicrophone('session-1')).toThrow('LIVE_CAPTURE_SESSION_NOT_ACTIVE');
    expect(() => gate.authorizeSystemAudio('session-1', 'screen:1:0')).toThrow(
      'LIVE_CAPTURE_SESSION_NOT_ACTIVE'
    );
  });

  it('grants one short-lived audio-only request for the active session and renderer', () => {
    let now = 1_000;
    const gate = new LiveMediaPermissionGate(true, 30_000, () => now);
    gate.setActiveSession('session-1');
    expect(gate.authorizeMicrophone('session-1')).toBe(new Date(31_000).toISOString());
    expect(
      gate.checkMicrophone({
        requestingWebContentsId: 7,
        allowedWebContentsId: 7,
        permission: 'media',
        mediaType: 'audio'
      })
    ).toBe(true);
    expect(
      gate.consumeMicrophone({
        requestingWebContentsId: 7,
        allowedWebContentsId: 7,
        permission: 'media',
        mediaTypes: ['audio']
      })
    ).toBe(true);
    expect(
      gate.consumeMicrophone({
        requestingWebContentsId: 7,
        allowedWebContentsId: 7,
        permission: 'media',
        mediaTypes: ['audio']
      })
    ).toBe(false);
    now += 1;
  });

  it('authorizes one explicit Windows loopback source without a generic display grant', () => {
    const gate = new LiveMediaPermissionGate(true);
    gate.setActiveSession('session-1');
    gate.authorizeSystemAudio('session-1', 'screen:1:0');
    expect(
      gate.checkSystemAudio({
        requestingWebContentsId: 7,
        allowedWebContentsId: 7,
        requestingOrigin: 'morubi-app://app/',
        allowedOrigin: 'morubi-app://app'
      })
    ).toBe(true);
    expect(
      gate.consumeSystemAudio({
        trustedFrame: true,
        securityOrigin: 'morubi-app://app',
        allowedOrigin: 'morubi-app://app',
        audioRequested: true,
        videoRequested: true
      })
    ).toBe('screen:1:0');
    expect(
      gate.consumeSystemAudio({
        trustedFrame: true,
        securityOrigin: 'morubi-app://app',
        allowedOrigin: 'morubi-app://app',
        audioRequested: true,
        videoRequested: true
      })
    ).toBeNull();
  });

  it('consumes one exact native helper authorization for the active session', () => {
    const gate = new LiveMediaPermissionGate(true);
    gate.setActiveSession('session-1');
    gate.authorizeSystemAudio('session-1', 'macos:native-system-audio');
    expect(gate.consumeNativeSystemAudio('session-2', 'macos:native-system-audio')).toBe(false);
    expect(gate.consumeNativeSystemAudio('session-1', 'macos:other')).toBe(false);
    expect(gate.consumeNativeSystemAudio('session-1', 'macos:native-system-audio')).toBe(true);
    expect(gate.consumeNativeSystemAudio('session-1', 'macos:native-system-audio')).toBe(false);
  });

  it('grants one short-lived audio-only diagnostic without an active call', () => {
    const gate = new LiveMediaPermissionGate(true);
    gate.authorizeAudioDiagnostic();
    expect(
      gate.consumeMicrophone({
        requestingWebContentsId: 7,
        allowedWebContentsId: 7,
        permission: 'media',
        mediaTypes: ['audio']
      })
    ).toBe(true);
    expect(
      gate.consumeMicrophone({
        requestingWebContentsId: 7,
        allowedWebContentsId: 7,
        permission: 'media',
        mediaTypes: ['audio']
      })
    ).toBe(false);
  });

  it('grants one exact system-audio diagnostic source without an active call', () => {
    const gate = new LiveMediaPermissionGate(true);
    gate.authorizeSystemAudioDiagnostic('screen:1:0');
    expect(
      gate.consumeSystemAudio({
        trustedFrame: true,
        securityOrigin: 'morubi-app://app',
        allowedOrigin: 'morubi-app://app',
        audioRequested: true,
        videoRequested: true
      })
    ).toBe('screen:1:0');
    expect(
      gate.consumeSystemAudio({
        trustedFrame: true,
        securityOrigin: 'morubi-app://app',
        allowedOrigin: 'morubi-app://app',
        audioRequested: true,
        videoRequested: true
      })
    ).toBeNull();
  });

  it('keeps diagnostics behind the global live-capture feature gate', () => {
    const gate = new LiveMediaPermissionGate(false);
    expect(() => gate.authorizeAudioDiagnostic()).toThrow('LIVE_CAPTURE_DISABLED');
    expect(() => gate.authorizeSystemAudioDiagnostic('screen:1:0')).toThrow(
      'LIVE_CAPTURE_DISABLED'
    );
  });

  it('rejects another session, renderer, origin, expiration, video microphone, and reset', () => {
    let now = 1_000;
    const gate = new LiveMediaPermissionGate(true, 100, () => now);
    gate.setActiveSession('session-1');
    expect(() => gate.authorizeMicrophone('session-2')).toThrow('LIVE_CAPTURE_SESSION_NOT_ACTIVE');
    gate.authorizeMicrophone('session-1');
    expect(
      gate.consumeMicrophone({
        requestingWebContentsId: 8,
        allowedWebContentsId: 7,
        permission: 'media',
        mediaTypes: ['audio']
      })
    ).toBe(false);
    expect(
      gate.consumeMicrophone({
        requestingWebContentsId: 7,
        allowedWebContentsId: 7,
        permission: 'media',
        mediaTypes: ['audio', 'video']
      })
    ).toBe(false);
    gate.authorizeSystemAudio('session-1', 'screen:1:0');
    expect(
      gate.consumeSystemAudio({
        trustedFrame: true,
        securityOrigin: 'https://evil.example',
        allowedOrigin: 'morubi-app://app',
        audioRequested: true,
        videoRequested: true
      })
    ).toBeNull();
    now = 1_101;
    expect(
      gate.consumeMicrophone({
        requestingWebContentsId: 7,
        allowedWebContentsId: 7,
        permission: 'media',
        mediaTypes: ['audio']
      })
    ).toBe(false);
    gate.clearActiveSession('session-1');
    expect(() => gate.authorizeMicrophone('session-1')).toThrow('LIVE_CAPTURE_SESSION_NOT_ACTIVE');
    expect(() => new LiveMediaPermissionGate(false).setActiveSession('session-1')).toThrow(
      'LIVE_CAPTURE_DISABLED'
    );
  });
});
