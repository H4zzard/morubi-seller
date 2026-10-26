import { macOSBlackHoleSourceId, type Platform } from '../../shared/ipc';
import { findBlackHole2chAudioInput } from './live-audio-capture';

export interface AudioDiagnosticResult {
  peak: number;
  signalDetected: boolean;
  deviceLabel: string;
}

export function signalDetected(peak: number): boolean {
  return Number.isFinite(peak) && peak >= 0.015;
}

async function measureAudioSignal(stream: MediaStream, durationMs = 1_500): Promise<number> {
  const audioTrack = stream.getAudioTracks()[0];
  if (!audioTrack) throw new Error('AUDIO_DIAGNOSTIC_TRACK_MISSING');
  const context = new AudioContext();
  const source = context.createMediaStreamSource(new MediaStream([audioTrack]));
  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);
  const samples = new Uint8Array(analyser.fftSize);
  const deadline = performance.now() + durationMs;
  let peak = 0;
  try {
    while (performance.now() < deadline) {
      analyser.getByteTimeDomainData(samples);
      for (const sample of samples) peak = Math.max(peak, Math.abs(sample - 128) / 128);
      await new Promise<void>((resolve) => window.setTimeout(resolve, 50));
    }
    return peak;
  } finally {
    source.disconnect();
    await context.close().catch(() => undefined);
  }
}

async function resultForStream(stream: MediaStream): Promise<AudioDiagnosticResult> {
  const track = stream.getAudioTracks()[0];
  if (!track) throw new Error('AUDIO_DIAGNOSTIC_TRACK_MISSING');
  const peak = await measureAudioSignal(stream);
  return {
    peak,
    signalDetected: signalDetected(peak),
    deviceLabel: track.label.slice(0, 240) || 'Dispositivo de áudio'
  };
}

function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}

export async function inspectDiagnosticStream(
  openStream: () => Promise<MediaStream>,
  inspect: (stream: MediaStream) => Promise<AudioDiagnosticResult> = resultForStream
): Promise<AudioDiagnosticResult> {
  let stream: MediaStream | null = null;
  try {
    stream = await openStream();
    return await inspect(stream);
  } finally {
    stopStream(stream);
  }
}

export async function runMicrophoneDiagnostic(
  deviceId: string | null
): Promise<AudioDiagnosticResult> {
  await window.morubi.liveCalls.authorizeAudioDiagnostic();
  return inspectDiagnosticStream(() =>
    navigator.mediaDevices.getUserMedia({
      audio: {
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      },
      video: false
    })
  );
}

export async function runSystemAudioDiagnostic(
  platform: Platform,
  sourceId: string
): Promise<AudioDiagnosticResult> {
  if (platform === 'win32') {
    await window.morubi.liveCalls.authorizeSystemAudioDiagnostic(sourceId);
    return inspectDiagnosticStream(async () => {
      const stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
      stream.getVideoTracks().forEach((track) => track.stop());
      return stream;
    });
  }
  if (platform === 'darwin') {
    if (sourceId !== macOSBlackHoleSourceId) throw new Error('SYSTEM_AUDIO_SOURCE_INVALID');
    await window.morubi.liveCalls.authorizeAudioDiagnostic();
    const devices = await navigator.mediaDevices.enumerateDevices();
    const input = findBlackHole2chAudioInput(devices);
    if (!input) throw new Error('SYSTEM_AUDIO_SOURCE_NOT_FOUND');
    return inspectDiagnosticStream(() =>
      navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: { exact: input.deviceId },
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        },
        video: false
      })
    );
  }
  throw new Error('SYSTEM_AUDIO_CAPTURE_UNSUPPORTED');
}
