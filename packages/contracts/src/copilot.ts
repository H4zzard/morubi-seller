export const interventionCategories = [
  'OBJECTION',
  'BUYING_SIGNAL',
  'RISK',
  'DISCOVERY_GAP',
  'NEXT_STEP',
  'INFORMATION'
] as const;

export type InterventionCategory = (typeof interventionCategories)[number];

export const interventionDeliveryStatuses = [
  'CREATED',
  'DELIVERED',
  'VIEWED',
  'DISMISSED',
  'APPLIED',
  'EXPIRED'
] as const;

export type InterventionDeliveryStatus = (typeof interventionDeliveryStatuses)[number];
export type InterventionFeedbackRating = 'HELPFUL' | 'NOT_HELPFUL';
export type CopilotPanelState =
  'IDLE' | 'ANALYZING' | 'INSIGHT_READY' | 'INTERVENTION_READY' | 'SUPPRESSED' | 'ERROR';

export interface InterventionCardDto {
  deliveryId: string;
  conversationId: string;
  dealId: string;
  liveCallSessionId: string | null;
  liveTranscriptTurnId: string | null;
  category: InterventionCategory;
  priority: number;
  title: string;
  guidance: string;
  suggestedQuestion: string | null;
  status: InterventionDeliveryStatus;
  createdAt: string;
  expiresAt: string;
}

export interface RealtimeEventEnvelope {
  id: string;
  version: 1;
  type: 'intervention.created' | 'intervention.updated' | 'deal_state.updated';
  occurredAt: string;
  correlationId: string;
  conversationId: string | null;
  dealId: string | null;
  liveCallSessionId: string | null;
  payload: Record<string, unknown>;
}

export interface ConversationContextDto {
  conversation: {
    id: string;
    subject: string | null;
    contactName: string | null;
    companyName: string | null;
    dealId: string;
    dealTitle: string;
    dealStatus: 'OPEN' | 'WON' | 'LOST';
    providerStageLabel: string | null;
    ownerName: string | null;
  };
  summary: string;
  currentState: Record<string, unknown>;
  pains: string[];
  objections: string[];
  decisionMakers: string[];
  nextStep: string | null;
  memory: Array<{ id: string; factType: string; value: string; updatedAt: string }>;
  copilot: {
    state: CopilotPanelState;
    feedbackEnabled: boolean;
    current: InterventionCardDto | null;
    history: InterventionCardDto[];
  };
}

export interface InterventionFeedbackInput {
  rating: InterventionFeedbackRating;
  actionTaken?: string | undefined;
}

export interface CopilotAnalyticsDto {
  created: number;
  delivered: number;
  viewed: number;
  dismissed: number;
  applied: number;
  expired: number;
  helpful: number;
  notHelpful: number;
  falseCardRate: number;
  endToEndLatencyMsP50: number | null;
  endToEndLatencyMsP95: number | null;
}
