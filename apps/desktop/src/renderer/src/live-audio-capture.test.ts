import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CaptureHealth, LiveAudioChunk } from '@morubi/live-calls';
import {
  macOSBlackHoleSourceId,
  macOSNativeSystemAudioSourceId,
  type NativeSystemAudioChunkDto
} from '../../shared/ipc.js';
import {
  AudioChunkSequencer,
  DualAudioCaptureController,
  MacOSBlackHoleSystemAudioCaptureProvider,
  MacOSNativeSystemAudioCaptureProvider,
  MediaDevicesMicrophoneCaptureProvider,
  convertFloat32Stereo48kToPcm16Mono16k,
  findBlackHole2chAudioInput,
  type CaptureProviderSnapshot,
  type ObservableCaptureProvider
} from './live-audio-capture.js';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  FakeAudioContext.latest = null;
});

class FakeAudioTrack extends EventTarget {
  public readonly muted = false;
  public stopCalls = 0;

  public constructor(
    public readonly label: string,
    private readonly id: string
  ) {
    super();
  }

  public getSettings(): MediaTrackSettings {
    return { deviceId: this.id };
  }

  public stop(): void {
    this.stopCalls += 1;
  }
}

class FakeMediaStream {
  public constructor(private readonly tracks: FakeAudioTrack[] = []) {}

  public getAudioTracks(): FakeAudioTrack[] {
    return this.tracks;
  }

  public getVideoTracks(): FakeAudioTrack[] {
    return [];
  }

  public getTracks(): FakeAudioTrack[] {
    return this.tracks;
  }
}

class FakeScriptProcessor {
  public onaudioprocess:
    | ((event: {
        inputBuffer: {
          numberOfChannels: number;
          length: number;
          sampleRate: number;
          getChannelData(index: number): Float32Array;
        };
      }) => void)
    | null = null;
  public connect(): void {}
  public disconnect(): void {}
  public emitSilent(): void {
    const samples = new Float32Array(4_800);
    this.onaudioprocess?.({
      inputBuffer: {
        numberOfChannels: 1,
        length: samples.length,
        sampleRate: 48_000,
        getChannelData: () => samples
      }
    });
  }
}

class FakeAudioContext {
  public static latest: FakeAudioContext | null = null;
  public readonly destination = {};
  public readonly processor = new FakeScriptProcessor();
  public constructor() {
    FakeAudioContext.latest = this;
  }
  public createMediaStreamSource() {
    return { connect: () => undefined, disconnect: () => undefined };
  }
  public createScriptProcessor() {
    return this.processor;
  }
  public createGain() {
    return { gain: { value: 1 }, connect: () => undefined, disconnect: () => undefined };
  }
  public suspend(): Promise<void> {
    return Promise.resolve();
  }
  public resume(): Promise<void> {
    return Promise.resolve();
  }
  public close(): Promise<void> {
    return Promise.resolve();
  }
}

function installMediaRuntime(input: {
  devices: Array<{ deviceId: string; kind: MediaDeviceKind; label: string }>;
  track: FakeAudioTrack;
}) {
  const getUserMedia = vi.fn(() =>
    Promise.resolve(new FakeMediaStream([input.track]) as unknown as MediaStream)
  );
  const authorizeMicrophone = vi.fn(() => Promise.resolve({ authorizedUntil: 'soon' }));
  const authorizeMacOSSystemAudio = vi.fn(() => Promise.resolve({ authorizedUntil: 'soon' }));
  vi.stubGlobal('MediaStream', FakeMediaStream);
  vi.stubGlobal('navigator', {
    mediaDevices: {
      enumerateDevices: vi.fn(() => Promise.resolve(input.devices)),
      getUserMedia,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    }
  });
  vi.stubGlobal('window', {
    AudioContext: FakeAudioContext,
    morubi: { liveCalls: { authorizeMicrophone, authorizeMacOSSystemAudio } },
    setInterval,
    clearInterval
  });
  return { getUserMedia, authorizeMicrophone, authorizeMacOSSystemAudio };
}

class FakeCaptureProvider implements ObservableCaptureProvider {
  public readonly platform = 'WINDOWS' as const;
  public readonly mode: 'MICROPHONE' | 'SYSTEM_AUDIO';
  private state: CaptureHealth = 'IDLE';
  private listener: ((chunk: LiveAudioChunk) => void) | null = null;
  public stopCalls = 0;

  public constructor(
    public readonly technicalSource: 'LOCAL_MIC' | 'SYSTEM_AUDIO',
    private readonly startFailure?: Error
  ) {
    this.mode = technicalSource === 'LOCAL_MIC' ? 'MICROPHONE' : 'SYSTEM_AUDIO';
  }

  public start(listener: (chunk: LiveAudioChunk) => void): Promise<void> {
    if (this.startFailure) {
      this.state = 'FAILED';
      return Promise.reject(this.startFailure);
    }
    this.listener = listener;
    this.state = 'ACTIVE';
    return Promise.resolve();
  }

  public pause(): Promise<void> {
    this.state = 'PAUSED';
    return Promise.resolve();
  }

  public resume(): Promise<void> {
    this.state = 'ACTIVE';
    return Promise.resolve();
  }

  public stop(): Promise<void> {
    this.stopCalls += 1;
    this.listener = null;
    this.state = 'STOPPED';
    return Promise.resolve();
  }

  public health(): CaptureHealth {
    return this.state;
  }

  public snapshot(): CaptureProviderSnapshot {
    return {
      state: this.state,
      chunks: 0,
      lastChunkAt: null,
      signalLevel: 0,
      muted: false,
      failures: this.state === 'FAILED' ? 1 : 0,
      deviceId: null,
      deviceLabel: null
    };
  }

  public emit(sequence: number, bytes: number): void {
    this.listener?.({
      id: `${this.technicalSource}:${sequence}`,
      sequence,
      capturedAt: new Date(sequence * 1_000),
      durationMs: 1_000,
      mimeType: 'audio/webm',
      source: this.technicalSource,
      data: new Uint8Array(bytes)
    });
  }
}

describe('DualAudioCaptureController', () => {
  it('assigns independent monotonic sequences to each technical source', () => {
    const local = new AudioChunkSequencer('LOCAL_MIC');
    const system = new AudioChunkSequencer('SYSTEM_AUDIO');
    const input = {
      capturedAt: new Date(0),
      durationMs: 1_000,
      mimeType: 'audio/webm',
      data: new Uint8Array(1)
    };
    expect([local.next(input).sequence, local.next(input).sequence]).toEqual([0, 1]);
    expect(system.next(input)).toMatchObject({ sequence: 0, source: 'SYSTEM_AUDIO' });
  });

  it('keeps microphone and system chunks in separate bounded buffers', async () => {
    const microphone = new FakeCaptureProvider('LOCAL_MIC');
    const systemAudio = new FakeCaptureProvider('SYSTEM_AUDIO');
    const controller = new DualAudioCaptureController(
      microphone,
      systemAudio,
      16,
      () => undefined,
      () => undefined
    );
    await controller.start();
    microphone.emit(0, 6);
    microphone.emit(1, 6);
    systemAudio.emit(0, 4);
    const snapshot = controller.snapshot();
    expect(snapshot.sources).toEqual([
      expect.objectContaining({ source: 'LOCAL_MIC', bufferedBytes: 6, droppedChunks: 1 }),
      expect.objectContaining({ source: 'SYSTEM_AUDIO', bufferedBytes: 4, droppedChunks: 0 })
    ]);
    expect(snapshot.bufferedBytes).toBe(10);
  });

  it('stops an already opened microphone when system capture fails', async () => {
    const microphone = new FakeCaptureProvider('LOCAL_MIC');
    const systemAudio = new FakeCaptureProvider(
      'SYSTEM_AUDIO',
      new Error('SYSTEM_AUDIO_PERMISSION_DENIED')
    );
    const controller = new DualAudioCaptureController(
      microphone,
      systemAudio,
      65_536,
      () => undefined,
      () => undefined
    );
    await expect(controller.start()).rejects.toThrow('SYSTEM_AUDIO_PERMISSION_DENIED');
    expect(microphone.stopCalls).toBe(1);
    expect(controller.snapshot().active).toBe(false);
  });

  it('reports real buffer metrics without exposing audio bytes', async () => {
    const microphone = new FakeCaptureProvider('LOCAL_MIC');
    const systemAudio = new FakeCaptureProvider('SYSTEM_AUDIO');
    const onChanged = vi.fn();
    const controller = new DualAudioCaptureController(
      microphone,
      systemAudio,
      65_536,
      onChanged,
      () => undefined
    );
    await controller.start();
    microphone.emit(0, 128);
    const heartbeat = controller.heartbeat(new Date('2026-10-22T12:00:00Z'));
    expect(heartbeat).toMatchObject({ bufferedBytes: 128, droppedChunks: 0 });
    expect(heartbeat.sources?.[0]).not.toHaveProperty('data');
    expect(onChanged).toHaveBeenCalled();
    await controller.stop();
    expect(microphone.stopCalls).toBe(1);
    expect(systemAudio.stopCalls).toBe(1);
  });

  it('drains each source only after the authenticated transport acknowledges it', async () => {
    const microphone = new FakeCaptureProvider('LOCAL_MIC');
    const systemAudio = new FakeCaptureProvider('SYSTEM_AUDIO');
    const transported: string[] = [];
    const controller = new DualAudioCaptureController(
      microphone,
      systemAudio,
      65_536,
      () => undefined,
      () => undefined,
      (chunk) => {
        transported.push(chunk.id);
        return Promise.resolve();
      }
    );
    await controller.start();
    microphone.emit(0, 3_200);
    systemAudio.emit(0, 3_200);
    await vi.waitFor(() => expect(transported).toHaveLength(2));
    expect(controller.snapshot().bufferedBytes).toBe(0);
    await controller.stop();
  });

  it('keeps capture active and bounds memory when transcription transport fails', async () => {
    const microphone = new FakeCaptureProvider('LOCAL_MIC');
    const systemAudio = new FakeCaptureProvider('SYSTEM_AUDIO');
    const transportFailure = vi.fn();
    const controller = new DualAudioCaptureController(
      microphone,
      systemAudio,
      8_000,
      () => undefined,
      () => undefined,
      () => Promise.reject(new Error('LIVE_AUDIO_CONNECTION_LOST')),
      transportFailure
    );
    await controller.start();
    microphone.emit(0, 3_200);
    microphone.emit(1, 3_200);
    microphone.emit(2, 3_200);
    await vi.waitFor(() => expect(transportFailure).toHaveBeenCalled());
    expect(controller.snapshot()).toMatchObject({ active: true });
    expect(controller.snapshot().bufferedBytes).toBeLessThanOrEqual(4_000);
    await controller.stop();
  });
});

describe('real desktop audio providers', () => {
  it('starts the native macOS helper only after authorization and forwards separate system chunks', async () => {
    const authorizeSystemAudio = vi.fn(() => Promise.resolve({ authorizedUntil: 'soon' }));
    const startNativeSystemAudio = vi.fn(() =>
      Promise.resolve({
        method: 'MACOS_SCREEN_CAPTURE_KIT' as const,
        deviceLabel: 'Áudio da reunião'
      })
    );
    const stopNativeSystemAudio = vi.fn(() => Promise.resolve());
    const chunkListener: { current?: (chunk: NativeSystemAudioChunkDto) => void } = {};
    vi.stubGlobal('window', {
      morubi: {
        liveCalls: {
          authorizeSystemAudio,
          startNativeSystemAudio,
          stopNativeSystemAudio,
          onNativeSystemAudioChunk: vi.fn((listener) => {
            chunkListener.current = listener;
            return () => {
              delete chunkListener.current;
            };
          }),
          onNativeSystemAudioFailure: vi.fn(() => () => undefined)
        }
      },
      setInterval,
      clearInterval
    });
    const received: LiveAudioChunk[] = [];
    const provider = new MacOSNativeSystemAudioCaptureProvider(
      'session-1',
      macOSNativeSystemAudioSourceId,
      { changed: () => undefined, failed: () => undefined }
    );

    await provider.start((chunk) => received.push(chunk));
    expect(authorizeSystemAudio).toHaveBeenCalledWith({
      sessionId: 'session-1',
      sourceId: macOSNativeSystemAudioSourceId
    });
    expect(authorizeSystemAudio.mock.invocationCallOrder[0]).toBeLessThan(
      startNativeSystemAudio.mock.invocationCallOrder[0]!
    );
    chunkListener.current?.({
      sessionId: 'session-1',
      sequence: 0,
      capturedAt: '2026-10-23T12:00:00.000Z',
      durationMs: 1_000,
      mimeType: 'audio/x-morubi-pcm;format=f32le;rate=48000;channels=2',
      signalLevel: 0.25,
      data: new Uint8Array(new Float32Array(9_600).fill(0.25).buffer)
    });

    expect(received).toEqual([
      expect.objectContaining({
        source: 'SYSTEM_AUDIO',
        sequence: 0,
        mimeType: 'audio/pcm;rate=16000',
        durationMs: expect.any(Number)
      })
    ]);
    expect(provider.snapshot()).toMatchObject({
      state: 'ACTIVE',
      chunks: 1,
      signalLevel: 0.25,
      deviceLabel: 'Áudio da reunião'
    });
    await provider.stop();
    expect(stopNativeSystemAudio).toHaveBeenCalledWith('session-1');
  });

  it('captures the selected microphone and releases its track', async () => {
    const track = new FakeAudioTrack('Built-in Microphone', 'mic-1');
    const runtime = installMediaRuntime({
      devices: [{ deviceId: 'mic-1', kind: 'audioinput', label: track.label }],
      track
    });
    const provider = new MediaDevicesMicrophoneCaptureProvider('MACOS', 'session-1', 'mic-1', {
      changed: () => undefined,
      failed: () => undefined
    });

    await provider.start(() => undefined);
    expect(runtime.authorizeMicrophone).toHaveBeenCalledWith('session-1');
    expect(runtime.getUserMedia).toHaveBeenCalledWith({
      audio: expect.objectContaining({ deviceId: { exact: 'mic-1' } }),
      video: false
    });
    expect(provider.snapshot()).toMatchObject({ state: 'ACTIVE', deviceId: 'mic-1' });
    await provider.stop();
    expect(track.stopCalls).toBe(1);
  });

  it('fails closed when an open track produces no recorder chunks', async () => {
    vi.useFakeTimers();
    const track = new FakeAudioTrack('Built-in Microphone', 'mic-1');
    installMediaRuntime({
      devices: [{ deviceId: 'mic-1', kind: 'audioinput', label: track.label }],
      track
    });
    const failed = vi.fn();
    const provider = new MediaDevicesMicrophoneCaptureProvider('MACOS', 'session-1', 'mic-1', {
      changed: () => undefined,
      failed
    });

    await provider.start(() => undefined);
    await vi.advanceTimersByTimeAsync(5_000);

    expect(failed).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'LOCAL_MIC_NO_AUDIO_CHUNKS' })
    );
    expect(provider.snapshot()).toMatchObject({ state: 'FAILED', failures: 1 });
    expect(track.stopCalls).toBe(1);
  });

  it('keeps a silent source active while the recorder continues producing chunks', async () => {
    vi.useFakeTimers();
    const track = new FakeAudioTrack('Built-in Microphone', 'mic-1');
    installMediaRuntime({
      devices: [{ deviceId: 'mic-1', kind: 'audioinput', label: track.label }],
      track
    });
    const failed = vi.fn();
    const provider = new MediaDevicesMicrophoneCaptureProvider('MACOS', 'session-1', 'mic-1', {
      changed: () => undefined,
      failed
    });

    await provider.start(() => undefined);
    for (let elapsed = 0; elapsed < 12_000; elapsed += 4_000) {
      await vi.advanceTimersByTimeAsync(4_000);
      FakeAudioContext.latest?.processor.emitSilent();
      await Promise.resolve();
    }

    expect(provider.snapshot()).toMatchObject({ state: 'ACTIVE', signalLevel: 0 });
    expect(failed).not.toHaveBeenCalled();
    await provider.stop();
  });

  it('selects BlackHole 2ch exactly and disables voice processing', async () => {
    const devices = [
      { deviceId: 'mic-1', kind: 'audioinput' as const, label: 'Built-in Microphone' },
      { deviceId: 'bh-2', kind: 'audioinput' as const, label: 'BlackHole 2ch' },
      { deviceId: 'bh-16', kind: 'audioinput' as const, label: 'BlackHole 16ch' }
    ];
    expect(findBlackHole2chAudioInput(devices)).toEqual(devices[1]);
    const track = new FakeAudioTrack('BlackHole 2ch', 'bh-2');
    const runtime = installMediaRuntime({ devices, track });
    const provider = new MacOSBlackHoleSystemAudioCaptureProvider(
      'session-1',
      macOSBlackHoleSourceId,
      { changed: () => undefined, failed: () => undefined }
    );

    await provider.start(() => undefined);
    expect(runtime.authorizeMacOSSystemAudio).toHaveBeenCalledWith('session-1');
    expect(runtime.getUserMedia).toHaveBeenCalledWith({
      audio: {
        deviceId: { exact: 'bh-2' },
        channelCount: { ideal: 2 },
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      },
      video: false
    });
    expect(provider.snapshot()).toMatchObject({
      state: 'ACTIVE',
      deviceId: 'bh-2',
      deviceLabel: 'BlackHole 2ch'
    });
    await provider.stop();
    expect(track.stopCalls).toBe(1);
  });

  it('accepts the real Chromium virtual-device suffix without matching other channel counts', () => {
    const devices = [
      { deviceId: 'bh-real', kind: 'audioinput' as const, label: 'BlackHole 2ch (Virtual)' },
      { deviceId: 'bh-16', kind: 'audioinput' as const, label: 'BlackHole 16ch (Virtual)' }
    ];
    expect(findBlackHole2chAudioInput(devices)).toEqual(devices[0]);
  });

  it('downmixes and resamples native stereo float PCM without treating WebM as raw PCM', () => {
    const source = new Float32Array([1, 1, 1, 1, 1, 1, -1, -1, -1, -1, -1, -1]);
    const output = convertFloat32Stereo48kToPcm16Mono16k(new Uint8Array(source.buffer));
    const samples = new Int16Array(output.buffer);
    expect([...samples]).toEqual([32_767, -32_768]);
    expect(() => convertFloat32Stereo48kToPcm16Mono16k(new Uint8Array([1, 2, 3]))).toThrow(
      'SYSTEM_AUDIO_PCM_FORMAT_INVALID'
    );
  });

  it('fails closed when BlackHole 2ch is unavailable', async () => {
    const track = new FakeAudioTrack('Built-in Microphone', 'mic-1');
    installMediaRuntime({
      devices: [{ deviceId: 'mic-1', kind: 'audioinput', label: track.label }],
      track
    });
    const provider = new MacOSBlackHoleSystemAudioCaptureProvider(
      'session-1',
      macOSBlackHoleSourceId,
      { changed: () => undefined, failed: () => undefined }
    );

    await expect(provider.start(() => undefined)).rejects.toThrow('BLACKHOLE_2CH_NOT_FOUND');
    expect(provider.snapshot().state).toBe('FAILED');
  });
});
