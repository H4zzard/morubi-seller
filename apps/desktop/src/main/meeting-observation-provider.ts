import type { MeetingCandidateDto } from '../shared/ipc.js';

export interface MeetingObservationProvider {
  supported(): boolean;
  observe(): Promise<MeetingCandidateDto[]>;
}
