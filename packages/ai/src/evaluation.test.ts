import { describe, expect, it } from 'vitest';
import {
  evaluateGenerativeCorpus,
  exportGenerativeEvaluationCsv,
  exportGenerativeEvaluationJson,
  generativeEvaluationCorpus
} from './evaluation.js';

describe('generative evaluation corpus', () => {
  it('contains at least 50 generation-required cases across required categories', () => {
    expect(generativeEvaluationCorpus.length).toBeGreaterThanOrEqual(50);
    expect(new Set(generativeEvaluationCorpus.map((item) => item.category))).toEqual(
      new Set([
        'PRICE',
        'COMPETITOR',
        'TIMING',
        'AUTHORITY',
        'TRUST',
        'IMPLEMENTATION',
        'NEED',
        'FOLLOW_UP'
      ])
    );
  });

  it('passes deterministic golden criteria and exports human-review data', async () => {
    const report = await evaluateGenerativeCorpus();
    expect(report.caseCount).toBe(56);
    expect(report.passRate).toBe(1);
    expect(exportGenerativeEvaluationJson(report)).toContain('validationResult');
    expect(exportGenerativeEvaluationCsv(report).split('\n')).toHaveLength(57);
  });
});
