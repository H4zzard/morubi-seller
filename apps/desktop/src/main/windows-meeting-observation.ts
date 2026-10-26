import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { MeetingDetector } from '@morubi/live-calls';
import type { MeetingCandidateDto } from '../shared/ipc.js';
import type { MeetingObservationProvider } from './meeting-observation-provider.js';

const observationScript = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class MorubiWindowObservation {
  [DllImport("user32.dll")]
  [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool IsWindowVisible(IntPtr hWnd);
}
'@
$windows = Get-Process | Where-Object {
  $_.MainWindowHandle -ne 0 -and -not [string]::IsNullOrWhiteSpace($_.MainWindowTitle)
} | ForEach-Object {
  [PSCustomObject]@{
    processId = $_.Id
    processName = $_.ProcessName
    windowTitle = $_.MainWindowTitle
    visible = [MorubiWindowObservation]::IsWindowVisible($_.MainWindowHandle)
  }
}
@($windows) | ConvertTo-Json -Compress
`;

interface ProcessWindowObservation {
  processId: number;
  processName: string;
  windowTitle: string;
  visible: boolean;
}

export type WindowObservationRunner = () => Promise<string>;

function runWindowsObservation(): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', observationScript],
      { windowsHide: true, timeout: 5_000, maxBuffer: 1_048_576 },
      (error, stdout) => {
        if (error) reject(new Error('WINDOW_OBSERVATION_FAILED', { cause: error }));
        else resolve(stdout);
      }
    );
  });
}

function parseObservation(value: unknown): ProcessWindowObservation | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (
    !Number.isSafeInteger(record.processId) ||
    typeof record.processName !== 'string' ||
    typeof record.windowTitle !== 'string' ||
    typeof record.visible !== 'boolean'
  )
    return null;
  const processName = record.processName.trim().slice(0, 120);
  const windowTitle = record.windowTitle.trim().slice(0, 240);
  if (!processName || !windowTitle) return null;
  return {
    processId: record.processId as number,
    processName,
    windowTitle,
    visible: record.visible
  };
}

function parseObservations(raw: string): ProcessWindowObservation[] {
  if (!raw.trim()) return [];
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    throw new Error('WINDOW_OBSERVATION_INVALID_RESPONSE');
  }
  return (Array.isArray(decoded) ? decoded : [decoded])
    .map(parseObservation)
    .filter((value): value is ProcessWindowObservation => value !== null);
}

function applicationName(processName: string): string {
  const normalized = processName.toLowerCase().replace(/\.exe$/u, '');
  if (normalized === 'chrome') return 'Google Chrome';
  if (normalized === 'msedge') return 'Microsoft Edge';
  return processName;
}

function observationId(observation: ProcessWindowObservation): string {
  return createHash('sha256')
    .update(`${observation.processId}\0${observation.processName}\0${observation.windowTitle}`)
    .digest('hex')
    .slice(0, 24);
}

/**
 * Reads only top-level Windows process metadata. It never reads window contents,
 * browser URLs, frames, microphone data, or screen pixels.
 */
export class WindowsMeetingObservationProvider implements MeetingObservationProvider {
  public constructor(
    private readonly options: {
      platform?: NodeJS.Platform;
      runner?: WindowObservationRunner;
      now?: () => Date;
      detector?: MeetingDetector;
    } = {}
  ) {}

  public supported(): boolean {
    return (this.options.platform ?? process.platform) === 'win32';
  }

  public async observe(): Promise<MeetingCandidateDto[]> {
    if (!this.supported()) return [];
    const observedAt = (this.options.now ?? (() => new Date()))();
    const observations = parseObservations(await (this.options.runner ?? runWindowsObservation)());
    const detector = this.options.detector ?? new MeetingDetector();
    return observations.flatMap((observation) => {
      const detection = detector.detect({ ...observation, observedAt });
      if (
        detection?.provider !== 'MEET' ||
        detection.evidence !== 'WINDOW_TITLE' ||
        !detection.confirmationRequired
      )
        return [];
      return [
        {
          id: observationId(observation),
          provider: 'MEET',
          processId: observation.processId,
          processName: observation.processName,
          applicationName: applicationName(observation.processName),
          windowTitle: observation.windowTitle,
          visible: observation.visible,
          confidence: detection.confidence,
          evidence: 'WINDOW_TITLE',
          confirmationRequired: true,
          observedAt: observedAt.toISOString()
        }
      ];
    });
  }
}
