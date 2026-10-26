import { Check, ChevronRight, CircleAlert, Mic, MonitorSpeaker } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button, MorubiMark } from '@morubi/ui';
import type {
  LiveCallRuntimeCapabilities,
  OSRuntimeInfo,
  SystemAudioSourceDto
} from '../../shared/ipc';
import {
  runMicrophoneDiagnostic,
  runSystemAudioDiagnostic,
  type AudioDiagnosticResult
} from './audio-diagnostics';
import { evaluateDesktopReadiness } from './desktop-readiness';
import { enumerateMicrophones, type MicrophoneDevice } from './live-audio-capture';

type Step = 'WELCOME' | 'PERMISSIONS' | 'DIAGNOSTICS' | 'RESULT';

function diagnosticError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('PERMISSION_DENIED') || message.includes('NotAllowedError'))
    return 'A permissão foi negada. Você pode liberá-la nos ajustes de privacidade do sistema.';
  if (message.includes('SOURCE_NOT_FOUND'))
    return 'O componente necessário para ouvir a reunião não está disponível.';
  if (message.includes('TRACK_MISSING')) return 'A fonte escolhida não forneceu sinal de áudio.';
  return 'O teste não pôde ser concluído. Verifique o dispositivo e tente novamente.';
}

export function Onboarding({
  userName,
  onFinish
}: {
  userName: string;
  onFinish: (ready: boolean) => void;
}) {
  const [step, setStep] = useState<Step>('WELCOME');
  const [capabilities, setCapabilities] = useState<LiveCallRuntimeCapabilities | null>(null);
  const [os, setOS] = useState<OSRuntimeInfo | null>(null);
  const [microphones, setMicrophones] = useState<MicrophoneDevice[]>([]);
  const [systemSources, setSystemSources] = useState<SystemAudioSourceDto[]>([]);
  const [microphoneId, setMicrophoneId] = useState('');
  const [systemSourceId, setSystemSourceId] = useState('');
  const [microphoneResult, setMicrophoneResult] = useState<AudioDiagnosticResult | null>(null);
  const [systemResult, setSystemResult] = useState<AudioDiagnosticResult | null>(null);
  const [pending, setPending] = useState<'LOAD' | 'MIC' | 'SYSTEM' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadEnvironment(): Promise<void> {
    setPending('LOAD');
    setError(null);
    try {
      const [runtime, osInfo] = await Promise.all([
        window.morubi.liveCalls.getRuntimeCapabilities(),
        window.morubi.system.getOSVersion()
      ]);
      setCapabilities(runtime);
      setOS(osInfo);
      const [inputs, sources] = await Promise.all([
        enumerateMicrophones().catch(() => []),
        window.morubi.liveCalls.listSystemAudioSources().catch(() => [])
      ]);
      setMicrophones(inputs);
      setSystemSources(sources);
      setMicrophoneId(inputs[0]?.deviceId ?? '');
      setSystemSourceId(sources[0]?.id ?? '');
    } finally {
      setPending(null);
    }
  }

  useEffect(() => {
    if (step === 'PERMISSIONS') void loadEnvironment();
  }, [step]);

  async function testMicrophone(): Promise<void> {
    setPending('MIC');
    setError(null);
    setMicrophoneResult(null);
    try {
      const result = await runMicrophoneDiagnostic(microphoneId || null);
      setMicrophoneResult(result);
      setCapabilities(await window.morubi.liveCalls.getRuntimeCapabilities());
    } catch (caught) {
      setError(diagnosticError(caught));
    } finally {
      setPending(null);
    }
  }

  async function testSystemAudio(): Promise<void> {
    if (!capabilities || !systemSourceId) return;
    setPending('SYSTEM');
    setError(null);
    setSystemResult(null);
    try {
      setSystemResult(await runSystemAudioDiagnostic(capabilities.platform, systemSourceId));
    } catch (caught) {
      setError(diagnosticError(caught));
    } finally {
      setPending(null);
    }
  }

  const readiness = useMemo(
    () =>
      evaluateDesktopReadiness({
        authenticated: true,
        apiReachable: true,
        capabilities,
        microphoneCount: microphones.length,
        systemAudioSourceCount: systemSources.length,
        microphoneSignal: microphoneResult?.signalDetected ?? null,
        systemAudioSignal: systemResult?.signalDetected ?? null
      }),
    [capabilities, microphoneResult, microphones.length, systemResult, systemSources.length]
  );

  return (
    <main className="onboarding">
      <section className="onboarding__card">
        <div className="onboarding__brand">
          <MorubiMark />
          <span>Configuração inicial</span>
        </div>
        <div className="onboarding__steps" aria-label="Progresso da configuração">
          {(['WELCOME', 'PERMISSIONS', 'DIAGNOSTICS', 'RESULT'] as const).map((item, index) => (
            <i
              key={item}
              className={item === step ? 'active' : ''}
              aria-label={`Etapa ${index + 1}`}
            />
          ))}
        </div>

        {step === 'WELCOME' ? (
          <div className="onboarding__body">
            <span className="morubi-eyebrow">Olá, {userName}</span>
            <h1>Vamos preparar o Morubi para suas reuniões.</h1>
            <p>
              A configuração verifica permissões e áudio sem gravar, armazenar ou enviar o conteúdo
              dos testes.
            </p>
            <div className="onboarding__actions">
              <Button onClick={() => setStep('PERMISSIONS')}>
                Configurar agora <ChevronRight size={16} />
              </Button>
              <Button variant="secondary" onClick={() => onFinish(false)}>
                Fazer depois
              </Button>
            </div>
          </div>
        ) : null}

        {step === 'PERMISSIONS' ? (
          <div className="onboarding__body">
            <span className="morubi-eyebrow">Etapa 2 de 4</span>
            <h1>Permissões de áudio</h1>
            <p>O Morubi só acessa o áudio depois que você autoriza uma call.</p>
            <div className="onboarding__facts">
              <div>
                <Mic size={18} />
                <span>
                  <strong>Microfone</strong>
                  <small>A permissão será solicitada durante o teste</small>
                </span>
              </div>
              <div>
                <MonitorSpeaker size={18} />
                <span>
                  <strong>Áudio da reunião</strong>
                  <small>
                    {systemSources.length ? 'Fonte encontrada' : 'Fonte ainda não comprovada'}
                  </small>
                </span>
              </div>
            </div>
            {os ? (
              <small className="onboarding__meta">
                Sistema {os.version} · {os.architecture}
              </small>
            ) : null}
            {error ? <div className="desktop-error">{error}</div> : null}
            <div className="onboarding__actions">
              <Button disabled={pending !== null} onClick={() => setStep('DIAGNOSTICS')}>
                Continuar
              </Button>
            </div>
          </div>
        ) : null}

        {step === 'DIAGNOSTICS' ? (
          <div className="onboarding__body">
            <span className="morubi-eyebrow">Etapa 3 de 4</span>
            <h1>Teste rápido de áudio</h1>
            <p>
              Fale por alguns segundos e reproduza um som da reunião para comprovar as duas fontes.
            </p>
            <div className="onboarding__diagnostics">
              <label>
                Microfone
                <select
                  value={microphoneId}
                  onChange={(event) => setMicrophoneId(event.target.value)}
                >
                  {microphones.map((device) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label}
                    </option>
                  ))}
                </select>
                <Button
                  variant="secondary"
                  disabled={!microphones.length || pending !== null}
                  onClick={() => void testMicrophone()}
                >
                  {pending === 'MIC' ? 'Ouvindo…' : 'Testar microfone'}
                </Button>
                {microphoneResult ? (
                  <small className={microphoneResult.signalDetected ? 'passed' : 'failed'}>
                    {microphoneResult.signalDetected
                      ? 'Sinal comprovado'
                      : 'Nenhum sinal detectado'}
                  </small>
                ) : null}
              </label>
              <label>
                Áudio da reunião
                <select
                  value={systemSourceId}
                  onChange={(event) => setSystemSourceId(event.target.value)}
                  disabled={!systemSources.length}
                >
                  {systemSources.map((source) => (
                    <option key={source.id} value={source.id}>
                      {source.name}
                    </option>
                  ))}
                </select>
                <Button
                  variant="secondary"
                  disabled={!systemSources.length || pending !== null}
                  onClick={() => void testSystemAudio()}
                >
                  {pending === 'SYSTEM' ? 'Ouvindo…' : 'Testar áudio da reunião'}
                </Button>
                {systemResult ? (
                  <small className={systemResult.signalDetected ? 'passed' : 'failed'}>
                    {systemResult.signalDetected ? 'Sinal comprovado' : 'Nenhum sinal detectado'}
                  </small>
                ) : null}
              </label>
            </div>
            {!systemSources.length ? (
              <div className="onboarding__notice">
                <CircleAlert size={18} />
                <span>
                  O componente necessário para ouvir os outros participantes não está disponível
                  neste instalador. A captura não será marcada como pronta.
                </span>
              </div>
            ) : null}
            {error ? <div className="desktop-error">{error}</div> : null}
            <div className="onboarding__actions">
              <Button disabled={pending !== null} onClick={() => setStep('RESULT')}>
                Ver resultado
              </Button>
              <Button
                variant="secondary"
                disabled={pending !== null}
                onClick={() => void loadEnvironment()}
              >
                Verificar novamente
              </Button>
            </div>
          </div>
        ) : null}

        {step === 'RESULT' ? (
          <div className="onboarding__body">
            <span className="morubi-eyebrow">Etapa 4 de 4</span>
            <h1>
              {readiness.status === 'READY'
                ? 'Morubi pronto para calls'
                : 'Configuração requer atenção'}
            </h1>
            <p>
              {readiness.status === 'READY'
                ? 'Microfone e áudio da reunião foram comprovados neste dispositivo.'
                : 'Você pode usar o workspace, mas a captura só estará pronta quando todos os itens forem comprovados.'}
            </p>
            <div className="onboarding__checklist">
              {readiness.checks.map((check) => (
                <div key={check.label} className={check.passed ? 'passed' : 'failed'}>
                  {check.passed ? <Check size={16} /> : <CircleAlert size={16} />} {check.label}
                </div>
              ))}
            </div>
            <div className="onboarding__actions">
              <Button onClick={() => onFinish(readiness.status === 'READY')}>
                Continuar no Morubi
              </Button>
              {readiness.status !== 'READY' ? (
                <Button variant="secondary" onClick={() => setStep('DIAGNOSTICS')}>
                  Tentar novamente
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
      </section>
    </main>
  );
}
