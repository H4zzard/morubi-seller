import type {
  AudioBinaryDto,
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
  liveCallsSimulate: 'liveCalls:simulate',
  liveCallsAuthorizeMicrophone: 'liveCalls:authorizeMicrophone',
  liveCallsSetCompactMode: 'liveCalls:setCompactMode'
} as const;

export type Platform = 'win32' | 'darwin' | 'linux';

export interface MorubiBridge {
  system: {
    getVersion(): Promise<string>;
    getPlatform(): Promise<Platform>;
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
    simulate(input: DevLiveCallScenarioRequest): Promise<void>;
    authorizeMicrophone(): Promise<{ authorizedUntil: string }>;
    setCompactMode(input: { compact: boolean; alwaysOnTop: boolean }): Promise<void>;
  };
  notifications: {
    show(input: { title: string; body: string }): Promise<void>;
  };
}
