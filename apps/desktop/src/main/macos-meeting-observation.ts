import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { desktopCapturer } from 'electron';
import { MeetingDetector } from '@morubi/live-calls';
import type { MeetingCandidateDto } from '../shared/ipc.js';
import type { MeetingObservationProvider } from './meeting-observation-provider.js';

const supportedApplications = new Set([
  'Google Chrome',
  'Google Chrome Beta',
  'Google Chrome Canary'
]);

const observationScript = String.raw`
ObjC.import('Cocoa');
ObjC.import('CoreGraphics');
const result = [];
const windows = $.CGWindowListCopyWindowInfo(
  $.kCGWindowListOptionOnScreenOnly,
  $.kCGNullWindowID
);
const count = Number($.CFArrayGetCount(windows));
for (let index = 0; index < count; index += 1) {
  const window = ObjC.wrap($.CFArrayGetValueAtIndex(windows, index));
  const value = (key) => ObjC.unwrap(window.objectForKey(key));
  const layer = Number(value($.kCGWindowLayer));
  if (layer !== 0) continue;
  result.push({
    windowId: Number(value($.kCGWindowNumber)),
    processId: Number(value($.kCGWindowOwnerPID)),
    applicationName: String(value($.kCGWindowOwnerName) || ''),
    visible: Boolean(value($.kCGWindowIsOnscreen))
  });
}

JSON.stringify(result);
`;

interface CoreGraphicsWindowObservation {
  windowId: number;
  processId: number;
  applicationName: string;
  visible: boolean;
}

function parseCoreGraphicsObservation(value: unknown): CoreGraphicsWindowObservation | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (
    !Number.isSafeInteger(record.windowId) ||
    !Number.isSafeInteger(record.processId) ||
    typeof record.applicationName !== 'string' ||
    typeof record.visible !== 'boolean'
  )
    return null;
  return {
    windowId: record.windowId as number,
    processId: record.processId as number,
    applicationName: record.applicationName,
    visible: record.visible
  };
}

function runCoreGraphicsObservation(): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      '/usr/bin/osascript',
      ['-l', 'JavaScript', '-e', observationScript],
      { timeout: 5_000, maxBuffer: 1_048_576 },
      (error, stdout) => {
        if (error) reject(new Error('MACOS_WINDOW_METADATA_FAILED', { cause: error }));
        else resolve(stdout);
      }
    );
  });
}

interface MacOSWindowObservation {
  processId: number;
  processName: 'chrome';
  applicationName: string;
  windowTitle: string;
  visible: boolean;
}

export type MacOSWindowObservationRunner = () => Promise<string>;

function runMacOSObservation(): Promise<string> {
  return Promise.all([
    runCoreGraphicsObservation(),
    desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: { width: 0, height: 0 },
      fetchWindowIcons: false
    })
  ])
    .then(([metadataRaw, sources]) => {
      const decoded: unknown = JSON.parse(metadataRaw);
      const metadata = (Array.isArray(decoded) ? decoded : [decoded])
        .map(parseCoreGraphicsObservation)
        .filter((value): value is CoreGraphicsWindowObservation => value !== null);
      const browserWindows = metadata.filter((window) =>
        supportedApplications.has(window.applicationName)
      );
      const titles = new Map<number, string>();
      for (const source of sources) {
        const match = /^window:(\d+):/u.exec(source.id);
        if (match?.[1]) titles.set(Number(match[1]), source.name);
      }
      return JSON.stringify({
        browserWindowCount: browserWindows.length,
        observations: browserWindows.flatMap((window) => {
          const windowTitle = titles.get(window.windowId)?.trim() ?? '';
          if (!windowTitle) return [];
          return [{ ...window, processName: 'chrome', windowTitle }];
        })
      });
    })
    .catch((error: unknown) => {
      throw new Error('MACOS_WINDOW_OBSERVATION_FAILED', { cause: error });
    });
}

function parseObservation(value: unknown): MacOSWindowObservation | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (
    !Number.isSafeInteger(record.processId) ||
    record.processName !== 'chrome' ||
    typeof record.applicationName !== 'string' ||
    !supportedApplications.has(record.applicationName) ||
    typeof record.windowTitle !== 'string' ||
    typeof record.visible !== 'boolean'
  )
    return null;
  const windowTitle = record.windowTitle.trim().slice(0, 240);
  if (!windowTitle) return null;
  return {
    processId: record.processId as number,
    processName: 'chrome',
    applicationName: record.applicationName,
    windowTitle,
    visible: record.visible
  };
}

interface ParsedMacOSObservation {
  browserWindowCount: number;
  observations: MacOSWindowObservation[];
}

function parseObservations(raw: string): ParsedMacOSObservation {
  if (!raw.trim()) return { browserWindowCount: 0, observations: [] };
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    throw new Error('MACOS_WINDOW_OBSERVATION_INVALID_RESPONSE');
  }
  const legacyObservations = Array.isArray(decoded) ? decoded : null;
  const record =
    !legacyObservations && decoded && typeof decoded === 'object'
      ? (decoded as Record<string, unknown>)
      : null;
  const rawObservations = legacyObservations ??
    (Array.isArray(record?.observations) ? record.observations : []);
  const observations = rawObservations
    .map(parseObservation)
    .filter((value): value is MacOSWindowObservation => value !== null);
  const declaredBrowserWindowCount = record?.browserWindowCount;
  const browserWindowCount = Number.isSafeInteger(declaredBrowserWindowCount)
    ? Math.max(Number(declaredBrowserWindowCount), observations.length)
    : observations.length;
  return { browserWindowCount, observations };
}

function observationId(observation: MacOSWindowObservation): string {
  return createHash('sha256')
    .update(
      `${observation.processId}\0${observation.applicationName}\0${observation.windowTitle}`
    )
    .digest('hex')
    .slice(0, 24);
}

/**
 * Joins window titles supplied by Electron with owner/PID metadata from CoreGraphics.
 * It requests no thumbnails and never reads URLs, DOM, screen pixels, camera, or audio.
 */
export class MacOSMeetingObservationProvider implements MeetingObservationProvider {
  public constructor(
    private readonly options: {
      platform?: NodeJS.Platform;
      runner?: MacOSWindowObservationRunner;
      screenPermissionGranted?: () => boolean;
      now?: () => Date;
      detector?: MeetingDetector;
    } = {}
  ) {}

  public supported(): boolean {
    return (this.options.platform ?? process.platform) === 'darwin';
  }

  private permissionGranted(): boolean {
    return (this.options.screenPermissionGranted ?? (() => false))();
  }

  private async readObservation(): Promise<ParsedMacOSObservation> {
    return parseObservations(await (this.options.runner ?? runMacOSObservation)());
  }

  private assertMetadataAvailable(observation: ParsedMacOSObservation): void {
    if (observation.browserWindowCount > 0 && observation.observations.length === 0)
      throw new Error('MACOS_WINDOW_METADATA_UNAVAILABLE');
  }

  /**
   * Called only after an explicit user action. Running the capture API allows macOS to display
   * its own TCC prompt; the status is checked afterwards and is never promoted artificially.
   */
  public async requestPermissionAndVerify(): Promise<void> {
    if (!this.supported()) return;
    let observation: ParsedMacOSObservation;
    try {
      observation = await this.readObservation();
    } catch (error) {
      if (!this.permissionGranted()) throw new Error('MACOS_SCREEN_PERMISSION_REQUIRED');
      throw error;
    }
    if (!this.permissionGranted()) throw new Error('MACOS_SCREEN_PERMISSION_REQUIRED');
    this.assertMetadataAvailable(observation);
  }

  public async observe(): Promise<MeetingCandidateDto[]> {
    if (!this.supported()) return [];
    if (!this.permissionGranted()) throw new Error('MACOS_SCREEN_PERMISSION_REQUIRED');
    const observedAt = (this.options.now ?? (() => new Date()))();
    const observed = await this.readObservation();
    this.assertMetadataAvailable(observed);
    const detector = this.options.detector ?? new MeetingDetector();
    return observed.observations.flatMap((observation) => {
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
          applicationName: observation.applicationName,
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
