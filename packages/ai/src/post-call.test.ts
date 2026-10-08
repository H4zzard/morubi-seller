import { describe, expect, it } from 'vitest';
import { postCallReportContentSchema, type PostCallAnalysisInput } from '@morubi/post-call';
import { FixtureGenerativeProvider } from './providers.js';

const input: PostCallAnalysisInput = {
  profile: 'POST_CALL_ANALYSIS',
  phase: 'EXTRACT',
  processingVersion: 'post-call-v1',
  transcriptVersion: 'transcript-v1-fixture-1',
  sessionId: '00000000-0000-4000-8000-000000000010',
  segmentIndex: 0,
  segmentCount: 1,
  turns: [
    {
      id: '00000000-0000-4000-8000-000000000011',
      sequence: 1,
      speakerRole: 'LEAD',
      text: 'Temos muito retrabalho e vamos agendar o próximo passo.',
      startedAt: '2026-10-08T12:00:00.000Z'
    }
  ],
  partialReports: [],
  callMetadata: {},
  companyContext: {},
  playbookContext: [],
  dealState: {},
  liveMemory: {},
  constraints: { maxInputCharacters: 12_000, maxOutputCharacters: 16_000 }
};

describe('post-call generative provider', () => {
  it('produces deterministic structured evidence without inventing budget', async () => {
    const result = await new FixtureGenerativeProvider().analyzePostCall(input);
    const output = postCallReportContentSchema.parse(result.output);
    expect(output.pains).toHaveLength(1);
    expect(output.explicitNextSteps).toHaveLength(1);
    expect(output.budget).toEqual([]);
  });

  it('surfaces retryable provider failures without leaking provider payloads', async () => {
    await expect(new FixtureGenerativeProvider('FAILURE').analyzePostCall(input)).rejects.toEqual(
      expect.objectContaining({
        message: 'FIXTURE_500',
        retryable: true
      })
    );
  });
});
