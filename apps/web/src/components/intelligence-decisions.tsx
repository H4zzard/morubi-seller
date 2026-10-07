'use client';

import { useEffect, useState } from 'react';
import { apiClient } from '../lib/api';

interface DecisionRow {
  decision: {
    id: string;
    provider: string;
    model: string;
    confidence: number;
    policyResult: string;
    policyReason: string;
    output: {
      eventClassification: string;
      strategy: string;
      stateUpdates: unknown[];
      memoryUpdates: unknown[];
    };
  };
  eventText: string | null;
  intervention: { outcome: string; title: string | null } | null;
}

interface GenerativeExecutionRow {
  id: string;
  provider: string;
  model: string;
  profile: string;
  status: string;
  inputSummary: { strategy?: string; interventionType?: string };
  output: {
    title?: string;
    guidance?: string;
    suggestedQuestion?: string | null;
  } | null;
  validationResult: string | null;
  validationErrors: string[];
  inputTokens: number;
  outputTokens: number;
  estimatedCostMicros: string;
  generationLatencyMs: number | null;
  generationToDeliveryMs: number | null;
}

export function IntelligenceDecisions() {
  const [rows, setRows] = useState<DecisionRow[]>([]);
  const [generations, setGenerations] = useState<GenerativeExecutionRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      apiClient.request<{ items: DecisionRow[] }>('/v1/dev/intelligence/decisions'),
      apiClient.request<{ items: GenerativeExecutionRow[] }>(
        '/v1/dev/intelligence/generative-executions'
      )
    ])
      .then(([decisions, executions]) => {
        setRows(decisions.items);
        setGenerations(executions.items);
      })
      .catch(() => setError('Não foi possível carregar a inspeção de inteligência.'));
  }, []);

  if (error) return <div className="empty-state">{error}</div>;
  if (rows.length === 0 && generations.length === 0)
    return <div className="empty-state">Nenhuma decisão ou geração foi processada.</div>;

  return (
    <div className="stack">
      {generations.map((execution) => (
        <article className="panel" key={execution.id}>
          <div className="eyebrow">
            GERAÇÃO · {execution.profile} · {execution.status}
          </div>
          <h2>
            {execution.inputSummary.interventionType ?? 'Intervenção'} ·{' '}
            {execution.inputSummary.strategy ?? 'sem estratégia'}
          </h2>
          <p>
            {execution.provider} · {execution.model} · validação{' '}
            {execution.validationResult ?? 'pendente'}
          </p>
          {execution.output ? (
            <>
              <strong>{execution.output.title}</strong>
              <p>{execution.output.guidance}</p>
              {execution.output.suggestedQuestion ? (
                <p>Pergunta: {execution.output.suggestedQuestion}</p>
              ) : null}
            </>
          ) : null}
          <p>
            Tokens: {execution.inputTokens}/{execution.outputTokens} · custo μ:{' '}
            {execution.estimatedCostMicros} · geração {execution.generationLatencyMs ?? '—'} ms ·
            entrega {execution.generationToDeliveryMs ?? '—'} ms
          </p>
          {execution.validationErrors.length > 0 ? (
            <p>Validação: {execution.validationErrors.join(', ')}</p>
          ) : null}
        </article>
      ))}

      {rows.map(({ decision, eventText, intervention }) => (
        <article className="panel" key={decision.id}>
          <div className="eyebrow">
            {decision.provider} · {decision.model} · {decision.policyResult}
          </div>
          <h2>
            {decision.output.eventClassification} · {decision.output.strategy}
          </h2>
          <p>{eventText ?? 'Evento sem conteúdo textual.'}</p>
          <p>
            Confiança: {(decision.confidence * 100).toFixed(0)}% · {decision.policyReason}
          </p>
          <p>
            Delta: {decision.output.stateUpdates.length} estado ·{' '}
            {decision.output.memoryUpdates.length} memória
          </p>
          <p>
            Intervenção: {intervention?.outcome ?? 'sem candidata'}
            {intervention?.title ? ` · ${intervention.title}` : ''}
          </p>
        </article>
      ))}
    </div>
  );
}
