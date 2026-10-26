export const liveAudioProtocolVersion = 1;
export const liveAudioHeaderBytes = 32;
export const liveAudioAckBytes = 12;
export const liveAudioMimeType = 'audio/pcm;rate=16000';
export const liveAudioSampleRate = 16_000;
export const liveAudioChannels = 1;
export const liveAudioBytesPerSample = 2;

export type TransportAudioSource = 'LOCAL_MIC' | 'SYSTEM_AUDIO';

export interface LiveAudioPacket {
  source: TransportAudioSource;
  sequence: number;
  capturedAtMs: number;
  durationMs: number;
  sampleRate: number;
  channels: number;
  data: Uint8Array;
}

const audioMagic = 0x4d524241; // MRBA
const acknowledgementMagic = 0x4d52424b; // MRBK

function sourceCode(source: TransportAudioSource): number {
  return source === 'LOCAL_MIC' ? 1 : 2;
}

function sourceFromCode(value: number): TransportAudioSource {
  if (value === 1) return 'LOCAL_MIC';
  if (value === 2) return 'SYSTEM_AUDIO';
  throw new Error('LIVE_AUDIO_SOURCE_INVALID');
}

function assertSequence(sequence: number): void {
  if (!Number.isSafeInteger(sequence) || sequence < 0 || sequence > 0xffff_ffff)
    throw new Error('LIVE_AUDIO_SEQUENCE_INVALID');
}

export function encodeLiveAudioPacket(packet: LiveAudioPacket): Uint8Array {
  assertSequence(packet.sequence);
  if (!Number.isSafeInteger(packet.capturedAtMs) || packet.capturedAtMs < 0)
    throw new Error('LIVE_AUDIO_TIMESTAMP_INVALID');
  if (
    !Number.isSafeInteger(packet.durationMs) ||
    packet.durationMs < 1 ||
    packet.durationMs > 5_000
  )
    throw new Error('LIVE_AUDIO_DURATION_INVALID');
  if (packet.sampleRate !== liveAudioSampleRate || packet.channels !== liveAudioChannels)
    throw new Error('LIVE_AUDIO_FORMAT_INVALID');
  if (!packet.data.byteLength || packet.data.byteLength % liveAudioBytesPerSample !== 0)
    throw new Error('LIVE_AUDIO_PAYLOAD_INVALID');

  const output = new Uint8Array(liveAudioHeaderBytes + packet.data.byteLength);
  const view = new DataView(output.buffer);
  view.setUint32(0, audioMagic, false);
  view.setUint8(4, liveAudioProtocolVersion);
  view.setUint8(5, sourceCode(packet.source));
  view.setUint8(6, 1); // signed PCM 16-bit little-endian
  view.setUint8(7, 0);
  view.setUint32(8, packet.sequence, false);
  view.setBigUint64(12, BigInt(packet.capturedAtMs), false);
  view.setUint32(20, packet.durationMs, false);
  view.setUint32(24, packet.data.byteLength, false);
  view.setUint16(28, packet.sampleRate, false);
  view.setUint8(30, packet.channels);
  view.setUint8(31, 0);
  output.set(packet.data, liveAudioHeaderBytes);
  return output;
}

export function decodeLiveAudioPacket(
  input: Uint8Array,
  maxPayloadBytes = 65_536
): LiveAudioPacket {
  if (input.byteLength < liveAudioHeaderBytes) throw new Error('LIVE_AUDIO_PACKET_TOO_SHORT');
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  if (view.getUint32(0, false) !== audioMagic) throw new Error('LIVE_AUDIO_MAGIC_INVALID');
  if (view.getUint8(4) !== liveAudioProtocolVersion) throw new Error('LIVE_AUDIO_VERSION_INVALID');
  if (view.getUint8(6) !== 1 || view.getUint8(7) !== 0 || view.getUint8(31) !== 0)
    throw new Error('LIVE_AUDIO_FORMAT_INVALID');
  const sequence = view.getUint32(8, false);
  const capturedAtMs = Number(view.getBigUint64(12, false));
  const durationMs = view.getUint32(20, false);
  const payloadBytes = view.getUint32(24, false);
  const sampleRate = view.getUint16(28, false);
  const channels = view.getUint8(30);
  if (payloadBytes < 1 || payloadBytes > maxPayloadBytes)
    throw new Error('LIVE_AUDIO_PAYLOAD_SIZE_INVALID');
  if (input.byteLength !== liveAudioHeaderBytes + payloadBytes)
    throw new Error('LIVE_AUDIO_PACKET_LENGTH_MISMATCH');
  const packet: LiveAudioPacket = {
    source: sourceFromCode(view.getUint8(5)),
    sequence,
    capturedAtMs,
    durationMs,
    sampleRate,
    channels,
    data: input.slice(liveAudioHeaderBytes)
  };
  // Reuse the encoder's invariant checks without allocating a second packet.
  assertSequence(packet.sequence);
  if (!Number.isSafeInteger(capturedAtMs) || capturedAtMs < 0)
    throw new Error('LIVE_AUDIO_TIMESTAMP_INVALID');
  if (durationMs < 1 || durationMs > 5_000) throw new Error('LIVE_AUDIO_DURATION_INVALID');
  if (sampleRate !== liveAudioSampleRate || channels !== liveAudioChannels)
    throw new Error('LIVE_AUDIO_FORMAT_INVALID');
  if (packet.data.byteLength % liveAudioBytesPerSample !== 0)
    throw new Error('LIVE_AUDIO_PAYLOAD_INVALID');
  return packet;
}

export function encodeLiveAudioAcknowledgement(
  source: TransportAudioSource,
  sequence: number
): Uint8Array {
  assertSequence(sequence);
  const output = new Uint8Array(liveAudioAckBytes);
  const view = new DataView(output.buffer);
  view.setUint32(0, acknowledgementMagic, false);
  view.setUint8(4, liveAudioProtocolVersion);
  view.setUint8(5, sourceCode(source));
  view.setUint16(6, 0, false);
  view.setUint32(8, sequence, false);
  return output;
}

export function decodeLiveAudioAcknowledgement(input: Uint8Array): {
  source: TransportAudioSource;
  sequence: number;
} {
  if (input.byteLength !== liveAudioAckBytes) throw new Error('LIVE_AUDIO_ACK_LENGTH_INVALID');
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  if (view.getUint32(0, false) !== acknowledgementMagic)
    throw new Error('LIVE_AUDIO_ACK_MAGIC_INVALID');
  if (view.getUint8(4) !== liveAudioProtocolVersion || view.getUint16(6, false) !== 0)
    throw new Error('LIVE_AUDIO_ACK_VERSION_INVALID');
  return { source: sourceFromCode(view.getUint8(5)), sequence: view.getUint32(8, false) };
}

export class LiveAudioSequenceGuard {
  private readonly latest = new Map<TransportAudioSource, number>();

  public accept(
    source: TransportAudioSource,
    sequence: number
  ): {
    accepted: boolean;
    missing: number;
  } {
    assertSequence(sequence);
    const previous = this.latest.get(source);
    if (previous !== undefined && sequence <= previous) return { accepted: false, missing: 0 };
    const missing = previous === undefined ? 0 : Math.max(0, sequence - previous - 1);
    this.latest.set(source, sequence);
    return { accepted: true, missing };
  }
}
