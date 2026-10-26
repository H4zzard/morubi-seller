import type { CreateLiveCallRequest, MeetingProvider } from '@morubi/contracts';
import type { LiveCallRuntimeCapabilities, MeetingCandidateDto } from '../../shared/ipc';

export const manualMeetingProviders = [
  'MEET',
  'ZOOM',
  'TEAMS',
  'UNKNOWN'
] as const satisfies readonly MeetingProvider[];

export type ManualMeetingProvider = (typeof manualMeetingProviders)[number];

export type LiveCallIntent =
  | { kind: 'DETECTED'; candidate: MeetingCandidateDto }
  | { kind: 'MANUAL'; provider: ManualMeetingProvider };

export function meetingProviderLabel(provider: MeetingProvider): string {
  if (provider === 'MEET') return 'Google Meet';
  if (provider === 'ZOOM') return 'Zoom';
  if (provider === 'TEAMS') return 'Microsoft Teams';
  return 'Outra reunião';
}

export function createLiveCallRequest(
  intent: LiveCallIntent,
  conversationId: string
): CreateLiveCallRequest {
  if (intent.kind === 'DETECTED') {
    return {
      meetingProvider: intent.candidate.provider,
      meetingTitle: intent.candidate.windowTitle,
      ...(conversationId ? { conversationId } : {}),
      detectionConfidence: intent.candidate.confidence,
      detectionEvidence: intent.candidate.evidence
    };
  }
  return {
    meetingProvider: intent.provider,
    meetingTitle: meetingProviderLabel(intent.provider),
    ...(conversationId ? { conversationId } : {}),
    detectionConfidence: 1,
    detectionEvidence: 'MANUAL'
  };
}

export function shouldPollMeetingDetection(
  capabilities: LiveCallRuntimeCapabilities | null,
  liveSessionActive: boolean
): boolean {
  return Boolean(capabilities?.meetingDetection.available && !liveSessionActive);
}
