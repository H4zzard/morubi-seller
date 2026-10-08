import { z } from 'zod';

export const POST_CALL_PROCESSING_VERSION = 'post-call-v1';
export const POST_CALL_PROMPT_VERSION = 'post-call-prompt-v1';

export const evidenceValueSchema = z
  .object({
    value: z.string().trim().min(1).max(2_000),
    confidence: z.number().min(0).max(1),
    evidenceTurnIds: z.array(z.string().uuid()).min(1).max(50)
  })
  .strict();

export type EvidenceValue = z.infer<typeof evidenceValueSchema>;

const commitmentSchema = z
  .object({
    actor: z.enum(['SELLER', 'LEAD', 'UNKNOWN']),
    commitment: evidenceValueSchema
  })
  .strict();

const assessmentSchema = z
  .object({
    outcome: z.enum(['POSITIVE', 'NEUTRAL', 'NEGATIVE', 'INCONCLUSIVE']),
    confidence: z.number().min(0).max(1),
    rationale: z.string().trim().min(1).max(2_000),
    evidenceTurnIds: z.array(z.string().uuid()).min(1).max(50),
    experimentalScore: z.number().min(0).max(100).nullable().default(null)
  })
  .strict();

export const postCallReportContentSchema = z
  .object({
    executiveSummary: evidenceValueSchema,
    context: z.array(evidenceValueSchema).max(30),
    pains: z.array(evidenceValueSchema).max(30),
    needs: z.array(evidenceValueSchema).max(30),
    objections: z.array(evidenceValueSchema).max(30),
    buyingSignals: z.array(evidenceValueSchema).max(30),
    decisionMakers: z.array(evidenceValueSchema).max(20),
    competitors: z.array(evidenceValueSchema).max(20),
    budget: z.array(evidenceValueSchema).max(10),
    timeline: z.array(evidenceValueSchema).max(20),
    commitments: z.array(commitmentSchema).max(30),
    explicitNextSteps: z.array(evidenceValueSchema).max(20),
    suggestedNextSteps: z.array(evidenceValueSchema).max(20),
    unansweredQuestions: z.array(evidenceValueSchema).max(30),
    risks: z.array(evidenceValueSchema).max(30),
    gaps: z.array(evidenceValueSchema).max(30),
    playbookObservations: z.array(evidenceValueSchema).max(30),
    assessment: assessmentSchema
  })
  .strict();

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
  sessionId: string;
  segmentIndex: number;
  segmentCount: number;
  turns: PostCallTurn[];
  partialReports: PostCallReportContent[];
  dealState: Record<string, unknown>;
  liveMemory: Record<string, unknown>;
  constraints: { maxInputCharacters: number; maxOutputCharacters: number };
}

export interface PostCallAnalysisResult {
  output: unknown;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface PostCallAnalysisProvider {
  readonly metadata: { provider: string; configVersion: string };
  analyzePostCall(
    input: PostCallAnalysisInput,
    signal?: AbortSignal
  ): Promise<PostCallAnalysisResult>;
}

export interface TranscriptSegment {
  index: number;
  turns: PostCallTurn[];
  characters: number;
}

export function segmentTranscript(
  turns: readonly PostCallTurn[],
  maxCharacters = 12_000
): TranscriptSegment[] {
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

function evidenceKey(item: EvidenceValue): string {
  return item.value.trim().toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ');
}

function reconcileList(
  values: readonly EvidenceValue[],
  validTurnIds: ReadonlySet<string>
): EvidenceValue[] {
  const byValue = new Map<string, EvidenceValue>();
  for (const item of values) {
    const ids = [...new Set(item.evidenceTurnIds.filter((id) => validTurnIds.has(id)))];
    if (!ids.length) continue;
    const key = evidenceKey(item);
    const current = byValue.get(key);
    if (!current || item.confidence > current.confidence) {
      byValue.set(key, { ...item, evidenceTurnIds: ids });
    } else {
      current.evidenceTurnIds = [...new Set([...current.evidenceTurnIds, ...ids])];
    }
  }
  return [...byValue.values()];
}

const listFields = [
  'context',
  'pains',
  'needs',
  'objections',
  'buyingSignals',
  'decisionMakers',
  'competitors',
  'budget',
  'timeline',
  'explicitNextSteps',
  'suggestedNextSteps',
  'unansweredQuestions',
  'risks',
  'gaps',
  'playbookObservations'
] as const;

export function reconcilePostCallReport(
  candidate: unknown,
  validTurnIds: ReadonlySet<string>
): PostCallReportContent {
  const parsed = postCallReportContentSchema.parse(candidate);
  const executiveEvidence = parsed.executiveSummary.evidenceTurnIds.filter((id) =>
    validTurnIds.has(id)
  );
  const assessmentEvidence = parsed.assessment.evidenceTurnIds.filter((id) => validTurnIds.has(id));
  if (!executiveEvidence.length || !assessmentEvidence.length)
    throw new Error('POST_CALL_UNSUPPORTED_SUMMARY');
  const result: PostCallReportContent = {
    ...parsed,
    executiveSummary: { ...parsed.executiveSummary, evidenceTurnIds: executiveEvidence },
    assessment: { ...parsed.assessment, evidenceTurnIds: assessmentEvidence },
    commitments: parsed.commitments.flatMap((item) => {
      const [commitment] = reconcileList([item.commitment], validTurnIds);
      return commitment ? [{ ...item, commitment }] : [];
    })
  };
  for (const field of listFields) result[field] = reconcileList(parsed[field], validTurnIds);
  return result;
}

export function mergePostCallReports(
  reports: readonly PostCallReportContent[]
): PostCallReportContent {
  const first = reports[0];
  if (!first) throw new Error('POST_CALL_EMPTY_PARTIAL_REPORTS');
  const evidenceTurnIds = [
    ...new Set(reports.flatMap((report) => report.executiveSummary.evidenceTurnIds))
  ];
  const assessmentEvidence = [
    ...new Set(reports.flatMap((report) => report.assessment.evidenceTurnIds))
  ];
  const outcome = reports.some((report) => report.assessment.outcome === 'POSITIVE')
    ? 'POSITIVE'
    : reports.some((report) => report.assessment.outcome === 'NEGATIVE')
      ? 'NEGATIVE'
      : reports.some((report) => report.assessment.outcome === 'NEUTRAL')
        ? 'NEUTRAL'
        : 'INCONCLUSIVE';
  const result: PostCallReportContent = {
    ...first,
    executiveSummary: { ...first.executiveSummary, evidenceTurnIds },
    commitments: reports.flatMap((report) => report.commitments),
    assessment: {
      outcome,
      confidence:
        reports.reduce((sum, report) => sum + report.assessment.confidence, 0) / reports.length,
      rationale: first.assessment.rationale,
      evidenceTurnIds: assessmentEvidence,
      experimentalScore: null
    }
  };
  for (const field of listFields) result[field] = reports.flatMap((report) => report[field]);
  return result;
}

export interface PostCallProposal {
  target: 'DEAL_STATE' | 'MEMORY';
  field: string;
  value: string;
  confidence: number;
  evidenceTurnIds: string[];
  action: 'PROPOSE' | 'NOOP_DUPLICATE' | 'REVIEW_REQUIRED';
}

export function buildSafeProposals(
  report: PostCallReportContent,
  existingValues: ReadonlySet<string>
): PostCallProposal[] {
  const sources: Array<[string, readonly EvidenceValue[]]> = [
    ['pain', report.pains],
    ['need', report.needs],
    ['objection', report.objections],
    ['decision_maker', report.decisionMakers],
    ['budget', report.budget],
    ['timeline', report.timeline],
    ['next_step', report.explicitNextSteps]
  ];
  return sources.flatMap(([field, values]) =>
    values.map((item) => {
      const fingerprint = `${field}:${evidenceKey(item)}`;
      return {
        target:
          field === 'next_step' || field === 'budget' || field === 'timeline'
            ? 'DEAL_STATE'
            : 'MEMORY',
        field,
        value: item.value,
        confidence: item.confidence,
        evidenceTurnIds: item.evidenceTurnIds,
        action: existingValues.has(fingerprint)
          ? 'NOOP_DUPLICATE'
          : item.confidence >= 0.8
            ? 'PROPOSE'
            : 'REVIEW_REQUIRED'
      } satisfies PostCallProposal;
    })
  );
}

export interface PostCallEvaluationResult {
  cases: number;
  schemaPassRate: number;
  evidencePrecision: number;
  falseFactRate: number;
}

export function evaluatePostCallOutputs(
  cases: Array<{ output: unknown; turnIds: string[] }>
): PostCallEvaluationResult {
  let schemaPasses = 0;
  let evidence = 0;
  let unsupported = 0;
  for (const item of cases) {
    const parsed = postCallReportContentSchema.safeParse(item.output);
    if (!parsed.success) continue;
    schemaPasses += 1;
    const ids = new Set(item.turnIds);
    const serialized = JSON.stringify(parsed.data);
    const referenced = [...serialized.matchAll(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi)].map(([id]) => id);
    evidence += referenced.length;
    unsupported += referenced.filter((id) => !ids.has(id)).length;
  }
  return {
    cases: cases.length,
    schemaPassRate: cases.length ? schemaPasses / cases.length : 0,
    evidencePrecision: evidence ? (evidence - unsupported) / evidence : 1,
    falseFactRate: evidence ? unsupported / evidence : 0
  };
}

export function exportPostCallEvaluationCsv(result: PostCallEvaluationResult): string {
  return `cases,schema_pass_rate,evidence_precision,false_fact_rate\n${result.cases},${result.schemaPassRate},${result.evidencePrecision},${result.falseFactRate}\n`;
}

export function exportPostCallEvaluationJson(result: PostCallEvaluationResult): string {
  return JSON.stringify(result, null, 2);
}
