import type { PostCallProposal, PostCallReportContent } from '@morubi/post-call';

export type PostCallJobStatus =
  'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'RETRY' | 'CANCELLED';
export type CallReportStatus = 'PROCESSING' | 'READY' | 'FAILED';

export interface CallReportRevisionDto {
  id: string;
  version: number;
  status: 'CURRENT' | 'SUPERSEDED' | 'REJECTED';
  processingVersion: string;
  provider: string;
  model: string;
  content: PostCallReportContent;
  proposals: PostCallProposal[];
  inputTokens: number;
  outputTokens: number;
  estimatedCostMicros: string;
  generatedAt: string;
}

export interface CallReportDto {
  id: string;
  liveCallSessionId: string;
  status: CallReportStatus;
  processingVersion: string;
  failureCode: string | null;
  currentRevision: CallReportRevisionDto | null;
  createdAt: string;
  updatedAt: string;
}

export interface CallTranscriptDto {
  liveCallSessionId: string;
  turns: Array<{
    id: string;
    sequence: number;
    speakerRole: 'SELLER' | 'LEAD' | 'UNKNOWN';
    text: string;
    startedAt: string;
    endedAt: string | null;
  }>;
}
