import { z } from 'zod';

export const POST_CALL_PROCESSING_VERSION = 'post-call-v2';
export const POST_CALL_PROMPT_VERSION = 'post-call-prompt-v2';

export const speakerRoleSchema = z.enum(['SELLER', 'LEAD', 'UNKNOWN']);
export const evidenceReferenceSchema = z.object({
  transcriptTurnId: z.string().uuid(),
  timestamp: z.iso.datetime(),
  speakerRole: speakerRoleSchema,
  participantRole: z.enum(['HOST', 'GUEST', 'UNKNOWN']),
  excerpt: z.string().trim().min(1).max(280)
}).strict();
export type EvidenceReference = z.infer<typeof evidenceReferenceSchema>;

export const evidenceValueSchema = z.object({
  value: z.string().trim().min(1).max(2_000),
  confidence: z.number().min(0).max(1),
  evidenceTurnIds: z.array(z.string().uuid()).min(1).max(50)
}).strict();
export type EvidenceValue = z.infer<typeof evidenceValueSchema>;

const commitmentSchema = z.object({ actor: speakerRoleSchema, commitment: evidenceValueSchema }).strict();
export const actionItemSchema = z.object({
  description: z.string().trim().min(1).max(1_000),
  ownerRole: speakerRoleSchema.nullable(),
  ownerName: z.string().trim().min(1).max(200).nullable(),
  dueAt: z.iso.datetime().nullable(),
  source: z.enum(['EXPLICIT', 'IMPLICIT']),
  confidence: z.number().min(0).max(1),
  status: z.literal('OPEN'),
  evidenceTurnIds: z.array(z.string().uuid()).min(1).max(20)
}).strict();
export const sellerPerformanceDimensionSchema = z.object({
  dimension: z.enum([
    'DISCOVERY', 'QUALIFICATION', 'ACTIVE_LISTENING', 'OBJECTION_HANDLING', 'CLARITY',
    'VALUE_ARTICULATION', 'NEXT_STEP_CONTROL', 'CLOSING_BEHAVIOR', 'TALK_LISTEN_BALANCE',
    'QUESTION_QUALITY', 'PLAYBOOK_ADHERENCE'
  ]),
  rating: z.enum(['STRONG', 'ADEQUATE', 'NEEDS_IMPROVEMENT', 'NOT_OBSERVED']),
  score: z.number().min(0).max(100).nullable(),
  confidence: z.number().min(0).max(1),
  rationale: z.string().trim().min(1).max(1_000),
  evidenceTurnIds: z.array(z.string().uuid()).min(1).max(30)
}).strict();
const dealAssessmentSchema = z.object({
  currentStage: z.string().trim().min(1).max(120).nullable(),
  stageConfidence: z.number().min(0).max(1),
  purchaseIntent: z.enum(['HIGH', 'MEDIUM', 'LOW', 'UNKNOWN']),
  closeProbabilityBucket: z.enum(['VERY_HIGH', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN']),
  blockers: z.array(evidenceValueSchema).max(30),
  positiveSignals: z.array(evidenceValueSchema).max(30),
  recommendedNextAction: evidenceValueSchema.nullable(),
  evidenceTurnIds: z.array(z.string().uuid()).min(1).max(50)
}).strict();
const assessmentSchema = z.object({
  outcome: z.enum(['POSITIVE', 'NEUTRAL', 'NEGATIVE', 'INCONCLUSIVE']),
  confidence: z.number().min(0).max(1),
  rationale: z.string().trim().min(1).max(2_000),
  evidenceTurnIds: z.array(z.string().uuid()).min(1).max(50),
  experimentalScore: z.number().min(0).max(100).nullable().default(null)
}).strict();
const participantSchema = z.object({
  participantRole: z.enum(['HOST', 'GUEST', 'UNKNOWN']),
  commercialRole: speakerRoleSchema,
  displayName: z.string().trim().min(1).max(200).nullable(),
  identityConfirmed: z.boolean(),
  evidenceTurnIds: z.array(z.string().uuid()).min(1).max(50)
}).strict();
const reportMetadataSchema = z.object({
  transcriptVersion: z.string().min(1).max(160),
  generationVersion: z.string().min(1).max(160),
  source: z.literal('FINAL_TRANSCRIPT'),
  transcriptTurnCount: z.number().int().nonnegative()
}).strict();

export const postCallReportContentSchema = z.object({
  executiveSummary: evidenceValueSchema,
  context: z.array(evidenceValueSchema).max(30),
  participants: z.array(participantSchema).max(30).default([]),
  durationSeconds: z.number().int().nonnegative().default(0),
  topics: z.array(evidenceValueSchema).max(30).default([]),
  pains: z.array(evidenceValueSchema).max(30),
  needs: z.array(evidenceValueSchema).max(30),
  objections: z.array(evidenceValueSchema).max(30),
  sellerResponses: z.array(evidenceValueSchema).max(30).default([]),
  buyingSignals: z.array(evidenceValueSchema).max(30),
  decisionMakers: z.array(evidenceValueSchema).max(20),
  competitors: z.array(evidenceValueSchema).max(20),
  budget: z.array(evidenceValueSchema).max(10),
  timeline: z.array(evidenceValueSchema).max(20),
  commitments: z.array(commitmentSchema).max(30),
  explicitNextSteps: z.array(evidenceValueSchema).max(20),
  suggestedNextSteps: z.array(evidenceValueSchema).max(20),
  followUps: z.array(evidenceValueSchema).max(20).default([]),
  actionItems: z.array(actionItemSchema).max(30).default([]),
  unansweredQuestions: z.array(evidenceValueSchema).max(30),
  risks: z.array(evidenceValueSchema).max(30),
  gaps: z.array(evidenceValueSchema).max(30),
  playbookObservations: z.array(evidenceValueSchema).max(30),
  sellerPerformance: z.array(sellerPerformanceDimensionSchema).max(11).default([]),
  dealAssessment: dealAssessmentSchema,
  assessment: assessmentSchema,
  evidence: z.array(evidenceReferenceSchema).max(500).default([]),
  metadata: reportMetadataSchema.optional()
}).strict();
export type PostCallReportContent = z.infer<typeof postCallReportContentSchema>;

export interface PostCallTurn {
  id: string;
  sequence: number;
  speakerRole: 'SELLER' | 'LEAD' | 'UNKNOWN';
  text: string;
  startedAt: string;
}
export interface PostCallAnalysisInput {
  profile: 'POST_CALL_ANALYSIS';
  phase: 'EXTRACT' | 'MERGE';
  processingVersion: string;
  transcriptVersion: string;
  sessionId: string;
  segmentIndex: number;
  segmentCount: number;
  turns: PostCallTurn[];
  partialReports: PostCallReportContent[];
  callMetadata: Record<string, unknown>;
  companyContext: Record<string, unknown>;
  playbookContext: string[];
  dealState: Record<string, unknown>;
  liveMemory: Record<string, unknown>;
  constraints: { maxInputCharacters: number; maxOutputCharacters: number };
  correction?: string[];
}
export interface PostCallAnalysisResult { output: unknown; model: string; inputTokens: number; outputTokens: number }
export interface PostCallAnalysisProvider {
  readonly metadata: { provider: string; configVersion: string };
  analyzePostCall(input: PostCallAnalysisInput, signal?: AbortSignal): Promise<PostCallAnalysisResult>;
}
export interface TranscriptSegment { index: number; turns: PostCallTurn[]; characters: number }

export function segmentTranscript(turns: readonly PostCallTurn[], maxCharacters = 12_000): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  let current: PostCallTurn[] = [];
  let characters = 0;
  for (const turn of [...turns].sort((a, b) => a.sequence - b.sequence)) {
    const size = turn.text.length + 80;
    if (current.length && characters + size > maxCharacters) {
      segments.push({ index: segments.length, turns: current, characters });
      current = [];
      characters = 0;
    }
    current.push(turn);
    characters += size;
  }
  if (current.length) segments.push({ index: segments.length, turns: current, characters });
  return segments;
}

export function buildTranscriptVersion(turns: readonly PostCallTurn[]): string {
  let hash = 0x811c9dc5;
  for (const turn of [...turns].sort((a, b) => a.sequence - b.sequence)) {
    const value = `${turn.id}|${turn.sequence}|${turn.speakerRole}|${turn.startedAt}|${turn.text}\n`;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  }
  return `transcript-v1-${hash.toString(16).padStart(8, '0')}-${turns.length}`;
}

function evidenceKey(item: EvidenceValue): string {
  return item.value.trim().toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ');
}
function reconcileList(values: readonly EvidenceValue[], validTurnIds: ReadonlySet<string>): EvidenceValue[] {
  const byValue = new Map<string, EvidenceValue>();
  for (const item of values) {
    const ids = [...new Set(item.evidenceTurnIds.filter((id) => validTurnIds.has(id)))];
    if (!ids.length) continue;
    const key = evidenceKey(item);
    const current = byValue.get(key);
    if (!current || item.confidence > current.confidence) byValue.set(key, { ...item, evidenceTurnIds: ids });
    else current.evidenceTurnIds = [...new Set([...current.evidenceTurnIds, ...ids])];
  }
  return [...byValue.values()];
}
const listFields = [
  'context', 'topics', 'pains', 'needs', 'objections', 'sellerResponses', 'buyingSignals',
  'decisionMakers', 'competitors', 'budget', 'timeline', 'explicitNextSteps',
  'suggestedNextSteps', 'followUps', 'unansweredQuestions', 'risks', 'gaps', 'playbookObservations'
] as const;
function roleToParticipant(role: PostCallTurn['speakerRole']): 'HOST' | 'GUEST' | 'UNKNOWN' {
  return role === 'SELLER' ? 'HOST' : role === 'LEAD' ? 'GUEST' : 'UNKNOWN';
}

export function reconcilePostCallReport(
  candidate: unknown,
  validSource: ReadonlySet<string> | ReadonlyMap<string, PostCallTurn>,
  metadata?: { transcriptVersion: string; generationVersion: string; durationSeconds: number }
): PostCallReportContent {
  const parsed = postCallReportContentSchema.parse(candidate);
  const sourceMap = validSource instanceof Map ? validSource : null;
  const validTurnIds: ReadonlySet<string> =
    validSource instanceof Set ? validSource : new Set(validSource.keys());
  const executiveEvidence = parsed.executiveSummary.evidenceTurnIds.filter((id) => validTurnIds.has(id));
  const assessmentEvidence = parsed.assessment.evidenceTurnIds.filter((id) => validTurnIds.has(id));
  const dealEvidence = parsed.dealAssessment.evidenceTurnIds.filter((id) => validTurnIds.has(id));
  if (!executiveEvidence.length || !assessmentEvidence.length || !dealEvidence.length) throw new Error('POST_CALL_UNSUPPORTED_SUMMARY');
  const result: PostCallReportContent = {
    ...parsed,
    executiveSummary: { ...parsed.executiveSummary, evidenceTurnIds: executiveEvidence },
    assessment: { ...parsed.assessment, evidenceTurnIds: assessmentEvidence },
    dealAssessment: {
      ...parsed.dealAssessment,
      evidenceTurnIds: dealEvidence,
      blockers: reconcileList(parsed.dealAssessment.blockers, validTurnIds),
      positiveSignals: reconcileList(parsed.dealAssessment.positiveSignals, validTurnIds),
      recommendedNextAction: parsed.dealAssessment.recommendedNextAction ? reconcileList([parsed.dealAssessment.recommendedNextAction], validTurnIds)[0] ?? null : null
    },
    commitments: parsed.commitments.flatMap((item) => {
      const commitment = reconcileList([item.commitment], validTurnIds)[0];
      return commitment ? [{ ...item, commitment }] : [];
    }),
    actionItems: parsed.actionItems.flatMap((item) => {
      const evidenceTurnIds = item.evidenceTurnIds.filter((id) => validTurnIds.has(id));
      return evidenceTurnIds.length ? [{ ...item, ownerName: item.ownerRole ? item.ownerName : null, dueAt: item.dueAt ?? null, evidenceTurnIds }] : [];
    }),
    sellerPerformance: parsed.sellerPerformance.flatMap((item) => {
      const evidenceTurnIds = item.evidenceTurnIds.filter((id) => validTurnIds.has(id));
      return evidenceTurnIds.length ? [{ ...item, evidenceTurnIds }] : [];
    }),
    participants: parsed.participants.flatMap((item) => {
      const evidenceTurnIds = item.evidenceTurnIds.filter((id) => validTurnIds.has(id));
      return evidenceTurnIds.length ? [{ ...item, displayName: item.identityConfirmed ? item.displayName : null, evidenceTurnIds }] : [];
    })
  };
  for (const field of listFields) result[field] = reconcileList(parsed[field], validTurnIds);
  if (sourceMap) {
    const referenced = new Set<string>();
    const collect = (ids: readonly string[]) => ids.forEach((id) => referenced.add(id));
    collect(result.executiveSummary.evidenceTurnIds);
    collect(result.assessment.evidenceTurnIds);
    collect(result.dealAssessment.evidenceTurnIds);
    for (const field of listFields) result[field].forEach((item) => collect(item.evidenceTurnIds));
    result.commitments.forEach((item) => collect(item.commitment.evidenceTurnIds));
    result.actionItems.forEach((item) => collect(item.evidenceTurnIds));
    result.sellerPerformance.forEach((item) => collect(item.evidenceTurnIds));
    result.evidence = [...referenced].flatMap((id) => {
      const turn = sourceMap.get(id);
      return turn ? [{ transcriptTurnId: id, timestamp: turn.startedAt, speakerRole: turn.speakerRole, participantRole: roleToParticipant(turn.speakerRole), excerpt: turn.text.trim().slice(0, 280) }] : [];
    });
    result.participants = [...new Set([...sourceMap.values()].map((turn) => turn.speakerRole))].map((role) => ({
      participantRole: roleToParticipant(role), commercialRole: role, displayName: null,
      identityConfirmed: false,
      evidenceTurnIds: [...sourceMap.values()].filter((turn) => turn.speakerRole === role).slice(0, 50).map((turn) => turn.id)
    }));
    result.durationSeconds = metadata?.durationSeconds ?? result.durationSeconds;
    if (metadata) result.metadata = { transcriptVersion: metadata.transcriptVersion, generationVersion: metadata.generationVersion, source: 'FINAL_TRANSCRIPT', transcriptTurnCount: sourceMap.size };
  }
  return postCallReportContentSchema.parse(result);
}

export function mergePostCallReports(reports: readonly PostCallReportContent[]): PostCallReportContent {
  const first = reports[0];
  if (!first) throw new Error('POST_CALL_EMPTY_PARTIAL_REPORTS');
  const result: PostCallReportContent = {
    ...first,
    executiveSummary: { ...first.executiveSummary, evidenceTurnIds: [...new Set(reports.flatMap((item) => item.executiveSummary.evidenceTurnIds))] },
    commitments: reports.flatMap((item) => item.commitments),
    actionItems: reports.flatMap((item) => item.actionItems),
    sellerPerformance: reports.flatMap((item) => item.sellerPerformance),
    evidence: reports.flatMap((item) => item.evidence),
    assessment: {
      outcome: reports.some((item) => item.assessment.outcome === 'POSITIVE') ? 'POSITIVE' : reports.some((item) => item.assessment.outcome === 'NEGATIVE') ? 'NEGATIVE' : reports.some((item) => item.assessment.outcome === 'NEUTRAL') ? 'NEUTRAL' : 'INCONCLUSIVE',
      confidence: reports.reduce((sum, item) => sum + item.assessment.confidence, 0) / reports.length,
      rationale: first.assessment.rationale,
      evidenceTurnIds: [...new Set(reports.flatMap((item) => item.assessment.evidenceTurnIds))],
      experimentalScore: null
    },
    dealAssessment: {
      ...first.dealAssessment,
      blockers: reports.flatMap((item) => item.dealAssessment.blockers),
      positiveSignals: reports.flatMap((item) => item.dealAssessment.positiveSignals),
      evidenceTurnIds: [...new Set(reports.flatMap((item) => item.dealAssessment.evidenceTurnIds))]
    }
  };
  for (const field of listFields) result[field] = reports.flatMap((item) => item[field]);
  return result;
}

export interface PostCallProposal {
  target: 'DEAL_STATE' | 'MEMORY'; field: string; value: string; confidence: number;
  evidenceTurnIds: string[]; action: 'PROPOSE' | 'NOOP_DUPLICATE' | 'REVIEW_REQUIRED';
}
export function buildSafeProposals(report: PostCallReportContent, existingValues: ReadonlySet<string>): PostCallProposal[] {
  const sources: Array<[string, readonly EvidenceValue[]]> = [
    ['pain', report.pains], ['need', report.needs], ['objection', report.objections],
    ['decision_maker', report.decisionMakers], ['budget', report.budget],
    ['timeline', report.timeline], ['next_step', report.explicitNextSteps]
  ];
  return sources.flatMap(([field, values]) => values.map((item) => ({
    target: field === 'next_step' || field === 'budget' || field === 'timeline' ? 'DEAL_STATE' : 'MEMORY',
    field, value: item.value, confidence: item.confidence, evidenceTurnIds: item.evidenceTurnIds,
    action: existingValues.has(`${field}:${evidenceKey(item)}`) ? 'NOOP_DUPLICATE' : item.confidence >= 0.8 ? 'PROPOSE' : 'REVIEW_REQUIRED'
  })));
}

export interface PostCallEvaluationResult {
  cases: number; schemaPassRate: number; factualConsistency: number; hallucinationRate: number;
  evidenceCoverage: number; actionItemPrecision: number; objectionExtraction: number;
  nextStepExtraction: number; sellerAssessmentConsistency: number;
}
export function evaluatePostCallOutputs(cases: Array<{ output: unknown; turnIds: string[]; expected?: { actionItems?: number; objections?: number; nextSteps?: number; sellerDimensions?: number } }>): PostCallEvaluationResult {
  let schemaPasses = 0, evidence = 0, unsupported = 0, evidenceBearing = 0, covered = 0;
  let actionScore = 0, objectionScore = 0, nextStepScore = 0, sellerScore = 0;
  for (const item of cases) {
    const parsed = postCallReportContentSchema.safeParse(item.output);
    if (!parsed.success) continue;
    schemaPasses += 1;
    const ids = new Set(item.turnIds);
    const referenced = [...JSON.stringify(parsed.data).matchAll(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi)].map(([id]) => id);
    evidence += referenced.length;
    unsupported += referenced.filter((id) => !ids.has(id)).length;
    const facts = [parsed.data.executiveSummary, ...listFields.flatMap((field) => parsed.data[field])];
    evidenceBearing += facts.length;
    covered += facts.filter((fact) => fact.evidenceTurnIds.length > 0).length;
    const expected = item.expected ?? {};
    actionScore += expected.actionItems === undefined || expected.actionItems === parsed.data.actionItems.length ? 1 : 0;
    objectionScore += expected.objections === undefined || expected.objections === parsed.data.objections.length ? 1 : 0;
    nextStepScore += expected.nextSteps === undefined || expected.nextSteps === parsed.data.explicitNextSteps.length ? 1 : 0;
    sellerScore += expected.sellerDimensions === undefined || expected.sellerDimensions === parsed.data.sellerPerformance.length ? 1 : 0;
  }
  const validCases = Math.max(schemaPasses, 1);
  return {
    cases: cases.length,
    schemaPassRate: cases.length ? schemaPasses / cases.length : 0,
    factualConsistency: evidence ? (evidence - unsupported) / evidence : 1,
    hallucinationRate: evidence ? unsupported / evidence : 0,
    evidenceCoverage: evidenceBearing ? covered / evidenceBearing : 1,
    actionItemPrecision: actionScore / validCases,
    objectionExtraction: objectionScore / validCases,
    nextStepExtraction: nextStepScore / validCases,
    sellerAssessmentConsistency: sellerScore / validCases
  };
}
export function exportPostCallEvaluationCsv(result: PostCallEvaluationResult): string {
  return `${Object.keys(result).join(',')}\n${Object.values(result).join(',')}\n`;
}
export function exportPostCallEvaluationJson(result: PostCallEvaluationResult): string {
  return JSON.stringify(result, null, 2);
}

export { syntheticPostCallScenarios, type SyntheticPostCallScenario } from './fixtures.js';
