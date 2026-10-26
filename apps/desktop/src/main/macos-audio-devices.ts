import { execFile } from 'node:child_process';
import {
  macOSBlackHoleSourceId,
  type SystemAudioSourceDto
} from '../shared/ipc.js';

export { macOSBlackHoleSourceId } from '../shared/ipc.js';

export type MacOSAudioInventoryRunner = () => Promise<string>;

function runSystemProfiler(): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      '/usr/sbin/system_profiler',
      ['SPAudioDataType', '-json', '-detailLevel', 'mini'],
      { timeout: 5_000, maxBuffer: 2_097_152 },
      (error, stdout) => {
        if (error) reject(new Error('MACOS_AUDIO_DEVICE_ENUMERATION_FAILED', { cause: error }));
        else resolve(stdout);
      }
    );
  });
}

function collectAudioItems(value: unknown, result: Record<string, unknown>[]): void {
  if (Array.isArray(value)) {
    value.forEach((item) => collectAudioItems(item, result));
    return;
  }
  if (!value || typeof value !== 'object') return;
  const record = value as Record<string, unknown>;
  if (typeof record._name === 'string' && typeof record.coreaudio_device_input === 'number')
    result.push(record);
  Object.values(record).forEach((item) => collectAudioItems(item, result));
}

export function isBlackHole2chLabel(label: string): boolean {
  return /^blackhole\s*2ch$/iu.test(label.trim());
}

export function parseMacOSSystemAudioSources(raw: string): SystemAudioSourceDto[] {
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    throw new Error('MACOS_AUDIO_DEVICE_ENUMERATION_INVALID_RESPONSE');
  }
  const items: Record<string, unknown>[] = [];
  collectAudioItems(decoded, items);
  return items
    .filter((item) => isBlackHole2chLabel(String(item._name)))
    .map((item) => ({
      id: macOSBlackHoleSourceId,
      name: String(item._name).slice(0, 240),
      kind: 'VIRTUAL_DEVICE' as const
    }))
    .slice(0, 1);
}

export class MacOSAudioDeviceInventoryProvider {
  public constructor(
    private readonly options: {
      platform?: NodeJS.Platform;
      runner?: MacOSAudioInventoryRunner;
    } = {}
  ) {}

  public async listSystemAudioSources(): Promise<SystemAudioSourceDto[]> {
    if ((this.options.platform ?? process.platform) !== 'darwin') return [];
    return parseMacOSSystemAudioSources(await (this.options.runner ?? runSystemProfiler)());
  }
}
