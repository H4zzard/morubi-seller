import {
  BoundedAudioBuffer,
  liveAudioMimeType,
  type AudioCaptureSourceMetrics,
  type CaptureHealth,
  type LiveAudioCaptureProvider,
  type LiveAudioChunk
} from '@morubi/live-calls';
import type { LiveCallHeartbeatRequest } from '@morubi/contracts';
import { macOSBlackHoleSourceId, macOSNativeSystemAudioSourceId } from '../../shared/ipc';

const chunkDurationMs = 100;
const chunkStallTimeoutMs = 5_000;

export interface CaptureProviderSnapshot {
  state: CaptureHealth;
  chunks: number;
  lastChunkAt: Date | null;
  signalLevel: number;
  muted: boolean;
  failures: number;
  deviceId: string | null;
  deviceLabel: string | null;
}

export interface ObservableCaptureProvider extends LiveAudioCaptureProvider {
  readonly technicalSource: 'LOCAL_MIC' | 'SYSTEM_AUDIO';
  snapshot(): CaptureProviderSnapshot;
}

export interface SystemAudioProvider extends ObservableCaptureProvider {
  readonly mode: 'SYSTEM_AUDIO';
  readonly technicalSource: 'SYSTEM_AUDIO';
}

export interface CaptureProviderEvents {
  changed(): void;
  failed(error: Error): void;
}

export class AudioChunkSequencer {
  private sequence = 0;

  public constructor(private readonly source: 'LOCAL_MIC' | 'SYSTEM_AUDIO') {}

  public next(input: {
    capturedAt: Date;
    durationMs: number;
    mimeType: string;
    data: Uint8Array;
  }): LiveAudioChunk {
    return {
      id: crypto.randomUUID(),
      sequence: this.sequence++,
      source: this.source,
      ...input
    };
  }
}

function captureError(error: unknown, fallback: string): Error {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError') return new Error(`${fallback}_PERMISSION_DENIED`);
    if (error.name === 'NotFoundError') return new Error(`${fallback}_DEVICE_NOT_FOUND`);
    if (error.name === 'NotReadableError') return new Error(`${fallback}_DEVICE_BUSY`);
    if (error.name === 'AbortError') return new Error(`${fallback}_CANCELLED`);
  }
  return error instanceof Error ? error : new Error(fallback);
}

class PcmMediaStreamCapture {
  private context: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private sink: GainNode | null = null;
  private output = new Int16Array(1_600);
  private outputOffset = 0;
  private resamplePosition = 0;
  private nextCapturedAtMs: number | null = null;

  public start(
    stream: MediaStream,
    onPcm: (input: {
      data: Uint8Array;
      capturedAt: Date;
      durationMs: number;
      level: number;
    }) => void
  ): void {
    const Context = window.AudioContext;
    if (!Context) throw new Error('PCM_AUDIO_CONTEXT_UNAVAILABLE');
    this.context = new Context();
    this.source = this.context.createMediaStreamSource(stream);
    this.processor = this.context.createScriptProcessor(4_096, 2, 1);
    this.sink = this.context.createGain();
    this.sink.gain.value = 0;
    this.processor.onaudioprocess = (event) => {
      const input = event.inputBuffer;
      const channels = Array.from({ length: input.numberOfChannels }, (_, index) =>
        input.getChannelData(index)
      );
      if (!channels.length) return;
      const ratio = input.sampleRate / 16_000;
      while (this.resamplePosition < input.length) {
        const index = Math.min(input.length - 1, Math.floor(this.resamplePosition));
        let sample = 0;
        for (const channel of channels) sample += channel[index] ?? 0;
        sample /= channels.length;
        const clamped = Math.max(-1, Math.min(1, sample));
        this.output[this.outputOffset++] =
          clamped < 0 ? Math.round(clamped * 32_768) : Math.round(clamped * 32_767);
        this.resamplePosition += ratio;
        if (this.outputOffset === this.output.length) {
          let sum = 0;
          for (const value of this.output) {
            const normalized = value / 32_768;
            sum += normalized * normalized;
          }
          const now = Date.now();
          const capturedAtMs = this.nextCapturedAtMs ?? now - chunkDurationMs;
          this.nextCapturedAtMs = capturedAtMs + chunkDurationMs;
          if (this.nextCapturedAtMs < now - chunkDurationMs * 2) this.nextCapturedAtMs = now;
          const bytes = new Uint8Array(this.output.buffer.slice(0));
          onPcm({
            data: bytes,
            capturedAt: new Date(capturedAtMs),
            durationMs: chunkDurationMs,
            level: Math.min(1, Math.sqrt(sum / this.output.length) * 4)
          });
          this.outputOffset = 0;
        }
      }
      this.resamplePosition -= input.length;
    };
    this.source.connect(this.processor);
    this.processor.connect(this.sink);
    this.sink.connect(this.context.destination);
    void this.context.resume();
  }

  public async pause(): Promise<void> {
    await this.context?.suspend();
  }

  public async resume(): Promise<void> {
    await this.context?.resume();
  }

  public async stop(): Promise<void> {
    if (this.processor) this.processor.onaudioprocess = null;
    this.source?.disconnect();
    this.processor?.disconnect();
    this.sink?.disconnect();
    this.source = null;
    this.processor = null;
    this.sink = null;
    this.outputOffset = 0;
    this.resamplePosition = 0;
    this.nextCapturedAtMs = null;
    const context = this.context;
    this.context = null;
    if (context) await context.close().catch(() => undefined);
  }
}

export function convertFloat32Stereo48kToPcm16Mono16k(input: Uint8Array): Uint8Array {
  if (input.byteLength === 0 || input.byteLength % 8 !== 0)
    throw new Error('SYSTEM_AUDIO_PCM_FORMAT_INVALID');
  const source = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const inputFrames = input.byteLength / 8;
  const outputFrames = Math.floor(inputFrames / 3);
  const output = new Uint8Array(outputFrames * 2);
  const target = new DataView(output.buffer);
  for (let outputFrame = 0; outputFrame < outputFrames; outputFrame += 1) {
    let averaged = 0;
    for (let frameOffset = 0; frameOffset < 3; frameOffset += 1) {
      const frame = outputFrame * 3 + frameOffset;
      const left = source.getFloat32(frame * 8, true);
      const right = source.getFloat32(frame * 8 + 4, true);
      averaged += (left + right) / 2;
    }
    const sample = Math.max(-1, Math.min(1, averaged / 3));
    target.setInt16(
      outputFrame * 2,
      sample < 0 ? Math.round(sample * 32_768) : Math.round(sample * 32_767),
      true
    );
  }
  return output;
}

class PcmChunkAccumulator {
  private readonly output = new Uint8Array(3_200);
  private offset = 0;
  private nextCapturedAtMs: number | null = null;

  public accept(data: Uint8Array, capturedAt: Date): Array<{ data: Uint8Array; capturedAt: Date }> {
    const ready: Array<{ data: Uint8Array; capturedAt: Date }> = [];
    let inputOffset = 0;
    this.nextCapturedAtMs ??= capturedAt.getTime();
    while (inputOffset < data.byteLength) {
      const copied = Math.min(this.output.byteLength - this.offset, data.byteLength - inputOffset);
      this.output.set(data.subarray(inputOffset, inputOffset + copied), this.offset);
      this.offset += copied;
      inputOffset += copied;
      if (this.offset === this.output.byteLength) {
        ready.push({
          data: this.output.slice(),
          capturedAt: new Date(this.nextCapturedAtMs)
        });
        this.nextCapturedAtMs += chunkDurationMs;
        this.offset = 0;
      }
    }
    return ready;
  }

  public clear(): void {
    this.offset = 0;
    this.nextCapturedAtMs = null;
  }
}

abstract class MediaStreamCaptureProvider implements ObservableCaptureProvider {
  public abstract readonly mode: 'MICROPHONE' | 'SYSTEM_AUDIO';
  public abstract readonly technicalSource: 'LOCAL_MIC' | 'SYSTEM_AUDIO';
  public readonly platform: 'WINDOWS' | 'MACOS';
  protected state: CaptureHealth = 'IDLE';
  protected stream: MediaStream | null = null;
  private pcmCapture: PcmMediaStreamCapture | null = null;
  private readonly sequencer: AudioChunkSequencer;
  private chunks = 0;
  private lastChunkAt: Date | null = null;
  private signalLevel = 0;
  private muted = false;
  private failures = 0;
  protected deviceId: string | null = null;
  protected deviceLabel: string | null = null;
  private activeGeneration = 0;
  private recorderStartedAt: number | null = null;
  private lastChunkReceivedAt: number | null = null;
  private chunkWatchdog: number | null = null;

  protected constructor(
    platform: 'WINDOWS' | 'MACOS',
    technicalSource: 'LOCAL_MIC' | 'SYSTEM_AUDIO',
    protected readonly events: CaptureProviderEvents
  ) {
    this.platform = platform;
    this.sequencer = new AudioChunkSequencer(technicalSource);
  }

  public async start(onChunk: (chunk: LiveAudioChunk) => void): Promise<void> {
    if (this.state === 'ACTIVE' || this.state === 'PAUSED')
      throw new Error('CAPTURE_ALREADY_ACTIVE');
    if (!navigator.mediaDevices || !window.AudioContext)
      throw new Error(`${this.technicalSource}_CAPTURE_UNSUPPORTED`);
    this.state = 'STARTING';
    this.events.changed();
    const generation = ++this.activeGeneration;
    try {
      const stream = await this.openStream();
      if (generation !== this.activeGeneration) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const audioTrack = stream.getAudioTracks()[0];
      if (!audioTrack) throw new Error(`${this.technicalSource}_TRACK_MISSING`);
      this.stream = stream;
      this.deviceId = audioTrack.getSettings().deviceId ?? this.deviceId;
      this.deviceLabel = audioTrack.label.slice(0, 240) || this.deviceLabel;
      this.muted = audioTrack.muted;
      audioTrack.addEventListener('mute', () => {
        this.muted = true;
        this.events.changed();
      });
      audioTrack.addEventListener('unmute', () => {
        this.muted = false;
        this.events.changed();
      });
      audioTrack.addEventListener('ended', () => {
        if (this.state === 'STOPPED') return;
        this.fail(new Error(`${this.technicalSource}_TRACK_ENDED`));
      });
      this.afterStreamOpened(stream);
      this.pcmCapture = new PcmMediaStreamCapture();
      this.pcmCapture.start(new MediaStream([audioTrack]), (pcm) => {
        if (
          !pcm.data.byteLength ||
          generation !== this.activeGeneration ||
          this.state === 'STOPPED'
        )
          return;
        this.lastChunkReceivedAt = Date.now();
        this.signalLevel = pcm.level;
        const chunk = this.sequencer.next({
          capturedAt: pcm.capturedAt,
          durationMs: pcm.durationMs,
          mimeType: liveAudioMimeType,
          data: pcm.data
        });
        this.chunks += 1;
        this.lastChunkAt = pcm.capturedAt;
        onChunk(chunk);
        this.events.changed();
      });
      this.recorderStartedAt = Date.now();
      this.startChunkWatchdog();
      this.state = 'ACTIVE';
      this.events.changed();
    } catch (error) {
      this.fail(captureError(error, this.technicalSource));
      throw captureError(error, this.technicalSource);
    }
  }

  public async pause(): Promise<void> {
    if (this.state !== 'ACTIVE' || !this.pcmCapture) throw new Error('CAPTURE_NOT_ACTIVE');
    await this.pcmCapture.pause();
    this.state = 'PAUSED';
    this.events.changed();
  }

  public async resume(): Promise<void> {
    if (this.state !== 'PAUSED' || !this.pcmCapture) throw new Error('CAPTURE_NOT_PAUSED');
    await this.pcmCapture.resume();
    this.state = 'ACTIVE';
    this.events.changed();
  }

  public async stop(): Promise<void> {
    this.activeGeneration += 1;
    await this.release();
    this.state = 'STOPPED';
    this.events.changed();
  }

  public health(): CaptureHealth {
    return this.state;
  }

  public snapshot(): CaptureProviderSnapshot {
    return {
      state: this.state,
      chunks: this.chunks,
      lastChunkAt: this.lastChunkAt,
      signalLevel: this.signalLevel,
      muted: this.muted,
      failures: this.failures,
      deviceId: this.deviceId,
      deviceLabel: this.deviceLabel
    };
  }

  protected abstract openStream(): Promise<MediaStream>;

  protected afterStreamOpened(stream: MediaStream): void {
    void stream;
  }

  protected fail(error: Error): void {
    if (this.state === 'FAILED' || this.state === 'STOPPED') return;
    this.failures += 1;
    this.state = 'FAILED';
    void this.release();
    this.events.changed();
    this.events.failed(error);
  }

  private startChunkWatchdog(): void {
    if (this.chunkWatchdog !== null) window.clearInterval(this.chunkWatchdog);
    this.chunkWatchdog = window.setInterval(() => {
      if (this.state !== 'ACTIVE' || this.recorderStartedAt === null) return;
      const lastActivityAt = this.lastChunkReceivedAt ?? this.recorderStartedAt;
      if (Date.now() - lastActivityAt >= chunkStallTimeoutMs)
        this.fail(new Error(`${this.technicalSource}_NO_AUDIO_CHUNKS`));
    }, chunkDurationMs);
  }

  private async release(): Promise<void> {
    if (this.chunkWatchdog !== null) window.clearInterval(this.chunkWatchdog);
    this.chunkWatchdog = null;
    this.recorderStartedAt = null;
    this.lastChunkReceivedAt = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    await this.pcmCapture?.stop();
    this.pcmCapture = null;
    this.signalLevel = 0;
  }
}

export interface MicrophoneDevice {
  deviceId: string;
  label: string;
}

export interface AudioDeviceManager {
  enumerate(): Promise<MediaDeviceInfo[]>;
}

export class MediaDevicesAudioDeviceManager implements AudioDeviceManager {
  public enumerate(): Promise<MediaDeviceInfo[]> {
    if (!navigator.mediaDevices?.enumerateDevices) return Promise.resolve([]);
    return navigator.mediaDevices.enumerateDevices();
  }
}

const audioDeviceManager = new MediaDevicesAudioDeviceManager();

interface AudioInputDescriptor {
  deviceId: string;
  kind: MediaDeviceKind;
  label: string;
}

export function isBlackHole2chAudioInput(device: AudioInputDescriptor): boolean {
  return (
    device.kind === 'audioinput' &&
    /^blackhole\s*2ch(?:\s*\(virtual\))?$/iu.test(device.label.trim())
  );
}

export function findBlackHole2chAudioInput(
  devices: readonly AudioInputDescriptor[]
): AudioInputDescriptor | null {
  return devices.find(isBlackHole2chAudioInput) ?? null;
}

export async function enumerateMicrophones(): Promise<MicrophoneDevice[]> {
  const devices = await audioDeviceManager.enumerate();
  let microphoneIndex = 0;
  return devices
    .filter((device) => device.kind === 'audioinput' && !isBlackHole2chAudioInput(device))
    .map((device) => {
      microphoneIndex += 1;
      return {
        deviceId: device.deviceId,
        label: device.label || `Microfone ${microphoneIndex}`
      };
    });
}

export class MediaDevicesMicrophoneCaptureProvider extends MediaStreamCaptureProvider {
  public readonly mode = 'MICROPHONE' as const;
  public readonly technicalSource = 'LOCAL_MIC' as const;
  private readonly onDeviceChange = () => void this.validateSelectedDevice();

  public constructor(
    platform: 'WINDOWS' | 'MACOS',
    private readonly sessionId: string,
    private readonly selectedDeviceId: string | null,
    events: CaptureProviderEvents
  ) {
    super(platform, 'LOCAL_MIC', events);
    this.deviceId = selectedDeviceId;
  }

  protected async openStream(): Promise<MediaStream> {
    await window.morubi.liveCalls.authorizeMicrophone(this.sessionId);
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        ...(this.selectedDeviceId ? { deviceId: { exact: this.selectedDeviceId } } : {}),
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      },
      video: false
    });
    navigator.mediaDevices.addEventListener('devicechange', this.onDeviceChange);
    return stream;
  }

  public override async stop(): Promise<void> {
    navigator.mediaDevices?.removeEventListener('devicechange', this.onDeviceChange);
    await super.stop();
  }

  private async validateSelectedDevice(): Promise<void> {
    if (!this.deviceId || this.health() === 'STOPPED') return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      if (
        !devices.some((device) => device.kind === 'audioinput' && device.deviceId === this.deviceId)
      )
        this.fail(new Error('LOCAL_MIC_DEVICE_REMOVED'));
    } catch {
      this.fail(new Error('LOCAL_MIC_DEVICE_ENUMERATION_FAILED'));
    }
  }
}

export class WindowsSystemAudioCaptureProvider
  extends MediaStreamCaptureProvider
  implements SystemAudioProvider
{
  public readonly mode = 'SYSTEM_AUDIO' as const;
  public readonly technicalSource = 'SYSTEM_AUDIO' as const;

  public constructor(
    private readonly sessionId: string,
    private readonly sourceId: string,
    events: CaptureProviderEvents
  ) {
    super('WINDOWS', 'SYSTEM_AUDIO', events);
    this.deviceId = sourceId;
    this.deviceLabel = 'Loopback de áudio do Windows';
  }

  protected async openStream(): Promise<MediaStream> {
    await window.morubi.liveCalls.authorizeSystemAudio({
      sessionId: this.sessionId,
      sourceId: this.sourceId
    });
    return navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
  }

  protected override afterStreamOpened(stream: MediaStream): void {
    // Electron/Chromium requires a video source to authorize Windows loopback.
    // Frames are never read or persisted; the technical track is stopped immediately.
    stream.getVideoTracks().forEach((track) => track.stop());
  }
}

export class MacOSNativeSystemAudioCaptureProvider implements SystemAudioProvider {
  public readonly platform = 'MACOS' as const;
  public readonly mode = 'SYSTEM_AUDIO' as const;
  public readonly technicalSource = 'SYSTEM_AUDIO' as const;
  private state: CaptureHealth = 'IDLE';
  private readonly sequencer = new AudioChunkSequencer('SYSTEM_AUDIO');
  private chunks = 0;
  private lastChunkAt: Date | null = null;
  private signalLevel = 0;
  private failures = 0;
  private onChunk: ((chunk: LiveAudioChunk) => void) | null = null;
  private removeChunkListener: (() => void) | null = null;
  private removeFailureListener: (() => void) | null = null;
  private chunkWatchdog: number | null = null;
  private lastChunkReceivedAt: number | null = null;
  private readonly pcmChunks = new PcmChunkAccumulator();

  public constructor(
    private readonly sessionId: string,
    private readonly sourceId: string,
    private readonly events: CaptureProviderEvents
  ) {}

  public async start(onChunk: (chunk: LiveAudioChunk) => void): Promise<void> {
    if (this.state === 'ACTIVE' || this.state === 'PAUSED')
      throw new Error('CAPTURE_ALREADY_ACTIVE');
    if (this.sourceId !== macOSNativeSystemAudioSourceId)
      throw new Error('MACOS_NATIVE_SYSTEM_AUDIO_SOURCE_INVALID');
    this.onChunk = onChunk;
    await this.startHelper();
  }

  public async pause(): Promise<void> {
    if (this.state !== 'ACTIVE') throw new Error('CAPTURE_NOT_ACTIVE');
    await this.stopHelper();
    this.state = 'PAUSED';
    this.events.changed();
  }

  public async resume(): Promise<void> {
    if (this.state !== 'PAUSED' || !this.onChunk) throw new Error('CAPTURE_NOT_PAUSED');
    await this.startHelper();
  }

  public async stop(): Promise<void> {
    await this.stopHelper();
    this.onChunk = null;
    this.signalLevel = 0;
    this.state = 'STOPPED';
    this.events.changed();
  }

  public health(): CaptureHealth {
    return this.state;
  }

  public snapshot(): CaptureProviderSnapshot {
    return {
      state: this.state,
      chunks: this.chunks,
      lastChunkAt: this.lastChunkAt,
      signalLevel: this.signalLevel,
      muted: false,
      failures: this.failures,
      deviceId: macOSNativeSystemAudioSourceId,
      deviceLabel: 'Áudio da reunião'
    };
  }

  private async startHelper(): Promise<void> {
    this.state = 'STARTING';
    this.events.changed();
    this.removeChunkListener = window.morubi.liveCalls.onNativeSystemAudioChunk((chunk) => {
      if (chunk.sessionId !== this.sessionId || this.state !== 'ACTIVE' || !this.onChunk) return;
      const capturedAt = new Date(chunk.capturedAt);
      if (!Number.isFinite(capturedAt.getTime()) || !chunk.data.byteLength) return;
      let pcm: Uint8Array;
      try {
        pcm = convertFloat32Stereo48kToPcm16Mono16k(new Uint8Array(chunk.data));
      } catch {
        this.fail(new Error('SYSTEM_AUDIO_PCM_FORMAT_INVALID'));
        return;
      }
      this.lastChunkReceivedAt = Date.now();
      this.signalLevel = Math.max(0, Math.min(1, chunk.signalLevel));
      for (const ready of this.pcmChunks.accept(pcm, capturedAt)) {
        this.lastChunkAt = ready.capturedAt;
        this.chunks += 1;
        this.onChunk(
          this.sequencer.next({
            capturedAt: ready.capturedAt,
            durationMs: chunkDurationMs,
            mimeType: liveAudioMimeType,
            data: ready.data
          })
        );
      }
      this.events.changed();
    });
    this.removeFailureListener = window.morubi.liveCalls.onNativeSystemAudioFailure((failure) => {
      if (failure.sessionId === this.sessionId) this.fail(new Error(failure.code));
    });
    try {
      await window.morubi.liveCalls.authorizeSystemAudio({
        sessionId: this.sessionId,
        sourceId: macOSNativeSystemAudioSourceId
      });
      await window.morubi.liveCalls.startNativeSystemAudio(this.sessionId);
      this.state = 'ACTIVE';
      this.lastChunkReceivedAt = Date.now();
      this.startWatchdog();
      this.events.changed();
    } catch (error) {
      await this.stopHelper();
      this.fail(captureError(error, 'MACOS_NATIVE_SYSTEM_AUDIO'));
      throw captureError(error, 'MACOS_NATIVE_SYSTEM_AUDIO');
    }
  }

  private async stopHelper(): Promise<void> {
    if (this.chunkWatchdog !== null) window.clearInterval(this.chunkWatchdog);
    this.chunkWatchdog = null;
    this.lastChunkReceivedAt = null;
    this.pcmChunks.clear();
    this.removeChunkListener?.();
    this.removeFailureListener?.();
    this.removeChunkListener = null;
    this.removeFailureListener = null;
    await window.morubi.liveCalls.stopNativeSystemAudio(this.sessionId).catch(() => undefined);
  }

  private startWatchdog(): void {
    if (this.chunkWatchdog !== null) window.clearInterval(this.chunkWatchdog);
    this.chunkWatchdog = window.setInterval(() => {
      if (
        this.state === 'ACTIVE' &&
        this.lastChunkReceivedAt !== null &&
        Date.now() - this.lastChunkReceivedAt >= chunkStallTimeoutMs
      )
        this.fail(new Error('SYSTEM_AUDIO_NO_AUDIO_CHUNKS'));
    }, chunkDurationMs);
  }

  private fail(error: Error): void {
    if (this.state === 'FAILED' || this.state === 'STOPPED') return;
    this.failures += 1;
    this.state = 'FAILED';
    void this.stopHelper();
    this.events.changed();
    this.events.failed(error);
  }
}

export class MacOSBlackHoleSystemAudioCaptureProvider
  extends MediaStreamCaptureProvider
  implements SystemAudioProvider
{
  public readonly mode = 'SYSTEM_AUDIO' as const;
  public readonly technicalSource = 'SYSTEM_AUDIO' as const;
  private readonly onDeviceChange = () => void this.validateBlackHoleDevice();

  public constructor(
    private readonly sessionId: string,
    private readonly sourceId: string,
    events: CaptureProviderEvents,
    private readonly deviceManager: AudioDeviceManager = audioDeviceManager
  ) {
    super('MACOS', 'SYSTEM_AUDIO', events);
    this.deviceLabel = 'BlackHole 2ch';
  }

  protected async openStream(): Promise<MediaStream> {
    if (this.sourceId !== macOSBlackHoleSourceId)
      throw new Error('MACOS_SYSTEM_AUDIO_SOURCE_INVALID');
    await window.morubi.liveCalls.authorizeMacOSSystemAudio(this.sessionId);
    const devices = await this.deviceManager.enumerate();
    const blackHole = findBlackHole2chAudioInput(devices);
    if (!blackHole) throw new Error('BLACKHOLE_2CH_NOT_FOUND');
    this.deviceId = blackHole.deviceId;
    this.deviceLabel = blackHole.label;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: { exact: blackHole.deviceId },
        channelCount: { ideal: 2 },
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      },
      video: false
    });
    navigator.mediaDevices.addEventListener('devicechange', this.onDeviceChange);
    return stream;
  }

  public override async stop(): Promise<void> {
    navigator.mediaDevices?.removeEventListener('devicechange', this.onDeviceChange);
    await super.stop();
  }

  private async validateBlackHoleDevice(): Promise<void> {
    if (!this.deviceId || this.health() === 'STOPPED') return;
    try {
      const devices = await this.deviceManager.enumerate();
      if (
        !devices.some(
          (device) => device.deviceId === this.deviceId && isBlackHole2chAudioInput(device)
        )
      )
        this.fail(new Error('BLACKHOLE_2CH_REMOVED'));
    } catch {
      this.fail(new Error('MACOS_SYSTEM_AUDIO_DEVICE_ENUMERATION_FAILED'));
    }
  }
}

export interface DualCaptureSnapshot {
  active: boolean;
  bufferedBytes: number;
  droppedChunks: number;
  capturedChunks: number;
  sourceFailures: number;
  reconnects: number;
  sources: AudioCaptureSourceMetrics[];
}

export class DualAudioCaptureController {
  private readonly buffers = new Map<'LOCAL_MIC' | 'SYSTEM_AUDIO', BoundedAudioBuffer>();
  private active = false;
  private stopping = false;
  private failureHandled = false;
  private readonly draining = new Set<'LOCAL_MIC' | 'SYSTEM_AUDIO'>();

  public constructor(
    private readonly microphone: ObservableCaptureProvider,
    private readonly systemAudio: ObservableCaptureProvider,
    private readonly maxBufferBytes: number,
    private readonly onChanged: (snapshot: DualCaptureSnapshot) => void,
    private readonly onFailure: (error: Error) => void,
    private readonly transport?: (chunk: LiveAudioChunk) => Promise<void>,
    private readonly onTransportFailure?: (error: Error) => void
  ) {
    const sourceLimit = Math.max(1, Math.floor(maxBufferBytes / 2));
    this.buffers.set('LOCAL_MIC', new BoundedAudioBuffer(sourceLimit));
    this.buffers.set('SYSTEM_AUDIO', new BoundedAudioBuffer(sourceLimit));
  }

  public async start(): Promise<void> {
    if (this.active) throw new Error('DUAL_CAPTURE_ALREADY_ACTIVE');
    this.failureHandled = false;
    try {
      await this.microphone.start((chunk) => this.accept(chunk));
      await this.systemAudio.start((chunk) => this.accept(chunk));
      this.active = true;
      void this.drain('LOCAL_MIC');
      void this.drain('SYSTEM_AUDIO');
      this.emit();
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  public async stop(): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    this.active = false;
    await Promise.allSettled([this.microphone.stop(), this.systemAudio.stop()]);
    for (const buffer of this.buffers.values()) buffer.clear();
    this.stopping = false;
    this.emit();
  }

  public handleProviderFailure(error: Error): void {
    if (this.stopping || this.failureHandled) return;
    this.failureHandled = true;
    void this.stop().finally(() => this.onFailure(error));
  }

  public snapshot(): DualCaptureSnapshot {
    const sources = [this.microphone, this.systemAudio].map((provider) => {
      const providerSnapshot = provider.snapshot();
      const buffer = this.buffers.get(provider.technicalSource)!.snapshot();
      return {
        source: provider.technicalSource,
        state: providerSnapshot.state,
        chunks: providerSnapshot.chunks,
        bufferedBytes: buffer.bytes,
        droppedChunks: buffer.droppedChunks,
        lastChunkAt: providerSnapshot.lastChunkAt,
        signalLevel: providerSnapshot.signalLevel,
        muted: providerSnapshot.muted,
        failures: providerSnapshot.failures,
        deviceId: providerSnapshot.deviceId,
        deviceLabel: providerSnapshot.deviceLabel
      } satisfies AudioCaptureSourceMetrics;
    });
    return {
      active: this.active,
      bufferedBytes: sources.reduce((total, source) => total + source.bufferedBytes, 0),
      droppedChunks: sources.reduce((total, source) => total + source.droppedChunks, 0),
      capturedChunks: sources.reduce((total, source) => total + source.chunks, 0),
      sourceFailures: sources.reduce((total, source) => total + source.failures, 0),
      reconnects: 0,
      sources
    };
  }

  public heartbeat(now = new Date()): LiveCallHeartbeatRequest {
    const snapshot = this.snapshot();
    return {
      bufferedBytes: snapshot.bufferedBytes,
      droppedChunks: snapshot.droppedChunks,
      capturedChunks: snapshot.capturedChunks,
      sourceFailures: snapshot.sourceFailures,
      reconnects: snapshot.reconnects,
      sources: snapshot.sources.map((source) => ({
        ...source,
        lastChunkAt: source.lastChunkAt?.toISOString() ?? null,
        lastChunkAgeMs: source.lastChunkAt
          ? Math.max(0, now.getTime() - source.lastChunkAt.getTime())
          : null
      }))
    };
  }

  private accept(chunk: LiveAudioChunk): void {
    if (chunk.source !== 'LOCAL_MIC' && chunk.source !== 'SYSTEM_AUDIO') return;
    this.buffers.get(chunk.source)!.push(chunk);
    this.emit();
    void this.drain(chunk.source);
  }

  private async drain(source: 'LOCAL_MIC' | 'SYSTEM_AUDIO'): Promise<void> {
    if (!this.transport || this.draining.has(source)) return;
    this.draining.add(source);
    let failures = 0;
    try {
      while (this.active && !this.stopping) {
        const buffer = this.buffers.get(source)!;
        const chunk = buffer.peek();
        if (!chunk) break;
        try {
          await this.transport(chunk);
          buffer.acknowledge(chunk.id);
          failures = 0;
          this.emit();
        } catch (error) {
          failures += 1;
          this.onTransportFailure?.(
            error instanceof Error ? error : new Error('LIVE_AUDIO_TRANSPORT_FAILED')
          );
          await new Promise((resolve) =>
            globalThis.setTimeout(resolve, Math.min(2_000, 125 * 2 ** Math.min(failures, 4)))
          );
        }
      }
    } finally {
      this.draining.delete(source);
      if (this.active && this.buffers.get(source)!.peek()) void this.drain(source);
    }
  }

  private emit(): void {
    this.onChanged(this.snapshot());
  }
}
