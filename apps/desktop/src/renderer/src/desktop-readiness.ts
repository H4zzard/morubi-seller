import type { LiveCallRuntimeCapabilities } from '../../shared/ipc';

export type ReadinessStatus = 'READY' | 'ACTION_REQUIRED' | 'BLOCKED';

export interface DesktopReadinessInput {
  authenticated: boolean;
  apiReachable: boolean;
  capabilities: LiveCallRuntimeCapabilities | null;
  microphoneCount: number;
  systemAudioSourceCount: number;
  microphoneSignal: boolean | null;
  systemAudioSignal: boolean | null;
}

export interface DesktopReadinessResult {
  status: ReadinessStatus;
  checks: Array<{ label: string; passed: boolean }>;
}

export function evaluateDesktopReadiness(input: DesktopReadinessInput): DesktopReadinessResult {
  const capabilities = input.capabilities;
  const supported = Boolean(
    capabilities?.liveCallSession.enabled &&
    capabilities.liveCallSession.manualStartSupported &&
    capabilities.audioCapture.enabled &&
    capabilities.audioCapture.microphoneSupported &&
    capabilities.audioCapture.systemAudioSupported
  );
  const microphonePermission =
    capabilities?.audioCapture.microphonePermission === 'granted' ||
    capabilities?.audioCapture.microphonePermission === 'not-applicable';
  const checks = [
    { label: 'Conta e API', passed: input.authenticated && input.apiReachable },
    { label: 'Recursos de call habilitados', passed: supported },
    { label: 'Permissão do microfone', passed: microphonePermission },
    { label: 'Microfone disponível', passed: input.microphoneCount > 0 },
    { label: 'Áudio da reunião disponível', passed: input.systemAudioSourceCount > 0 },
    { label: 'Sinal do microfone comprovado', passed: input.microphoneSignal === true },
    { label: 'Sinal da reunião comprovado', passed: input.systemAudioSignal === true }
  ];
  if (checks.every((check) => check.passed)) return { status: 'READY', checks };
  if (!input.authenticated || !input.apiReachable || !supported)
    return { status: 'BLOCKED', checks };
  return { status: 'ACTION_REQUIRED', checks };
}
