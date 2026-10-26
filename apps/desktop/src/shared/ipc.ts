import type {
  AudioBinaryDto,
  CallReportDto,
  CallTranscriptDto,
  ContactDetailDto,
  ContactSummaryDto,
  ConversationContextDto,
  ConversationMessagesDto,
  ConversationSummaryDto,
  CursorPageDto,
  DealDetailDto,
  DealSummaryDto,
  DevLiveCallScenarioRequest,
  InterventionCardDto,
  InterventionFeedbackInput,
  LiveCallDetailDto,
  LiveCallHeartbeatRequest,
  LiveCallSessionDto,
  LiveCallTurnResultDto,
  LiveTranscriptionCapabilityDto,
  LiveTranscriptionStatusDto,
  LiveTranscriptTurnDto,
  LiveTranscriptTurnRequest,
  CreateLiveCallRequest,
  StartLiveCallRequest,
  OrganizationChoiceDto,
  RealtimeEventEnvelope,
  SessionDto
} from '@morubi/contracts';
import type { SignInInput } from '@morubi/validation';

export const ipcChannels = {
  systemGetVersion: 'system:getVersion',
  systemGetPlatform: 'system:getPlatform',
  systemGetOSVersion: 'system:getOSVersion',
  authSignIn: 'auth:signIn',
  authGetSession: 'auth:getSession',
  authSignOut: 'auth:signOut',
  authListOrganizations: 'auth:listOrganizations',
  authSetOrganization: 'auth:setOrganization',
  commercialListContacts: 'commercial:listContacts',
  commercialGetContact: 'commercial:getContact',
  commercialListDeals: 'commercial:listDeals',
  commercialGetDeal: 'commercial:getDeal',
  commercialListConversations: 'commercial:listConversations',
  commercialListMessages: 'commercial:listMessages',
  commercialMarkConversationRead: 'commercial:markConversationRead',
  commercialGetConversationContext: 'commercial:getConversationContext',
  commercialGetMessageAudio: 'commercial:getMessageAudio',
  interventionViewed: 'intervention:viewed',
  interventionDismiss: 'intervention:dismiss',
  interventionApplied: 'intervention:applied',
  interventionFeedback: 'intervention:feedback',
  realtimeStart: 'realtime:start',
  realtimeStop: 'realtime:stop',
  realtimeEvent: 'realtime:event',
  notificationsShow: 'notifications:show',
  liveCallsGetCurrent: 'liveCalls:getCurrent',
  liveCallsCreate: 'liveCalls:create',
  liveCallsGet: 'liveCalls:get',
  liveCallsStart: 'liveCalls:start',
  liveCallsHeartbeat: 'liveCalls:heartbeat',
  liveCallsSendTurn: 'liveCalls:sendTurn',
  liveCallsEnd: 'liveCalls:end',
  liveCallsGetReport: 'liveCalls:getReport',
  liveCallsRetryReport: 'liveCalls:retryReport',
  liveCallsGetTranscript: 'liveCalls:getTranscript',
  liveCallsSimulate: 'liveCalls:simulate',
  liveCallsGetRuntimeCapabilities: 'liveCalls:getRuntimeCapabilities',
  liveCallsRequestMeetingObservationPermission: 'liveCalls:requestMeetingObservationPermission',
  liveCallsObserveMeetings: 'liveCalls:observeMeetings',
  liveCallsListSystemAudioSources: 'liveCalls:listSystemAudioSources',
  liveCallsAuthorizeMicrophone: 'liveCalls:authorizeMicrophone',
  liveCallsAuthorizeAudioDiagnostic: 'liveCalls:authorizeAudioDiagnostic',
  liveCallsAuthorizeSystemAudioDiagnostic: 'liveCalls:authorizeSystemAudioDiagnostic',
  liveCallsAuthorizeMacOSSystemAudio: 'liveCalls:authorizeMacOSSystemAudio',
  liveCallsAuthorizeSystemAudio: 'liveCalls:authorizeSystemAudio',
  liveCallsStartNativeSystemAudio: 'liveCalls:startNativeSystemAudio',
  liveCallsStopNativeSystemAudio: 'liveCalls:stopNativeSystemAudio',
  liveCallsNativeSystemAudioChunk: 'liveCalls:nativeSystemAudioChunk',
  liveCallsNativeSystemAudioFailure: 'liveCalls:nativeSystemAudioFailure',
  liveCallsCaptureStopRequested: 'liveCalls:captureStopRequested',
  liveCallsSetBackgroundObservation: 'liveCalls:setBackgroundObservation',
  liveCallsSetCompactMode: 'liveCalls:setCompactMode',
  liveCallsGetTranscriptionCapability: 'liveCalls:getTranscriptionCapability',
  liveCallsStartTranscription: 'liveCalls:startTranscription',
  liveCallsSendAudioChunk: 'liveCalls:sendAudioChunk',
  liveCallsStopTranscription: 'liveCalls:stopTranscription',
  liveCallsTranscriptTurn: 'liveCalls:transcriptTurn',
  liveCallsTranscriptionStatus: 'liveCalls:transcriptionStatus'
} as const;

export type Platform = 'win32' | 'darwin' | 'linux';
export const macOSBlackHoleSourceId = 'macos:blackhole-2ch';
export const macOSNativeSystemAudioSourceId = 'macos:native-system-audio';

export interface OSRuntimeInfo {
  version: string;
  architecture: string;
}

export interface LiveCallRuntimeCapabilities {
  simulatorEnabled: boolean;
  meetingDetection: {
    enabled: boolean;
    supported: boolean;
    available: boolean;
    method: 'WINDOW_TITLE' | 'LEGACY_SCREEN_METADATA' | 'NONE';
    permission: 'GRANTED' | 'OPTIONAL_PERMISSION_REQUIRED' | 'NOT_APPLICABLE';
  };
  audioCapture: {
    enabled: boolean;
    microphoneSupported: boolean;
    systemAudioSupported: boolean;
    systemAudioMethod:
      | 'WINDOWS_LOOPBACK'
      | 'MACOS_SCREEN_CAPTURE_KIT'
      | 'MACOS_BLACKHOLE_2CH'
      | 'MACOS_VIRTUAL_DEVICE_REQUIRED'
      | 'UNSUPPORTED';
    nativeSystemAudioSupported: boolean;
    microphonePermission:
      'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown' | 'not-applicable';
  };
  liveCallSession: {
    enabled: boolean;
    manualStartSupported: boolean;
  };
  platform: Platform;
  maxBufferBytes: number;
  observationIntervalMs: number;
}

export interface MeetingCandidateDto {
  id: string;
  provider: 'MEET';
  processId: number;
  processName: string;
  applicationName: string;
  windowTitle: string;
  visible: boolean;
  confidence: number;
  evidence: 'WINDOW_TITLE';
  confirmationRequired: true;
  observedAt: string;
}

export interface SystemAudioSourceDto {
  id: string;
  name: string;
  kind: 'SCREEN' | 'WINDOW' | 'NATIVE' | 'VIRTUAL_DEVICE';
}

export interface NativeSystemAudioChunkDto {
  sessionId: string;
  sequence: number;
  capturedAt: string;
  durationMs: number;
  mimeType: string;
  signalLevel: number;
  data: Uint8Array;
}

export interface LiveAudioTransportChunkDto {
  sequence: number;
  capturedAt: string;
  durationMs: number;
  mimeType: 'audio/pcm;rate=16000';
  source: 'LOCAL_MIC' | 'SYSTEM_AUDIO';
  data: Uint8Array;
}

export interface MorubiBridge {
  system: {
    getVersion(): Promise<string>;
    getPlatform(): Promise<Platform>;
    getOSVersion(): Promise<OSRuntimeInfo>;
  };
  auth: {
    signIn(input: SignInInput): Promise<SessionDto>;
    getSession(): Promise<SessionDto | null>;
    signOut(): Promise<void>;
    listOrganizations(): Promise<OrganizationChoiceDto[]>;
    setOrganization(organizationId: string): Promise<SessionDto>;
  };
  commercial: {
    listContacts(search?: string): Promise<CursorPageDto<ContactSummaryDto>>;
    getContact(contactId: string): Promise<ContactDetailDto>;
    listDeals(search?: string): Promise<CursorPageDto<DealSummaryDto>>;
    getDeal(dealId: string): Promise<DealDetailDto>;
    listConversations(search?: string): Promise<CursorPageDto<ConversationSummaryDto>>;
    listMessages(conversationId: string, cursor?: string): Promise<ConversationMessagesDto>;
    markConversationRead(conversationId: string): Promise<void>;
    getConversationContext(conversationId: string): Promise<ConversationContextDto>;
    getMessageAudio(messageId: string): Promise<AudioBinaryDto>;
  };
  interventions: {
    viewed(deliveryId: string): Promise<InterventionCardDto>;
    dismiss(deliveryId: string): Promise<InterventionCardDto>;
    applied(deliveryId: string): Promise<InterventionCardDto>;
    feedback(deliveryId: string, input: InterventionFeedbackInput): Promise<void>;
  };
  realtime: {
    subscribe(listener: (event: RealtimeEventEnvelope) => void): () => void;
  };
  liveCalls: {
    getCurrent(): Promise<{ session: LiveCallDetailDto | null }>;
    create(input: CreateLiveCallRequest): Promise<LiveCallSessionDto>;
    get(sessionId: string): Promise<LiveCallDetailDto>;
    start(sessionId: string, input: StartLiveCallRequest): Promise<LiveCallSessionDto>;
    heartbeat(
      sessionId: string,
      input: LiveCallHeartbeatRequest
    ): Promise<{ receivedAt: string; bufferAccepted: boolean }>;
    sendTurn(sessionId: string, input: LiveTranscriptTurnRequest): Promise<LiveCallTurnResultDto>;
    end(sessionId: string): Promise<LiveCallSessionDto>;
    getReport(sessionId: string): Promise<CallReportDto>;
    retryReport(sessionId: string): Promise<CallReportDto>;
    getTranscript(sessionId: string): Promise<CallTranscriptDto>;
    simulate(input: DevLiveCallScenarioRequest): Promise<void>;
    getRuntimeCapabilities(): Promise<LiveCallRuntimeCapabilities>;
    requestMeetingObservationPermission(): Promise<LiveCallRuntimeCapabilities>;
    observeMeetings(): Promise<MeetingCandidateDto[]>;
    listSystemAudioSources(): Promise<SystemAudioSourceDto[]>;
    authorizeMicrophone(sessionId: string): Promise<{ authorizedUntil: string }>;
    authorizeAudioDiagnostic(): Promise<{ authorizedUntil: string }>;
    authorizeSystemAudioDiagnostic(sourceId: string): Promise<{ authorizedUntil: string }>;
    authorizeMacOSSystemAudio(sessionId: string): Promise<{ authorizedUntil: string }>;
    authorizeSystemAudio(input: {
      sessionId: string;
      sourceId: string;
    }): Promise<{ authorizedUntil: string }>;
    startNativeSystemAudio(sessionId: string): Promise<{
      method: 'MACOS_SCREEN_CAPTURE_KIT';
      deviceLabel: string;
    }>;
    stopNativeSystemAudio(sessionId: string): Promise<void>;
    onNativeSystemAudioChunk(listener: (chunk: NativeSystemAudioChunkDto) => void): () => void;
    onNativeSystemAudioFailure(
      listener: (failure: { sessionId: string; code: string }) => void
    ): () => void;
    onCaptureStopRequested(listener: () => void): () => void;
    setBackgroundObservation(enabled: boolean): Promise<void>;
    setCompactMode(input: { compact: boolean; alwaysOnTop: boolean }): Promise<void>;
    getTranscriptionCapability(): Promise<LiveTranscriptionCapabilityDto>;
    startTranscription(sessionId: string): Promise<void>;
    sendAudioChunk(chunk: LiveAudioTransportChunkDto): Promise<void>;
    stopTranscription(): Promise<void>;
    onTranscriptTurn(listener: (turn: LiveTranscriptTurnDto) => void): () => void;
    onTranscriptionStatus(listener: (status: LiveTranscriptionStatusDto) => void): () => void;
  };
  notifications: {
    show(input: { title: string; body: string }): Promise<void>;
  };
}
