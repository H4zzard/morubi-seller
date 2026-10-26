import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';

export const macOSNativeSystemAudioSourceId = 'macos:native-system-audio';

export interface NativeSystemAudioChunk {
  sessionId: string;
  sequence: number;
  capturedAt: string;
  durationMs: number;
  mimeType: string;
  signalLevel: number;
  data: Uint8Array;
}

export interface NativeSystemAudioStartResult {
  method: 'MACOS_SCREEN_CAPTURE_KIT';
  deviceLabel: string;
}

interface HelperReadyEvent {
  type: 'ready';
  method: 'MACOS_SCREEN_CAPTURE_KIT';
  sessionId: string;
}

interface HelperChunkEvent {
  type: 'chunk';
  sessionId: string;
  sequence: number;
  capturedAt: string;
  durationMs: number;
  mimeType: string;
  signalLevel: number;
  data: string;
}

interface HelperErrorEvent {
  type: 'error';
  code: string;
  message: string;
}

type HelperEvent = HelperReadyEvent | HelperChunkEvent | HelperErrorEvent;

export function parseMacOSVersion(value: string): { major: number; minor: number; patch: number } {
  const [major = '0', minor = '0', patch = '0'] = value.split('.', 3);
  return {
    major: Number.parseInt(major, 10) || 0,
    minor: Number.parseInt(minor, 10) || 0,
    patch: Number.parseInt(patch, 10) || 0
  };
}

export function supportsScreenCaptureKitAudio(systemVersion: string): boolean {
  return parseMacOSVersion(systemVersion).major >= 13;
}

function helperEvent(value: unknown): HelperEvent | null {
  if (!value || typeof value !== 'object' || !('type' in value)) return null;
  if (value.type === 'ready') {
    if (
      'method' in value &&
      value.method === 'MACOS_SCREEN_CAPTURE_KIT' &&
      'sessionId' in value &&
      typeof value.sessionId === 'string'
    )
      return { type: 'ready', method: value.method, sessionId: value.sessionId };
    return null;
  }
  if (value.type === 'chunk') {
    if (
      !('sessionId' in value) ||
      typeof value.sessionId !== 'string' ||
      !('sequence' in value) ||
      typeof value.sequence !== 'number' ||
      !Number.isSafeInteger(value.sequence) ||
      value.sequence < 0 ||
      !('capturedAt' in value) ||
      typeof value.capturedAt !== 'string' ||
      !('durationMs' in value) ||
      typeof value.durationMs !== 'number' ||
      !Number.isFinite(value.durationMs) ||
      value.durationMs <= 0 ||
      !('mimeType' in value) ||
      typeof value.mimeType !== 'string' ||
      !('signalLevel' in value) ||
      typeof value.signalLevel !== 'number' ||
      !Number.isFinite(value.signalLevel) ||
      !('data' in value) ||
      typeof value.data !== 'string' ||
      value.data.length > 1_500_000
    )
      return null;
    return {
      type: 'chunk',
      sessionId: value.sessionId,
      sequence: value.sequence,
      capturedAt: value.capturedAt,
      durationMs: value.durationMs,
      mimeType: value.mimeType,
      signalLevel: Math.max(0, Math.min(1, value.signalLevel)),
      data: value.data
    };
  }
  if (
    value.type === 'error' &&
    'code' in value &&
    typeof value.code === 'string' &&
    'message' in value &&
    typeof value.message === 'string'
  )
    return { type: 'error', code: value.code, message: value.message };
  return null;
}

export interface MacOSNativeAudioEngineOptions {
  helperPath: string;
  systemVersion: string;
  platform?: NodeJS.Platform;
  startupTimeoutMs?: number;
  stopTimeoutMs?: number;
  spawnHelper?: typeof spawn;
  screenPermissionStatus?: () => string;
}

export class MacOSNativeAudioEngine {
  private child: ChildProcessWithoutNullStreams | null = null;
  private sessionId: string | null = null;
  private token: string | null = null;
  private stdoutBuffer = '';
  private stopping = false;
  private readonly chunkListeners = new Set<(chunk: NativeSystemAudioChunk) => void>();
  private readonly failureListeners = new Set<(sessionId: string, error: Error) => void>();

  public constructor(private readonly options: MacOSNativeAudioEngineOptions) {}

  public async available(): Promise<boolean> {
    if ((this.options.platform ?? process.platform) !== 'darwin') return false;
    if (!supportsScreenCaptureKitAudio(this.options.systemVersion)) return false;
    try {
      await access(this.options.helperPath, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }

  public onChunk(listener: (chunk: NativeSystemAudioChunk) => void): () => void {
    this.chunkListeners.add(listener);
    return () => this.chunkListeners.delete(listener);
  }

  public onFailure(listener: (sessionId: string, error: Error) => void): () => void {
    this.failureListeners.add(listener);
    return () => this.failureListeners.delete(listener);
  }

  public async start(sessionId: string): Promise<NativeSystemAudioStartResult> {
    if (!(await this.available())) throw new Error('MACOS_NATIVE_SYSTEM_AUDIO_UNAVAILABLE');
    if (this.child || this.sessionId) throw new Error('MACOS_NATIVE_SYSTEM_AUDIO_ALREADY_ACTIVE');
    const token = randomBytes(32).toString('hex');
    const child = (this.options.spawnHelper ?? spawn)(this.options.helperPath, ['--stream'], {
      env: {
        MORUBI_AUDIO_HELPER_TOKEN: token,
        MORUBI_AUDIO_SESSION_ID: sessionId,
        LANG: 'en_US.UTF-8'
      },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    this.child = child;
    this.sessionId = sessionId;
    this.token = token;
    this.stdoutBuffer = '';
    this.stopping = false;

    return new Promise<NativeSystemAudioStartResult>((resolve, reject) => {
      let settled = false;
      let stderr = '';
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        void this.stop(sessionId);
        reject(new Error('MACOS_NATIVE_SYSTEM_AUDIO_START_TIMEOUT'));
      }, this.options.startupTimeoutMs ?? 120_000);
      timeout.unref();
      const failStart = (error: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(error);
      };
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (part: string) => {
        this.stdoutBuffer += part;
        if (this.stdoutBuffer.length > 2_000_000) {
          failStart(new Error('MACOS_NATIVE_SYSTEM_AUDIO_PROTOCOL_INVALID'));
          void this.stop(sessionId);
          return;
        }
        for (;;) {
          const newline = this.stdoutBuffer.indexOf('\n');
          if (newline < 0) break;
          const line = this.stdoutBuffer.slice(0, newline);
          this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
          const event = this.parseEvent(line);
          if (!event) continue;
          if (event.type === 'ready') {
            if (event.sessionId !== sessionId) {
              failStart(new Error('MACOS_NATIVE_SYSTEM_AUDIO_SESSION_MISMATCH'));
              void this.stop(sessionId);
              return;
            }
            if (!settled) {
              settled = true;
              clearTimeout(timeout);
              resolve({
                method: event.method,
                deviceLabel: 'Áudio da reunião'
              });
            }
          } else if (event.type === 'chunk') {
            this.deliverChunk(event);
          } else {
            failStart(this.publicFailure());
          }
        }
      });
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (part: string) => {
        stderr = `${stderr}${part}`.slice(-2_000);
      });
      child.on('error', () => failStart(new Error('MACOS_NATIVE_SYSTEM_AUDIO_UNAVAILABLE')));
      child.on('exit', (code) => {
        clearTimeout(timeout);
        const wasStopping = this.stopping;
        const activeSessionId = this.sessionId;
        this.reset();
        if (!settled) {
          settled = true;
          reject(this.publicFailure(stderr));
          return;
        }
        if (!wasStopping && activeSessionId && code !== 0) {
          const error = this.publicFailure(stderr);
          for (const listener of this.failureListeners) listener(activeSessionId, error);
        }
      });
      child.stdin.write(`${JSON.stringify({ type: 'authenticate', token })}\n`);
    });
  }

  public async stop(sessionId?: string): Promise<void> {
    const child = this.child;
    if (!child) return;
    if (sessionId && this.sessionId && sessionId !== this.sessionId) return;
    this.stopping = true;
    const token = this.token;
    if (token && child.stdin.writable)
      child.stdin.write(`${JSON.stringify({ type: 'stop', token })}\n`);
    await new Promise<void>((resolve) => {
      let completed = false;
      let timeout: NodeJS.Timeout | null = null;
      const finish = (): void => {
        if (completed) return;
        completed = true;
        if (timeout) clearTimeout(timeout);
        resolve();
      };
      child.once('exit', finish);
      timeout = setTimeout(() => {
        if (!child.killed) child.kill('SIGTERM');
        finish();
      }, this.options.stopTimeoutMs ?? 5_000);
      timeout.unref();
    });
    if (this.child === child) this.reset();
  }

  private parseEvent(line: string): HelperEvent | null {
    try {
      return helperEvent(JSON.parse(line));
    } catch {
      return null;
    }
  }

  private deliverChunk(event: HelperChunkEvent): void {
    if (event.sessionId !== this.sessionId) return;
    const data = Buffer.from(event.data, 'base64');
    if (!data.byteLength || data.byteLength > 1_000_000) return;
    const chunk: NativeSystemAudioChunk = {
      sessionId: event.sessionId,
      sequence: event.sequence,
      capturedAt: event.capturedAt,
      durationMs: event.durationMs,
      mimeType: event.mimeType,
      signalLevel: event.signalLevel,
      data: new Uint8Array(data)
    };
    for (const listener of this.chunkListeners) listener(chunk);
  }

  private publicFailure(diagnostic = ''): Error {
    const permission = this.options.screenPermissionStatus?.();
    const permissionFailure = /permission|denied|declined|not authorized|tcc|autoriz/iu.test(
      diagnostic
    );
    return new Error(
      permission === 'granted' && !permissionFailure
        ? 'MACOS_NATIVE_SYSTEM_AUDIO_FAILED'
        : 'MACOS_NATIVE_SYSTEM_AUDIO_PERMISSION_REQUIRED'
    );
  }

  private reset(): void {
    this.child = null;
    this.sessionId = null;
    this.token = null;
    this.stdoutBuffer = '';
    this.stopping = false;
  }
}
