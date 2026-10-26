import {
  CircleStop,
  Expand,
  Mic,
  Minimize2,
  MonitorSpeaker,
  Play,
  Radio,
  ShieldCheck,
  Video,
  Volume2
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type {
  ConversationSummaryDto,
  LiveCallDetailDto,
  LiveTranscriptTurnDto,
  LiveTranscriptionCapabilityDto,
  LiveTranscriptionStatusDto
} from '@morubi/contracts';
import { Button } from '@morubi/ui';
import type {
  LiveCallRuntimeCapabilities,
  MeetingCandidateDto,
  SystemAudioSourceDto
} from '../../shared/ipc';
import {
  DualAudioCaptureController,
  MacOSBlackHoleSystemAudioCaptureProvider,
  MacOSNativeSystemAudioCaptureProvider,
  MediaDevicesMicrophoneCaptureProvider,
  WindowsSystemAudioCaptureProvider,
  enumerateMicrophones,
  type DualCaptureSnapshot,
  type MicrophoneDevice
} from './live-audio-capture';
import {
  createLiveCallRequest,
  manualMeetingProviders,
  meetingProviderLabel,
  shouldPollMeetingDetection,
  type LiveCallIntent,
  type ManualMeetingProvider
} from './live-call-intent';

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

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('MICROPHONE_PERMISSION_DENIED') || message.includes('LOCAL_MIC_PERMISSION'))
    return 'O sistema operacional negou o acesso ao microfone.';
  if (message.includes('MACOS_SYSTEM_AUDIO_PERMISSION_DENIED'))
    return 'O macOS negou o acesso à fonte de áudio da reunião.';
  if (message.includes('MACOS_NATIVE_SYSTEM_AUDIO_PERMISSION_REQUIRED'))
    return 'Permita Gravação da Tela ao Morubi para captar somente o áudio da reunião e reabra o aplicativo.';
  if (
    message.includes('MACOS_NATIVE_SYSTEM_AUDIO_FAILED') ||
    message.includes('MACOS_NATIVE_SYSTEM_AUDIO_START_TIMEOUT')
  )
    return 'O áudio da reunião não pôde ser iniciado. Verifique a permissão do Morubi e tente novamente.';
  if (message.includes('MACOS_NATIVE_SYSTEM_AUDIO_UNAVAILABLE'))
    return 'A captura nativa do áudio da reunião não está disponível nesta instalação.';
  if (message.includes('BLACKHOLE_2CH_NOT_FOUND'))
    return 'O componente necessário para ouvir a reunião não foi encontrado.';
  if (message.includes('BLACKHOLE_2CH_REMOVED'))
    return 'A fonte de áudio da reunião foi removida; as duas capturas foram encerradas.';
  if (message.includes('SYSTEM_AUDIO_PERMISSION') || message.includes('SYSTEM_AUDIO_CANCELLED'))
    return 'A seleção de áudio do sistema foi cancelada ou negada.';
  if (message.includes('SYSTEM_AUDIO_TRACK_MISSING'))
    return 'A fonte selecionada não forneceu áudio da reunião.';
  if (message.includes('LOCAL_MIC_NO_AUDIO_CHUNKS'))
    return 'O microfone parou de fornecer amostras; a captura foi encerrada com segurança.';
  if (message.includes('SYSTEM_AUDIO_NO_AUDIO_CHUNKS'))
    return 'O áudio da reunião parou de fornecer amostras; a captura foi encerrada com segurança.';
  if (message.includes('LOCAL_MIC_DEVICE_REMOVED')) return 'O microfone selecionado foi removido.';
  if (message.includes('LIVE_CAPTURE_ALREADY_ACTIVE'))
    return 'Já existe uma captura ativa nesta conta.';
  if (message.includes('LIVE_CAPTURE_DISABLED')) return 'A captura real está desabilitada.';
  if (
    message.includes('LIVE_TRANSCRIPTION_UNAVAILABLE') ||
    message.includes('transcrição em tempo real não está configurada')
  )
    return 'A transcrição ao vivo ainda não está configurada neste ambiente.';
  if (message.includes('LIVE_AUDIO_CONNECTION'))
    return 'Não foi possível conectar a transcrição. Tente novamente em instantes.';
  if (message.includes('LIVE_CALLS_SERVICE_DISABLED'))
    return 'O serviço de Calls ainda não está habilitado neste ambiente. Solicite a ativação e tente novamente.';
  if (message.includes('LIVE_CALLS_SERVICE_UNAVAILABLE'))
    return 'Não foi possível consultar o serviço de Calls. Verifique a conexão com a API e tente novamente.';
  if (message.includes('A captura de calls não está habilitada para esta organização.'))
    return 'A captura de calls não está habilitada para esta organização. Solicite a ativação e tente novamente.';
  return message || 'Não foi possível iniciar a captura.';
}

function CaptureMetrics({ metrics }: { metrics: DualCaptureSnapshot | null }) {
  if (!metrics) return null;
  return (
    <div className="live-capture-metrics" aria-label="Métricas locais de captura">
      {metrics.sources.map((source) => (
        <article key={source.source}>
          <div>
            {source.source === 'LOCAL_MIC' ? <Mic size={18} /> : <Volume2 size={18} />}
            <strong>{source.source === 'LOCAL_MIC' ? 'Seu microfone' : 'Áudio da reunião'}</strong>
            <span data-state={source.state}>{source.state}</span>
          </div>
          <div className="live-signal" aria-label={`Nível ${source.source}`}>
            <i style={{ width: `${Math.round(source.signalLevel * 100)}%` }} />
          </div>
          <dl>
            <div>
              <dt>Chunks</dt>
              <dd>{source.chunks}</dd>
            </div>
            <div>
              <dt>Buffer</dt>
              <dd>{Math.round(source.bufferedBytes / 1024)} KB</dd>
            </div>
            <div>
              <dt>Descartados</dt>
              <dd>{source.droppedChunks}</dd>
            </div>
            <div>
              <dt>Sinal</dt>
              <dd>{source.muted ? 'mudo' : `${Math.round(source.signalLevel * 100)}%`}</dd>
            </div>
          </dl>
          <small>{source.deviceLabel ?? 'Dispositivo padrão do sistema'}</small>
        </article>
      ))}
    </div>
  );
}

function transcriptionStatusLabel(status: LiveTranscriptionStatusDto | null): string {
  if (!status) return 'Preparando transcrição';
  if (status.state === 'CONNECTED') return 'Transcrição ao vivo';
  if (status.state === 'CONNECTING' || status.state === 'RECONNECTING') return 'Reconectando…';
  if (status.state === 'UNSTABLE') return 'Conexão instável';
  if (status.state === 'FAILED') return 'Transcrição interrompida';
  return 'Transcrição encerrada';
}

function LiveTranscript({ turns }: { turns: LiveTranscriptTurnDto[] }) {
  if (!turns.length)
    return (
      <div className="live-transcript live-transcript--empty">
        <strong>Transcrição ao vivo</strong>
        <p>As falas aparecerão aqui quando a conversa começar.</p>
      </div>
    );
  return (
    <div className="live-transcript" aria-live="polite">
      <strong>Transcrição ao vivo</strong>
      <div className="live-transcript-turns">
        {turns.map((turn) => (
          <article
            key={turn.clientTurnId}
            data-speaker={turn.speakerOrigin === 'LOCAL_MIC' ? 'seller' : 'remote'}
            data-final={turn.isFinal}
          >
            <header>
              <span>{turn.speakerOrigin === 'LOCAL_MIC' ? 'Você' : 'Participante'}</span>
              <time dateTime={turn.startedAt}>
                {new Date(turn.startedAt).toLocaleTimeString('pt-BR', {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit'
                })}
              </time>
            </header>
            <p>{turn.text}</p>
          </article>
        ))}
      </div>
    </div>
  );
}

export function LiveCallsView() {
  const [capabilities, setCapabilities] = useState<LiveCallRuntimeCapabilities | null>(null);
  const [candidate, setCandidate] = useState<MeetingCandidateDto | null>(null);
  const [manualStart, setManualStart] = useState(false);
  const [manualProvider, setManualProvider] = useState<ManualMeetingProvider>('MEET');
  const [detectionFailed, setDetectionFailed] = useState(false);
  const [session, setSession] = useState<LiveCallDetailDto | null>(null);
  const [conversations, setConversations] = useState<ConversationSummaryDto[]>([]);
  const [conversationId, setConversationId] = useState('');
  const [microphones, setMicrophones] = useState<MicrophoneDevice[]>([]);
  const [microphoneId, setMicrophoneId] = useState('');
  const [systemSources, setSystemSources] = useState<SystemAudioSourceDto[]>([]);
  const [systemSourceId, setSystemSourceId] = useState('');
  const [consentOpen, setConsentOpen] = useState(false);
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [transcriptionConsentAccepted, setTranscriptionConsentAccepted] = useState(false);
  const [transcriptionCapability, setTranscriptionCapability] =
    useState<LiveTranscriptionCapabilityDto | null>(null);
  const [transcriptionStatus, setTranscriptionStatus] = useState<LiveTranscriptionStatusDto | null>(
    null
  );
  const [transcriptTurns, setTranscriptTurns] = useState<LiveTranscriptTurnDto[]>([]);
  const [metrics, setMetrics] = useState<DualCaptureSnapshot | null>(null);
  const [compact, setCompact] = useState(false);
  const [alwaysOnTop, setAlwaysOnTop] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ignoredCandidates = useRef(new Set<string>());
  const capture = useRef<DualAudioCaptureController | null>(null);
  const activeSessionId = useRef<string | null>(null);
  const captureStarting = useRef(false);
  const ending = useRef(false);
  const callIntent: LiveCallIntent | null = candidate
    ? { kind: 'DETECTED', candidate }
    : manualStart
      ? { kind: 'MANUAL', provider: manualProvider }
      : null;

  useEffect(() => {
    let cancelled = false;
    async function initialize(): Promise<void> {
      try {
        const runtime = await window.morubi.liveCalls.getRuntimeCapabilities();
        if (cancelled) return;
        setCapabilities(runtime);
      } catch {
        if (!cancelled)
          setError(
            'O módulo local de Calls não iniciou. Feche e abra o Morubi para tentar novamente.'
          );
        return;
      }

      try {
        const [current, page, realtimeCapability] = await Promise.all([
          window.morubi.liveCalls.getCurrent(),
          window.morubi.commercial.listConversations().catch(() => ({ items: [] })),
          window.morubi.liveCalls.getTranscriptionCapability()
        ]);
        if (cancelled) return;
        const eligible = page.items.filter((item) => item.dealId);
        setConversations(eligible);
        setConversationId(eligible[0]?.id ?? '');
        setTranscriptionCapability(realtimeCapability);
        if (current.session && !['ENDED', 'FAILED', 'CANCELLED'].includes(current.session.status)) {
          await window.morubi.liveCalls.end(current.session.id);
          if (!cancelled)
            setError('Uma sessão interrompida anteriormente foi encerrada sem retomar a captura.');
        } else if (!cancelled) {
          setSession(current.session);
          setTranscriptTurns(current.session?.turns ?? []);
        }
      } catch (caught) {
        if (!cancelled) setError(errorMessage(caught));
      }
    }
    void initialize();
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    const unsubscribeStop = window.morubi.liveCalls.onCaptureStopRequested(() => {
      void capture.current?.stop();
    });
    const unsubscribeTranscript = window.morubi.liveCalls.onTranscriptTurn((turn) => {
      setTranscriptTurns((current) => {
        const withoutCurrent = current.filter(
          (candidate) => candidate.clientTurnId !== turn.clientTurnId
        );
        return [...withoutCurrent, turn]
          .sort(
            (left, right) =>
              new Date(left.startedAt).getTime() - new Date(right.startedAt).getTime() ||
              left.sequence - right.sequence
          )
          .slice(-200);
      });
    });
    const unsubscribeTranscriptionStatus = window.morubi.liveCalls.onTranscriptionStatus((status) =>
      setTranscriptionStatus(status)
    );
    const stopBeforeUnload = () => void capture.current?.stop();
    window.addEventListener('beforeunload', stopBeforeUnload);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      unsubscribeStop();
      unsubscribeTranscript();
      unsubscribeTranscriptionStatus();
      window.removeEventListener('beforeunload', stopBeforeUnload);
      const sessionId = activeSessionId.current;
      void capture.current?.stop();
      void window.morubi.liveCalls.stopTranscription();
      capture.current = null;
      activeSessionId.current = null;
      if (sessionId) void window.morubi.liveCalls.end(sessionId).catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    if (!shouldPollMeetingDetection(capabilities, session?.status === 'ACTIVE')) return;
    const observationIntervalMs = capabilities?.observationIntervalMs ?? 3_000;
    let stopped = false;
    async function observe(): Promise<void> {
      try {
        const candidates = await window.morubi.liveCalls.observeMeetings();
        if (stopped) return;
        setDetectionFailed(false);
        if (manualStart || consentOpen) return;
        const detected = candidates.find((item) => !ignoredCandidates.current.has(item.id)) ?? null;
        setCandidate(detected);
      } catch {
        if (!stopped) setDetectionFailed(true);
      }
    }
    void observe();
    const timer = window.setInterval(() => void observe(), observationIntervalMs);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [capabilities, consentOpen, manualStart, session?.status]);

  useEffect(() => {
    if (session?.status !== 'ACTIVE' || !capture.current) return;
    const heartbeat = window.setInterval(() => {
      const controller = capture.current;
      if (!controller) return;
      void window.morubi.liveCalls
        .heartbeat(session.id, controller.heartbeat())
        .catch(() =>
          setError('Heartbeat indisponível; a captura local continua limitada em memória.')
        );
    }, 10_000);
    return () => window.clearInterval(heartbeat);
  }, [session?.id, session?.status]);

  useEffect(() => {
    document.body.classList.toggle('live-compact-mode', compact);
    void window.morubi.liveCalls.setCompactMode({ compact, alwaysOnTop: compact && alwaysOnTop });
    return () => document.body.classList.remove('live-compact-mode');
  }, [compact, alwaysOnTop]);

  async function loadCaptureOptions(): Promise<void> {
    if (!capabilities?.audioCapture.enabled) {
      setError('A captura de áudio não está disponível neste ambiente.');
      return;
    }
    setPending(true);
    setError(null);
    setTranscriptTurns([]);
    try {
      const [audioInputs, sources] = await Promise.all([
        enumerateMicrophones(),
        window.morubi.liveCalls.listSystemAudioSources()
      ]);
      setMicrophones(audioInputs);
      const preferredSources =
        capabilities?.platform === 'win32'
          ? sources.filter((source) => source.kind === 'SCREEN')
          : sources.filter(
              (source) => source.kind === 'NATIVE' || source.kind === 'VIRTUAL_DEVICE'
            );
      const availableSources = preferredSources.length ? preferredSources : sources;
      setSystemSources(availableSources);
      setSystemSourceId(availableSources.length === 1 ? (availableSources[0]?.id ?? '') : '');
      setConsentOpen(true);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  }

  async function beginCapture(): Promise<void> {
    if (!callIntent || !capabilities) return;
    if (!consentAccepted) {
      setError('Confirme o consentimento antes de iniciar.');
      return;
    }
    if (!systemSourceId) {
      setError(
        capabilities.platform === 'darwin'
          ? 'Selecione explicitamente a fonte de áudio da reunião.'
          : 'Selecione explicitamente onde a reunião está sendo reproduzida.'
      );
      return;
    }
    if (captureStarting.current || capture.current || activeSessionId.current) {
      setError('Já existe uma captura em andamento.');
      return;
    }
    captureStarting.current = true;
    setPending(true);
    setError(null);
    let createdSessionId: string | null = null;
    try {
      const created = await window.morubi.liveCalls.create(
        createLiveCallRequest(callIntent, conversationId)
      );
      if (['STARTING', 'ACTIVE', 'ENDING'].includes(created.status))
        throw new Error('LIVE_CAPTURE_ALREADY_ACTIVE');
      createdSessionId = created.id;
      await window.morubi.liveCalls.start(created.id, {
        consentConfirmed: true,
        consentMode: 'MANUAL_CONFIRMATION',
        policyVersion:
          transcriptionCapability?.enabled && transcriptionConsentAccepted
            ? 'live-transcription-consent-v1'
            : 'live-capture-consent-v2',
        captureMode: 'MIXED',
        transcriptionMode:
          transcriptionCapability?.enabled && transcriptionConsentAccepted
            ? 'REALTIME'
            : 'DISABLED',
        captureSources: ['LOCAL_MIC', 'SYSTEM_AUDIO']
      });
      activeSessionId.current = created.id;
      const realtimeEnabled = Boolean(
        transcriptionCapability?.enabled && transcriptionConsentAccepted
      );
      if (realtimeEnabled) await window.morubi.liveCalls.startTranscription(created.id);
      const controllerHolder: { current: DualAudioCaptureController | null } = { current: null };
      const providerEvents = {
        changed: () => {
          if (controllerHolder.current) setMetrics(controllerHolder.current.snapshot());
        },
        failed: (captureFailure: Error) => {
          controllerHolder.current?.handleProviderFailure(captureFailure);
        }
      };
      const platform = capabilities.platform === 'darwin' ? 'MACOS' : 'WINDOWS';
      const microphone = new MediaDevicesMicrophoneCaptureProvider(
        platform,
        created.id,
        microphoneId || null,
        providerEvents
      );
      const systemAudio =
        capabilities.audioCapture.systemAudioMethod === 'MACOS_SCREEN_CAPTURE_KIT'
          ? new MacOSNativeSystemAudioCaptureProvider(created.id, systemSourceId, providerEvents)
          : capabilities.audioCapture.systemAudioMethod === 'MACOS_BLACKHOLE_2CH' ||
              capabilities.audioCapture.systemAudioMethod === 'MACOS_VIRTUAL_DEVICE_REQUIRED'
            ? new MacOSBlackHoleSystemAudioCaptureProvider(
                created.id,
                systemSourceId,
                providerEvents
              )
            : new WindowsSystemAudioCaptureProvider(created.id, systemSourceId, providerEvents);
      const controller = new DualAudioCaptureController(
        microphone,
        systemAudio,
        capabilities.maxBufferBytes,
        setMetrics,
        (captureFailure) => {
          setError(errorMessage(captureFailure));
          void endCapture();
        },
        realtimeEnabled
          ? (chunk) => {
              if (chunk.source !== 'LOCAL_MIC' && chunk.source !== 'SYSTEM_AUDIO')
                return Promise.reject(new Error('LIVE_AUDIO_SOURCE_INVALID'));
              return window.morubi.liveCalls.sendAudioChunk({
                sequence: chunk.sequence,
                capturedAt: chunk.capturedAt.toISOString(),
                durationMs: chunk.durationMs,
                mimeType: 'audio/pcm;rate=16000',
                source: chunk.source,
                data: chunk.data
              });
            }
          : undefined,
        () =>
          setTranscriptionStatus((current) => ({
            state: 'UNSTABLE',
            reconnects: current?.reconnects ?? 0,
            droppedChunks: current?.droppedChunks ?? 0,
            gapDetected: true,
            message: 'Reconectando a transcrição…'
          }))
      );
      controllerHolder.current = controller;
      capture.current = controller;
      await controller.start();
      const detail = await window.morubi.liveCalls.get(created.id);
      setSession(detail);
      setConsentOpen(false);
      setManualStart(false);
      setCandidate(null);
    } catch (caught) {
      await capture.current?.stop().catch(() => undefined);
      await window.morubi.liveCalls.stopTranscription().catch(() => undefined);
      capture.current = null;
      activeSessionId.current = null;
      if (createdSessionId)
        await window.morubi.liveCalls.end(createdSessionId).catch(() => undefined);
      setError(errorMessage(caught));
    } finally {
      captureStarting.current = false;
      setPending(false);
    }
  }

  async function endCapture(): Promise<void> {
    const sessionId = activeSessionId.current ?? session?.id ?? null;
    if (!sessionId || ending.current) return;
    ending.current = true;
    try {
      await capture.current?.stop();
      capture.current = null;
      await window.morubi.liveCalls.stopTranscription();
      const ended = await window.morubi.liveCalls.end(sessionId);
      setSession((current) => (current ? { ...current, ...ended } : null));
      setMetrics(null);
      setTranscriptionStatus(null);
      activeSessionId.current = null;
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      ending.current = false;
    }
  }

  function ignoreCandidate(): void {
    if (candidate) ignoredCandidates.current.add(candidate.id);
    setCandidate(null);
    setConsentOpen(false);
    setConsentAccepted(false);
    setTranscriptionConsentAccepted(false);
  }

  function cancelConsent(): void {
    setConsentOpen(false);
    setConsentAccepted(false);
    setTranscriptionConsentAccepted(false);
    if (manualStart) setManualStart(false);
  }

  function startManualCall(): void {
    setCandidate(null);
    setManualStart(true);
    setConsentAccepted(false);
    void loadCaptureOptions();
  }

  async function simulateDetection(): Promise<void> {
    if (!conversationId) return;
    setPending(true);
    try {
      await window.morubi.liveCalls.simulate({
        action: 'DETECT',
        meetingProvider: 'MEET',
        conversationId
      });
      const current = await window.morubi.liveCalls.getCurrent();
      setSession(current.session);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  }

  if (compact && session?.status === 'ACTIVE') {
    return (
      <section className="live-compact" aria-label="Captura compacta">
        <header>
          <span className="live-listening-dot" />
          <div>
            <strong>
              {session.transcriptionMode === 'REALTIME'
                ? transcriptionStatusLabel(transcriptionStatus)
                : 'Captura local ativa'}
            </strong>
            <small>{durationLabel(session.startedAt, session.endedAt, now)}</small>
          </div>
          <button aria-label="Expandir" onClick={() => setCompact(false)}>
            <Expand size={15} />
          </button>
        </header>
        <CaptureMetrics metrics={metrics} />
        <footer>
          <button onClick={() => void endCapture()}>Encerrar captura</button>
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

  if (session?.status === 'ENDED') {
    return (
      <section className="live-calls live-ended">
        <CircleStop size={32} />
        <span className="morubi-eyebrow">Captura encerrada</span>
        <h1>{durationLabel(session.startedAt, session.endedAt, now)}</h1>
        <p>
          {session.transcriptionMode === 'REALTIME'
            ? 'A transcrição foi encerrada e o áudio bruto não foi persistido.'
            : 'Nenhum áudio foi enviado ao backend ou persistido em disco.'}
        </p>
        {session.transcriptionMode === 'REALTIME' ? (
          <LiveTranscript turns={transcriptTurns} />
        ) : null}
        <Button variant="secondary" onClick={() => setSession(null)}>
          Voltar para Calls
        </Button>
        {error ? <div className="desktop-error">{error}</div> : null}
      </section>
    );
  }

  if (session?.status === 'ACTIVE') {
    return (
      <section className="live-calls live-active">
        <header className="live-call-header">
          <div>
            <span className="live-active-label">
              <i /> Captura autorizada em andamento
            </span>
            <h1>{session.meetingTitle ?? meetingProviderLabel(session.meetingProvider)}</h1>
            <p>
              Seu microfone e o áudio dos participantes permanecem separados. O áudio bruto não é
              armazenado.
            </p>
          </div>
          <div className="live-header-meta">
            <strong>{durationLabel(session.startedAt, session.endedAt, now)}</strong>
            <span>
              {session.transcriptionMode === 'REALTIME'
                ? transcriptionStatusLabel(transcriptionStatus)
                : 'SOMENTE CAPTURA'}
            </span>
            <button onClick={() => setCompact(true)}>
              <Minimize2 size={14} /> Modo compacto
            </button>
          </div>
        </header>
        <CaptureMetrics metrics={metrics} />
        {session.transcriptionMode === 'REALTIME' ? (
          <>
            {transcriptionStatus?.gapDetected ? (
              <div className="desktop-error live-error">
                A conexão ficou instável e pode haver uma pequena lacuna na transcrição.
              </div>
            ) : null}
            <LiveTranscript turns={transcriptTurns} />
          </>
        ) : null}
        <div className="live-capture-notice">
          <ShieldCheck size={18} />
          <span>
            {session.transcriptionMode === 'REALTIME'
              ? 'Transcrição autorizada ativa. O áudio é processado em tempo real e não é armazenado.'
              : 'Captura local ativa. Nenhum byte de áudio é transmitido.'}
          </span>
        </div>
        <Button variant="secondary" disabled={pending} onClick={() => void endCapture()}>
          <CircleStop size={15} /> Encerrar captura
        </Button>
        {error ? <div className="desktop-error live-error">{error}</div> : null}
      </section>
    );
  }

  if (consentOpen && callIntent) {
    return (
      <section className="live-calls live-detected live-consent-panel">
        <span className="morubi-eyebrow">Consentimento obrigatório</span>
        <h1>Autorizar duas fontes de áudio</h1>
        {callIntent.kind === 'MANUAL' ? (
          <div className="live-consent-source">
            <Video size={20} />
            <div>
              <strong>Plataforma da reunião</strong>
              <select
                value={manualProvider}
                onChange={(event) => setManualProvider(event.target.value as ManualMeetingProvider)}
              >
                {manualMeetingProviders.map((provider) => (
                  <option key={provider} value={provider}>
                    {meetingProviderLabel(provider)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ) : null}
        <div className="live-consent-source">
          <Mic size={20} />
          <div>
            <strong>Microfone local</strong>
            <select value={microphoneId} onChange={(event) => setMicrophoneId(event.target.value)}>
              <option value="">Padrão do sistema</option>
              {microphones.map((device) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="live-consent-source">
          <MonitorSpeaker size={20} />
          <div>
            <strong>Áudio da reunião</strong>
            <select
              required
              value={systemSourceId}
              onChange={(event) => setSystemSourceId(event.target.value)}
            >
              <option value="">
                {capabilities?.platform === 'darwin'
                  ? 'Selecione a fonte da reunião'
                  : 'Selecione onde a reunião está'}
              </option>
              {systemSources.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.name}
                </option>
              ))}
            </select>
            {capabilities?.platform === 'darwin' ? (
              <small>
                O Morubi usará somente a fonte de áudio selecionada e não altera sua saída sem
                confirmação.
              </small>
            ) : (
              <small>
                A fonte pode incluir sons de outros aplicativos. O conteúdo visual não será lido nem
                armazenado.
              </small>
            )}
          </div>
        </div>
        <label className="live-consent-check">
          <input
            type="checkbox"
            checked={consentAccepted}
            onChange={(event) => setConsentAccepted(event.target.checked)}
          />
          <span>
            Autorizo a captura local dessas fontes. Confirmarei também as permissões do sistema
            operacional e sou responsável por observar as regras aplicáveis aos demais
            participantes.
          </span>
        </label>
        {transcriptionCapability?.enabled ? (
          <label className="live-consent-check">
            <input
              type="checkbox"
              checked={transcriptionConsentAccepted}
              onChange={(event) => setTranscriptionConsentAccepted(event.target.checked)}
            />
            <span>
              Autorizo o envio temporário das duas fontes para transcrição por um serviço externo
              seguro. O texto final poderá ser salvo conforme a política da organização; o áudio
              bruto não será armazenado.
            </span>
          </label>
        ) : (
          <div className="live-capture-notice">
            <ShieldCheck size={18} />
            <span>
              A transcrição ao vivo ainda não está configurada. A captura local continua disponível
              sem envio de áudio.
            </span>
          </div>
        )}
        <div className="live-consent-actions">
          <Button variant="ghost" disabled={pending} onClick={cancelConsent}>
            Cancelar
          </Button>
          <Button
            disabled={pending || !consentAccepted || !systemSourceId}
            onClick={() => void beginCapture()}
          >
            <Play size={15} /> {pending ? 'Iniciando…' : 'Autorizar e iniciar'}
          </Button>
          {capabilities?.platform === 'darwin' && systemSources.length === 0 ? (
            <Button variant="ghost" disabled={pending} onClick={() => void loadCaptureOptions()}>
              Atualizar dispositivos
            </Button>
          ) : null}
        </div>
        {error ? <div className="desktop-error">{error}</div> : null}
      </section>
    );
  }

  if (candidate) {
    return (
      <section className="live-calls live-detected">
        <span className="morubi-eyebrow">Possível reunião detectada</span>
        <div className="live-provider-mark">
          <Video size={22} />
          <div>
            <h1>Google Meet no {candidate.applicationName}</h1>
            <p>{candidate.windowTitle}</p>
          </div>
        </div>
        <div className="live-consent-copy">
          <ShieldCheck size={20} />
          <p>
            A evidência vem apenas do título e do processo da janela. Confirme manualmente: nenhuma
            URL ou conteúdo da reunião foi lido e nenhuma captura começou.
          </p>
        </div>
        <div className="live-consent-actions">
          <Button variant="ghost" disabled={pending} onClick={ignoreCandidate}>
            Ignorar
          </Button>
          <Button disabled={pending} onClick={() => void loadCaptureOptions()}>
            <Play size={15} /> Iniciar copiloto
          </Button>
        </div>
        {error ? <div className="desktop-error">{error}</div> : null}
      </section>
    );
  }

  return (
    <section className="live-calls live-calls--waiting">
      <div className="live-waiting-orb">
        <Radio size={28} />
      </div>
      <span className="morubi-eyebrow">Live Calls</span>
      <h1>Aguardando uma call</h1>
      <p>
        {!capabilities
          ? 'Verificando os recursos locais de Calls…'
          : !capabilities.liveCallSession.enabled || !capabilities.audioCapture.enabled
            ? 'As Calls foram desativadas na configuração deste aplicativo.'
            : capabilities.meetingDetection.available && !detectionFailed
              ? `A detecção automática acompanha reuniões abertas no navegador${capabilities.platform === 'win32' ? ' Chrome ou Edge' : ''}. A captura nunca inicia sem confirmação.`
              : 'Você pode iniciar o copiloto manualmente. A captura só começa após sua confirmação.'}
      </p>
      {capabilities?.liveCallSession.manualStartSupported && capabilities.audioCapture.enabled ? (
        <Button disabled={pending} onClick={startManualCall}>
          <Play size={15} /> Iniciar copiloto
        </Button>
      ) : null}
      {capabilities?.simulatorEnabled ? (
        <div className="live-dev-panel">
          <label className="live-conversation-picker">
            Contexto exclusivo do simulador de desenvolvimento
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
          <Button disabled={pending || !conversationId} onClick={() => void simulateDetection()}>
            <Video size={15} /> Simular detecção
          </Button>
        </div>
      ) : null}
      {error ? <div className="desktop-error">{error}</div> : null}
    </section>
  );
}
