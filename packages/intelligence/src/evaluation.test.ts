import { describe, expect, it } from 'vitest';
import {
  evaluateFixtureCorpus,
  exportEvaluationCsv,
  exportEvaluationJson,
  goldenScenarios
} from './evaluation.js';

describe('fixture evaluation corpus', () => {
  it('contains at least 50 multi-turn scenarios and 100 events', () => {
    expect(goldenScenarios.length).toBeGreaterThanOrEqual(50);
    expect(
      goldenScenarios.reduce((sum, scenario) => sum + scenario.turns.length, 0)
    ).toBeGreaterThanOrEqual(100);
  });

  it('exports expected versus actual intervention decisions for human review', async () => {
    const report = await evaluateFixtureCorpus();
    expect(report.cases).toHaveLength(55);
    expect(report.interventionAccuracy).toBeGreaterThanOrEqual(0.9);
    expect(exportEvaluationJson(report)).toContain('deliveredInVisibleMode');
    expect(exportEvaluationCsv(report).split('\n')).toHaveLength(56);
  });
  it('measures deterministic fixture quality', async () => {
    const report = await evaluateFixtureCorpus();
    expect(report.classificationAccuracy).toBeGreaterThanOrEqual(0.9);
    expect(report.objectionAccuracy).toBeGreaterThanOrEqual(0.9);
    expect(report.categories.every((metric) => metric.falsePositiveRate <= 0.1)).toBe(true);
  });
});
