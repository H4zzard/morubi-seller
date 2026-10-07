import {
  ChevronRight,
  CircleStop,
  Expand,
  Mic,
  Minimize2,
  Play,
  Radio,
  RefreshCw,
  ShieldCheck,
  Video
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type {
  ConversationSummaryDto,
  InterventionCardDto,
  LiveCallDetailDto,
  MeetingProvider,
  RealtimeEventEnvelope
} from '@morubi/contracts';
import { Button } from '@morubi/ui';

const phaseLabels: Record<LiveCallDetailDto['currentPhase'], string> = {
  INTRODUCTION: 'Introdução',
  DISCOVERY: 'Diagnóstico',
  PRESENTATION: 'Apresentação',
  VALUE: 'Valor',
  DECISION: 'Decisão',
  UNKNOWN: 'Em análise'
};

const orderedPhases: LiveCallDetailDto['currentPhase'][] = [
  'INTRODUCTION',
  'DISCOVERY',
  'PRESENTATION',
  'VALUE',
  'DECISION'
];

function durationLabel(startedAt: string | null, endedAt: string | null, now: number): string {
  if (!startedAt) return '00:00';
  const seconds = Math.max(
    0,
    Math.floor(
      ((endedAt ? new Date(endedAt).getTime() : now) - new Date(startedAt).getTime()) / 1_000
    )
  );
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function cardFromEvent(event: RealtimeEventEnvelope): InterventionCardDto | null {
  if (event.type !== 'intervention.created') return null;
  const card = event.payload.card;
  if (!card || typeof card !== 'object') return null;
  const candidate = card as Partial<InterventionCardDto>;
  return typeof candidate.deliveryId === 'string' && typeof candidate.guidance === 'string'
    ? (candidate as InterventionCardDto)
    : null;
}

export function LiveCallsView() {
  const [session, setSession] = useState<LiveCallDetailDto | null>(null);
  const [conversations, setConversations] = useState<ConversationSummaryDto[]>([]);
  const [conversationId, setConversationId] = useState('');
  const [card, setCard] = useState<InterventionCardDto | null>(null);
  const [compact, setCompact] = useState(false);
  const [alwaysOnTop, setAlwaysOnTop] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh(): Promise<void> {
    const current = await window.morubi.liveCalls.getCurrent();
    setSession(current.session);
  }

  useEffect(() => {
    void Promise.all([
      window.morubi.liveCalls.getCurrent(),
      window.morubi.commercial.listConversations()
    ])
      .then(([current, page]) => {
        setSession(current.session);
        const eligible = page.items.filter((item) => item.dealId);
        setConversations(eligible);
        setConversationId((value) => value || eligible[0]?.id || '');
      })
      .catch(() => setError('Não foi possível carregar o ambiente de calls.'));
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    const unsubscribe = window.morubi.realtime.subscribe((event) => {
      const next = cardFromEvent(event);
      if (next?.liveCallSessionId) setCard(next);
    });
    return () => {
      window.clearInterval(timer);
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (session?.status !== 'ACTIVE') return;
    const heartbeat = window.setInterval(() => {
      void window.morubi.liveCalls
        .heartbeat(session.id, { bufferedBytes: 0, droppedChunks: 0 })
        .catch(() => setError('Conexão instável. Tentando reconectar…'));
    }, 10_000);
    return () => window.clearInterval(heartbeat);
  }, [session?.id, session?.status]);

  useEffect(() => {
    document.body.classList.toggle('live-compact-mode', compact);
    void window.morubi.liveCalls.setCompactMode({ compact, alwaysOnTop: compact && alwaysOnTop });
    return () => document.body.classList.remove('live-compact-mode');
  }, [compact, alwaysOnTop]);

  useEffect(
    () => () => {
      void window.morubi.liveCalls.setCompactMode({ compact: false, alwaysOnTop: false });
    },
    []
  );

  async function run(action: () => Promise<void>): Promise<void> {
    setPending(true);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível atualizar a call.');
    } finally {
      setPending(false);
    }
  }

  function simulateDetection(provider: Extract<MeetingProvider, 'MEET' | 'ZOOM'>): void {
    void run(async () => {
      if (!conversationId) throw new Error('Selecione uma conversa vinculada a um deal.');
      await window.morubi.liveCalls.simulate({
        action: 'DETECT',
        meetingProvider: provider,
        conversationId
      });
      await refresh();
    });
  }

  function simulateAction(action: 'START' | 'EMIT_SCRIPT' | 'END'): void {
    if (!session) return;
    void run(async () => {
      await window.morubi.liveCalls.simulate({
        action,
        meetingProvider: session.meetingProvider === 'ZOOM' ? 'ZOOM' : 'MEET',
        conversationId: session.conversationId ?? conversationId,
        sessionId: session.id
      });
      if (action === 'END') {
        setSession({ ...session, status: 'ENDED', endedAt: new Date().toISOString() });
        setCard(null);
      } else {
        await refresh();
      }
    });
  }

  const activeGuidance = useMemo(() => {
    if (card) return card;
    return {
      title:
        session?.currentPhase === 'DISCOVERY' ? 'Aprofunde o impacto' : 'Escute e contextualize',
      guidance:
        session?.currentPhase === 'DISCOVERY'
          ? 'Entenda o impacto do problema antes de apresentar a solução.'
          : 'Deixe o lead concluir o raciocínio e valide o contexto.',
      suggestedQuestion: 'Hoje, quanto essa situação custa para a operação?'
    };
  }, [card, session?.currentPhase]);

  const nextPossibilities = useMemo(() => {
    if (session?.currentPhase === 'DECISION')
      return ['Confirmar critérios de decisão', 'Combinar próximo passo'];
    if (session?.currentPhase === 'VALUE')
      return ['Conectar valor à dor', 'Validar retorno esperado', 'Evitar desconto precoce'];
    return ['Aprofundar impacto', 'Confirmar prioridade', 'Mapear quem decide'];
  }, [session?.currentPhase]);

  if (compact && session) {
    return (
      <section className="live-compact" aria-label="Copiloto compacto">
        <header>
          <span className="live-listening-dot" />
          <div>
            <strong>Copiloto ativo</strong>
            <small>{phaseLabels[session.currentPhase]}</small>
          </div>
          <button aria-label="Expandir" onClick={() => setCompact(false)}>
            <Expand size={15} />
          </button>
        </header>
        <div
          className={card?.category === 'OBJECTION' ? 'live-now live-now--objection' : 'live-now'}
        >
          <span>{card?.category === 'OBJECTION' ? '⚠ OBJEÇÃO · AGORA' : 'AGORA'}</span>
          <h2>{activeGuidance.title}</h2>
          <p>{activeGuidance.guidance}</p>
          {activeGuidance.suggestedQuestion ? (
            <blockquote>“{activeGuidance.suggestedQuestion}”</blockquote>
          ) : null}
        </div>
        <footer>
          <button onClick={() => setCard(null)}>Dispensar</button>
          <label>
            <input
              type="checkbox"
              checked={alwaysOnTop}
              onChange={(event) => setAlwaysOnTop(event.target.checked)}
            />
            sempre visível
          </label>
        </footer>
      </section>
    );
  }

  if (!session) {
    return (
      <section className="live-calls live-calls--waiting">
        <div className="live-waiting-orb">
          <Radio size={28} />
        </div>
        <span className="morubi-eyebrow">Live Calls</span>
        <h1>Aguardando uma call</h1>
        <p>
          Morubi está pronto para detectar uma reunião compatível. A captura nunca inicia sem
          confirmação.
        </p>
        <label className="live-conversation-picker">
          Contexto comercial para o simulator
          <select
            value={conversationId}
            onChange={(event) => setConversationId(event.target.value)}
          >
            {conversations.map((conversation) => (
              <option key={conversation.id} value={conversation.id}>
                {conversation.primaryContactName ?? conversation.subject ?? 'Conversa'} ·{' '}
                {conversation.dealTitle ?? 'Sem deal'}
              </option>
            ))}
          </select>
        </label>
        <div className="live-dev-actions">
          <Button disabled={pending || !conversationId} onClick={() => simulateDetection('MEET')}>
            <Video size={15} /> Simular Meet detectado
          </Button>
          <Button
            variant="secondary"
            disabled={pending || !conversationId}
            onClick={() => simulateDetection('ZOOM')}
          >
            <Video size={15} /> Simular Zoom detectado
          </Button>
        </div>
        {error ? <div className="desktop-error">{error}</div> : null}
      </section>
    );
  }

  if (session.status === 'DETECTED' || session.status === 'READY') {
    return (
      <section className="live-calls live-detected">
        <span className="morubi-eyebrow">Reunião detectada</span>
        <div className="live-provider-mark">
          <Video size={22} />
          <div>
            <h1>
              {session.meetingProvider === 'MEET' ? 'Google Meet detectado' : 'Zoom detectado'}
            </h1>
            <p>{session.meetingTitle}</p>
          </div>
        </div>
        <div className="live-consent-copy">
          <ShieldCheck size={20} />
          <p>
            O Morubi só inicia após sua confirmação. No simulator, a conversa é sintética e nenhum
            áudio bruto é salvo.
          </p>
        </div>
        <Button disabled={pending} onClick={() => simulateAction('START')}>
          <Play size={15} /> Iniciar copiloto
        </Button>
        {error ? <div className="desktop-error">{error}</div> : null}
      </section>
    );
  }

  if (session.status === 'ENDED') {
    return (
      <section className="live-calls live-ended">
        <CircleStop size={32} />
        <span className="morubi-eyebrow">Call finalizada</span>
        <h1>{durationLabel(session.startedAt, session.endedAt, now)}</h1>
        <p>{session.turns.filter((turn) => turn.isFinal).length} eventos de fala processados.</p>
        <Button variant="secondary" onClick={() => setSession(null)}>
          Voltar para Calls
        </Button>
      </section>
    );
  }

  return (
    <section className="live-calls live-active">
      <header className="live-call-header">
        <div>
          <span className="live-active-label">
            <i /> Morubi está ouvindo esta call
          </span>
          <h1>{session.context.contactName ?? session.meetingTitle ?? 'Call ao vivo'}</h1>
          <p>
            {[session.context.companyName, session.context.dealTitle].filter(Boolean).join(' · ') ||
              'Contexto comercial ainda não vinculado'}
          </p>
        </div>
        <div className="live-header-meta">
          <strong>{durationLabel(session.startedAt, session.endedAt, now)}</strong>
          <span>{session.meetingProvider}</span>
          <button onClick={() => setCompact(true)}>
            <Minimize2 size={14} /> Modo compacto
          </button>
        </div>
      </header>

      <div className="live-phase-strip">
        {orderedPhases.map((phase) => (
          <div key={phase} className={session.currentPhase === phase ? 'active' : ''}>
            <i /> {phaseLabels[phase]}
          </div>
        ))}
      </div>

      <div className="live-grid">
        <div className="live-transcript-column">
          <div className="live-column-heading">
            <span>Transcrição incremental</span>
            <button onClick={() => void refresh()} aria-label="Atualizar">
              <RefreshCw size={13} />
            </button>
          </div>
          <div className="live-transcript-stream">
            {session.turns.length ? (
              session.turns.map((turn) => (
                <article
                  key={turn.id}
                  className={turn.speakerRole === 'SELLER' ? 'seller' : 'lead'}
                >
                  <strong>
                    {turn.speakerRole === 'SELLER'
                      ? 'Você'
                      : turn.speakerRole === 'LEAD'
                        ? 'Lead'
                        : 'Voz'}
                  </strong>
                  <p>{turn.text}</p>
                  <small>{turn.isPartial ? 'parcial' : `final · ${turn.sequence}`}</small>
                </article>
              ))
            ) : (
              <p className="live-empty-transcript">Aguardando o primeiro turno final…</p>
            )}
          </div>
          <div className="live-dev-actions live-dev-actions--inline">
            <Button
              variant="secondary"
              disabled={pending}
              onClick={() => simulateAction('EMIT_SCRIPT')}
            >
              <Mic size={14} /> Emitir conversa fixture
            </Button>
            <Button variant="ghost" disabled={pending} onClick={() => simulateAction('END')}>
              <CircleStop size={14} /> Encerrar call
            </Button>
          </div>
        </div>

        <aside className="live-copilot-column">
          <div className="live-copilot-title">
            <span>
              <i /> Copiloto ativo
            </span>
            <small>tempo real</small>
          </div>
          <div
            className={card?.category === 'OBJECTION' ? 'live-now live-now--objection' : 'live-now'}
          >
            <span>{card?.category === 'OBJECTION' ? '⚠ OBJEÇÃO · PREÇO' : 'AGORA'}</span>
            <h2>{activeGuidance.title}</h2>
            <p>{activeGuidance.guidance}</p>
            {card?.category === 'OBJECTION' ? (
              <div className="live-objection-steps">
                <b>VALIDAR</b>
                <ChevronRight size={12} />
                <b>EXPLORAR</b>
                <ChevronRight size={12} />
                <b>ISOLAR</b>
              </div>
            ) : null}
            {activeGuidance.suggestedQuestion ? (
              <blockquote>“{activeGuidance.suggestedQuestion}”</blockquote>
            ) : null}
          </div>
          <div className="live-next-options">
            <h3>Próximas possibilidades</h3>
            <ul>
              {nextPossibilities.map((possibility) => (
                <li key={possibility}>{possibility}</li>
              ))}
            </ul>
          </div>
          <div className="live-memory">
            <h3>Contexto vivo</h3>
            <dl>
              <div>
                <dt>Etapa</dt>
                <dd>
                  {phaseLabels[session.currentPhase]} · {Math.round(session.phaseConfidence * 100)}%
                </dd>
              </div>
              <div>
                <dt>Dores</dt>
                <dd>{session.memory.pains.at(-1) ?? 'Em descoberta'}</dd>
              </div>
              <div>
                <dt>Objeções</dt>
                <dd>{session.memory.objections.at(-1) ?? 'Nenhuma ativa'}</dd>
              </div>
              <div>
                <dt>Buying signal</dt>
                <dd>{session.memory.buyingSignals.at(-1) ?? 'Aguardando'}</dd>
              </div>
            </dl>
          </div>
        </aside>
      </div>
      {error ? <div className="desktop-error live-error">{error}</div> : null}
    </section>
  );
}
