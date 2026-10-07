import type { CaptureHealth, LiveAudioCaptureProvider, LiveAudioChunk } from '@morubi/live-calls';

export class MediaDevicesMicrophoneCaptureProvider implements LiveAudioCaptureProvider {
  public readonly mode = 'MICROPHONE' as const;
  public readonly platform: 'WINDOWS' | 'MACOS';
  private state: CaptureHealth = 'IDLE';
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private sequence = 0;

  public constructor(platform: 'WINDOWS' | 'MACOS') {
    this.platform = platform;
  }

  public async start(onChunk: (chunk: LiveAudioChunk) => void): Promise<void> {
    if (this.state === 'ACTIVE' || this.state === 'PAUSED')
      throw new Error('CAPTURE_ALREADY_ACTIVE');
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined')
      throw new Error('MICROPHONE_CAPTURE_UNSUPPORTED');
    this.state = 'STARTING';
    try {
      await window.morubi.liveCalls.authorizeMicrophone();
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false
      });
      const preferred = ['audio/webm;codecs=opus', 'audio/webm'].find((mime) =>
        MediaRecorder.isTypeSupported(mime)
      );
      this.recorder = preferred
        ? new MediaRecorder(this.stream, { mimeType: preferred })
        : new MediaRecorder(this.stream);
      this.recorder.addEventListener('dataavailable', (event) => {
        if (!event.data.size) return;
        const capturedAt = new Date();
        void event.data.arrayBuffer().then((buffer) => {
          onChunk({
            id: crypto.randomUUID(),
            sequence: this.sequence++,
            capturedAt,
            durationMs: 2_000,
            mimeType: event.data.type || 'audio/webm',
            source: 'LOCAL_SPEAKER',
            data: new Uint8Array(buffer)
          });
        });
      });
      this.recorder.start(2_000);
      this.state = 'ACTIVE';
    } catch (error) {
      this.state = 'FAILED';
      this.release();
      throw error;
    }
  }

  public pause(): Promise<void> {
    if (this.state !== 'ACTIVE' || !this.recorder) throw new Error('CAPTURE_NOT_ACTIVE');
    this.recorder.pause();
    this.state = 'PAUSED';
    return Promise.resolve();
  }

  public resume(): Promise<void> {
    if (this.state !== 'PAUSED' || !this.recorder) throw new Error('CAPTURE_NOT_PAUSED');
    this.recorder.resume();
    this.state = 'ACTIVE';
    return Promise.resolve();
  }

  public stop(): Promise<void> {
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
    this.release();
    this.state = 'STOPPED';
    return Promise.resolve();
  }

  public health(): CaptureHealth {
    return this.state;
  }

  private release(): void {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.recorder = null;
  }
}
