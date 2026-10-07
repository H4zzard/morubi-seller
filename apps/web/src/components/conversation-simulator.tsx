'use client';

import { useEffect, useState } from 'react';
import type {
  AudioAssetDevDto,
  ConversationSummaryDto,
  CopilotAnalyticsDto,
  CursorPageDto
} from '@morubi/contracts';
import { apiClient } from '../lib/api';

const scenarios = [
  'PRICE',
  'COMPETITOR',
  'TIMING',
  'DECISION_MAKER',
  'BUYING_SIGNAL',
  'REJECTION',
  'NEUTRAL'
] as const;
const audioScenarios = ['PRICE', 'TIMING', 'COMPETITOR', 'BUYING_SIGNAL', 'NEUTRAL'] as const;

export function ConversationSimulator() {
  const [conversations, setConversations] = useState<ConversationSummaryDto[]>([]);
  const [conversationId, setConversationId] = useState('');
  const [scenario, setScenario] = useState<(typeof scenarios)[number]>('PRICE');
  const [visible, setVisible] = useState(false);
  const [feedbackEnabled, setFeedbackEnabled] = useState(true);
  const [generativeAiEnabled, setGenerativeAiEnabled] = useState(false);
  const [analytics, setAnalytics] = useState<CopilotAnalyticsDto | null>(null);
  const [status, setStatus] = useState('Pronto para simular.');
  const [audioScenario, setAudioScenario] = useState<(typeof audioScenarios)[number]>('PRICE');
  const [audioAssets, setAudioAssets] = useState<AudioAssetDevDto[]>([]);
  const [audioStatus, setAudioStatus] = useState('Audio assincrono pronto para simular.');

  const refresh = () =>
    apiClient.request<CopilotAnalyticsDto>('/v1/dev/intelligence/analytics').then(setAnalytics);
  const refreshAudio = () =>
    apiClient
      .request<{ items: AudioAssetDevDto[] }>('/v1/dev/audio/assets')
      .then((result) => setAudioAssets(result.items));

  useEffect(() => {
    void Promise.all([
      apiClient.request<CursorPageDto<ConversationSummaryDto>>('/v1/conversations?limit=100'),
      apiClient.request<CopilotAnalyticsDto>('/v1/dev/intelligence/analytics')
    ]).then(([page, metrics]) => {
      setConversations(page.items);
      setConversationId(page.items[0]?.id ?? '');
      setAnalytics(metrics);
    });
  }, []);

  async function applySettings() {
    await apiClient.request('/v1/dev/intelligence/settings', {
      method: 'PATCH',
      body: JSON.stringify({
        mode: visible ? 'VISIBLE' : 'SHADOW',
        realtimeEnabled: true,
        feedbackEnabled,
        maxCardsPerWindow: 3,
        cardWindowSeconds: 900,
        cooldownSeconds: 180,
        minimumPriority: 40,
        deliveryTtlSeconds: 900,
        generativeAiEnabled,
        generateInShadow: true,
        companyRules: [
          'Não oferecer desconto sem aprovação.',
          'Não inventar preço, prazo, feature ou condição comercial.'
        ],
        maxGenerationInputCharacters: 6000,
        maxGenerationOutputCharacters: 700,
        organizationGenerationBudgetMicros: 0,
        sellerGenerationBudgetMicros: 0,
        maxCostPerInterventionMicros: 0
      })
    });
    setStatus(visible ? 'Modo visível aplicado.' : 'Modo shadow aplicado.');
  }

  async function simulate() {
    if (!conversationId) return;
    setStatus('Evento aceito; aguardando worker assíncrono…');
    const result = await apiClient.request<{ eventId: string; jobId: string }>(
      '/v1/dev/conversations/simulate',
      {
        method: 'POST',
        body: JSON.stringify({ conversationId, scenario })
      }
    );
    setStatus(
      `Job ${result.jobId.slice(0, 8)} criado para o evento ${result.eventId.slice(0, 8)}.`
    );
    window.setTimeout(() => void refresh(), 1_500);
  }

  async function simulateAudio() {
    if (!conversationId) return;
    setAudioStatus('Audio armazenado; aguardando transcricao no worker...');
    await apiClient.request('/v1/dev/audio/settings', {
      method: 'PATCH',
      body: JSON.stringify({ enabled: true })
    });
    const result = await apiClient.request<{ assetId: string; jobId: string }>(
      '/v1/dev/audio/simulate',
      {
        method: 'POST',
        body: JSON.stringify({ conversationId, scenario: audioScenario })
      }
    );
    setAudioStatus(`Asset ${result.assetId.slice(0, 8)} / job ${result.jobId.slice(0, 8)}.`);
    window.setTimeout(() => void refreshAudio(), 1_500);
  }

  return (
    <div className="dev-console">
      <section className="panel">
        <div className="eyebrow">Entrega</div>
        <h2>{visible ? 'Visible' : 'Shadow'}</h2>
        <label className="dev-toggle">
          <input
            type="checkbox"
            checked={visible}
            onChange={(event) => setVisible(event.target.checked)}
          />
          Entregar cards ao seller
        </label>
        <label className="dev-toggle">
          <input
            type="checkbox"
            checked={feedbackEnabled}
            onChange={(event) => setFeedbackEnabled(event.target.checked)}
          />
          Feedback habilitado
        </label>
        <label className="dev-toggle">
          <input
            type="checkbox"
            checked={generativeAiEnabled}
            onChange={(event) => setGenerativeAiEnabled(event.target.checked)}
          />
          Geração fixture/DeepSeek habilitada
        </label>
        <button className="button" onClick={() => void applySettings()}>
          Aplicar configuração
        </button>
      </section>
      <section className="panel">
        <div className="eyebrow">Audio Intelligence</div>
        <h2>Simular audio</h2>
        <select
          value={audioScenario}
          onChange={(event) => setAudioScenario(event.target.value as typeof audioScenario)}
        >
          {audioScenarios.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
        <button className="button" disabled={!conversationId} onClick={() => void simulateAudio()}>
          Enviar audio sintetico
        </button>
        <p>{audioStatus}</p>
        <p>
          {audioAssets[0]
            ? `${audioAssets[0].status} / ${audioAssets[0].jobStatus ?? 'sem job'}: ${audioAssets[0].transcript ?? 'sem transcricao'}`
            : 'Nenhum asset consultado.'}
        </p>
        {audioAssets[0] ? (
          <p>
            Evento {audioAssets[0].commercialEventId?.slice(0, 8) ?? '—'} · decisão{' '}
            {audioAssets[0].decisionId?.slice(0, 8) ?? '—'} · intervenção{' '}
            {audioAssets[0].interventionDeliveryId?.slice(0, 8) ?? '—'}
          </p>
        ) : null}
        <button className="button" onClick={() => void refreshAudio()}>
          Atualizar fila de audio
        </button>
      </section>
      <section className="panel">
        <div className="eyebrow">Fixture sintética</div>
        <h2>Simular conversa</h2>
        <select value={conversationId} onChange={(event) => setConversationId(event.target.value)}>
          {conversations.map((item) => (
            <option key={item.id} value={item.id}>
              {item.primaryContactName ?? item.subject ?? item.id} · {item.dealTitle ?? 'sem deal'}
            </option>
          ))}
        </select>
        <select
          value={scenario}
          onChange={(event) => setScenario(event.target.value as typeof scenario)}
        >
          {scenarios.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
        <button className="button" disabled={!conversationId} onClick={() => void simulate()}>
          Disparar evento
        </button>
        <p>{status}</p>
      </section>
      <section className="panel">
        <div className="eyebrow">Telemetria</div>
        <h2>{analytics?.delivered ?? 0} entregues</h2>
        <p>
          {analytics?.viewed ?? 0} vistos · {analytics?.dismissed ?? 0} dispensados ·{' '}
          {analytics?.applied ?? 0} aplicados
        </p>
        <p>False card rate: {((analytics?.falseCardRate ?? 0) * 100).toFixed(1)}%</p>
        <button className="button" onClick={() => void refresh()}>
          Atualizar métricas
        </button>
      </section>
    </div>
  );
}
