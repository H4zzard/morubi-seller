export const meetingProviders = ['MEET', 'ZOOM', 'TEAMS', 'UNKNOWN'] as const;
export type MeetingProvider = (typeof meetingProviders)[number];

export const liveCallStatuses = [
  'DETECTED',
  'READY',
  'STARTING',
  'ACTIVE',
  'ENDING',
  'ENDED',
  'FAILED',
  'CANCELLED'
] as const;
export type LiveCallStatus = (typeof liveCallStatuses)[number];

export const liveSpeakerRoles = ['SELLER', 'LEAD', 'UNKNOWN'] as const;
export type LiveSpeakerRole = (typeof liveSpeakerRoles)[number];

export const callPhases = [
  'INTRODUCTION',
  'DISCOVERY',
  'PRESENTATION',
  'VALUE',
  'DECISION',
  'UNKNOWN'
] as const;
export type CallPhase = (typeof callPhases)[number];

export type LiveCaptureMode = 'MICROPHONE' | 'SYSTEM_AUDIO' | 'MIXED' | 'FIXTURE' | 'UNKNOWN';
export type LiveTranscriptionMode = 'REALTIME' | 'FIXTURE';

export interface LiveTranscriptTurnDto {
  id: string;
  sessionId: string;
  clientTurnId: string;
  speakerRole: LiveSpeakerRole;
  speakerOrigin: string;
  speakerConfidence: number;
  text: string;
  isPartial: boolean;
  isFinal: boolean;
  startedAt: string;
  endedAt: string | null;
  confidence: number | null;
  provider: string;
  model: string;
  sequence: number;
  commercialEventId: string | null;
  transcriptFinalAt: string | null;
}

export interface CallConsentDto {
  mode: 'MANUAL_CONFIRMATION' | 'ORGANIZATION_POLICY';
  confirmedAt: string;
  policyVersion: string;
  captureSources: string[];
}

export interface LiveCallMemoryDto {
  phase: CallPhase;
  phaseConfidence: number;
  pains: string[];
  objections: string[];
  openQuestions: string[];
  buyingSignals: string[];
  sellerActions: string[];
  lastInterventionId: string | null;
  lastSequence: number;
}

export interface LiveCallSessionDto {
  id: string;
  sellerMembershipId: string;
  dealId: string | null;
  contactId: string | null;
  conversationId: string | null;
  calendarEventId: string | null;
  meetingProvider: MeetingProvider;
  meetingExternalId: string | null;
  meetingTitle: string | null;
  status: LiveCallStatus;
  captureMode: LiveCaptureMode;
  transcriptionMode: LiveTranscriptionMode;
  currentPhase: CallPhase;
  phaseConfidence: number;
  phaseOrigin: string;
  memory: LiveCallMemoryDto;
  startedAt: string | null;
  endedAt: string | null;
  lastHeartbeatAt: string | null;
  failureCode: string | null;
  detectionConfidence: number;
  detectionEvidence: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LiveCallDetailDto extends LiveCallSessionDto {
  context: {
    contactName: string | null;
    companyName: string | null;
    dealTitle: string | null;
  };
  consent: CallConsentDto | null;
  turns: LiveTranscriptTurnDto[];
  metrics: {
    callDurationSeconds: number;
    audioProcessedSeconds: number;
    decisionCount: number;
    generationCount: number;
    cardsDelivered: number;
    droppedChunks: number;
    costTotalMicros: string;
    speechToCardMs: number | null;
  };
}

export interface LiveCallSettingsDto {
  callCaptureEnabled: boolean;
  meetDetectionEnabled: boolean;
  zoomDetectionEnabled: boolean;
  liveTranscriptionEnabled: boolean;
  liveCopilotEnabled: boolean;
  liveGenerationEnabled: boolean;
  autoStartEnabled: boolean;
  rawAudioRetentionDays: number;
  transcriptRetentionDays: number;
  maxBufferBytes: number;
  turnAggregationGapMs: number;
  liveCardTtlSeconds: number;
}

export interface LiveCallTurnResultDto {
  turn: LiveTranscriptTurnDto;
  commercialEventId: string | null;
  intelligenceJobId: string | null;
  deduplicated: boolean;
}

export interface CreateLiveCallRequest {
  meetingProvider: MeetingProvider;
  meetingExternalId?: string | undefined;
  meetingTitle?: string | undefined;
  dealId?: string | undefined;
  contactId?: string | undefined;
  conversationId?: string | undefined;
  calendarEventId?: string | undefined;
  detectionConfidence?: number | undefined;
  detectionEvidence?:
    'URL_HOST' | 'PROCESS_NAME' | 'WINDOW_TITLE' | 'CALENDAR' | 'MANUAL' | 'FIXTURE' | undefined;
}

export interface LinkLiveCallContextRequest {
  dealId?: string | undefined;
  contactId?: string | undefined;
  conversationId?: string | undefined;
  calendarEventId?: string | undefined;
}

export interface StartLiveCallRequest {
  consentConfirmed: true;
  consentMode?: 'MANUAL_CONFIRMATION' | 'ORGANIZATION_POLICY' | undefined;
  policyVersion?: string | undefined;
  captureMode: Exclude<LiveCaptureMode, 'UNKNOWN'>;
  transcriptionMode: LiveTranscriptionMode;
  captureSources: Array<'LOCAL_SPEAKER' | 'REMOTE_AUDIO' | 'MIXED' | 'UNKNOWN'>;
}

export interface LiveTranscriptTurnRequest {
  clientTurnId: string;
  speakerRole: LiveSpeakerRole;
  speakerOrigin: 'LOCAL_SPEAKER' | 'REMOTE_AUDIO' | 'MIXED' | 'UNKNOWN' | 'FIXTURE';
  speakerConfidence: number;
  text: string;
  isPartial: boolean;
  isFinal: boolean;
  startedAt: string;
  endedAt: string | null;
  confidence: number | null;
  provider: string;
  model: string;
  sequence: number;
  audioProcessedMs?: number | undefined;
  estimatedCostMicros?: number | undefined;
}

export interface LiveCallHeartbeatRequest {
  bufferedBytes?: number | undefined;
  droppedChunks?: number | undefined;
}

export interface DevLiveCallScenarioRequest {
  meetingProvider: 'MEET' | 'ZOOM';
  conversationId: string;
  action: 'DETECT' | 'START' | 'EMIT_SCRIPT' | 'END';
  sessionId?: string | undefined;
}
