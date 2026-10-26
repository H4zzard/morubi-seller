import { app, ipcMain, Notification, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { arch, release } from 'node:os';
import {
  conversationMessagesRequestSchema,
  createLiveCallSchema,
  devLiveCallScenarioSchema,
  interventionFeedbackSchema,
  liveCallHeartbeatSchema,
  liveCallWindowModeSchema,
  liveTranscriptTurnSchema,
  notificationSchema,
  signInSchema,
  startLiveCallSchema,
  systemAudioAuthorizationSchema,
  uuidSchema
} from '@morubi/validation';
import {
  ipcChannels,
  type LiveCallRuntimeCapabilities,
  type MeetingCandidateDto,
  type NativeSystemAudioChunkDto,
  type SystemAudioSourceDto
} from '../shared/ipc.js';
import type { DesktopApiClient } from './desktop-api-client.js';
import type { DesktopRealtimeClient } from './realtime-client.js';
import type { LiveAudioTransportClient } from './live-audio-transport.js';
import { liveAudioMimeType, type LiveAudioChunk } from '@morubi/live-calls';

function assertTrustedSender(event: IpcMainInvokeEvent, window: BrowserWindow): void {
  const url = event.senderFrame?.url ?? '';
  const trustedUrl =
    url.startsWith('morubi-app://app/') ||
    (!app.isPackaged && url.startsWith('http://localhost:5173/'));
  if (event.sender.id !== window.webContents.id || !trustedUrl)
    throw new Error('Untrusted IPC sender');
}

export function registerIpcHandlers(
  window: BrowserWindow,
  api: DesktopApiClient,
  realtime: DesktopRealtimeClient,
  audioTransport: LiveAudioTransportClient,
  liveRuntime: {
    getCapabilities(): LiveCallRuntimeCapabilities;
    requestMeetingObservationPermission(): Promise<LiveCallRuntimeCapabilities>;
    observeMeetings(): Promise<MeetingCandidateDto[]>;
    listSystemAudioSources(): Promise<SystemAudioSourceDto[]>;
    activateSession(sessionId: string): void;
    clearSession(sessionId?: string): void;
    cleanup(options?: { notifyRenderer?: boolean }): Promise<void>;
    authorizeMicrophone(sessionId: string): Promise<string>;
    authorizeAudioDiagnostic(): Promise<string>;
    authorizeSystemAudioDiagnostic(sourceId: string): string;
    authorizeMacOSSystemAudio(sessionId: string): Promise<string>;
    authorizeSystemAudio(sessionId: string, sourceId: string): string;
    startNativeSystemAudio(sessionId: string): Promise<{
      method: 'MACOS_SCREEN_CAPTURE_KIT';
      deviceLabel: string;
    }>;
    stopNativeSystemAudio(sessionId: string): Promise<void>;
    onNativeSystemAudioChunk(listener: (chunk: NativeSystemAudioChunkDto) => void): () => void;
    onNativeSystemAudioFailure(
      listener: (failure: { sessionId: string; code: string }) => void
    ): () => void;
    setBackgroundObservationEnabled(enabled: boolean): void;
  }
): void {
  let regularBounds = window.getBounds();
  const removeNativeChunkListener = liveRuntime.onNativeSystemAudioChunk((chunk) => {
    if (!window.isDestroyed())
      window.webContents.send(ipcChannels.liveCallsNativeSystemAudioChunk, chunk);
  });
  const removeNativeFailureListener = liveRuntime.onNativeSystemAudioFailure((failure) => {
    if (!window.isDestroyed())
      window.webContents.send(ipcChannels.liveCallsNativeSystemAudioFailure, failure);
  });
  const removeTranscriptListener = audioTransport.onTranscript((turn) => {
    if (!window.isDestroyed()) window.webContents.send(ipcChannels.liveCallsTranscriptTurn, turn);
  });
  const removeTranscriptionStatusListener = audioTransport.onStatus((status) => {
    if (!window.isDestroyed())
      window.webContents.send(ipcChannels.liveCallsTranscriptionStatus, status);
  });
  window.once('closed', () => {
    removeNativeChunkListener();
    removeNativeFailureListener();
    removeTranscriptListener();
    removeTranscriptionStatusListener();
  });
  ipcMain.handle(ipcChannels.systemGetVersion, (event) => {
    assertTrustedSender(event, window);
    return app.getVersion();
  });
  ipcMain.handle(ipcChannels.systemGetPlatform, (event) => {
    assertTrustedSender(event, window);
    return process.platform;
  });
  ipcMain.handle(ipcChannels.systemGetOSVersion, (event) => {
    assertTrustedSender(event, window);
    return { version: release(), architecture: arch() };
  });
  ipcMain.handle(ipcChannels.authSignIn, async (event, value: unknown) => {
    assertTrustedSender(event, window);
    return api.signIn(signInSchema.parse(value));
  });
  ipcMain.handle(ipcChannels.authGetSession, async (event) => {
    assertTrustedSender(event, window);
    return api.getSession();
  });
  ipcMain.handle(ipcChannels.authSignOut, async (event) => {
    assertTrustedSender(event, window);
    await audioTransport.stop();
    await liveRuntime.cleanup();
    await api.signOut();
  });
  ipcMain.handle(ipcChannels.authListOrganizations, async (event) => {
    assertTrustedSender(event, window);
    return api.listOrganizations();
  });
  ipcMain.handle(ipcChannels.authSetOrganization, async (event, value: unknown) => {
    assertTrustedSender(event, window);
    return api.setOrganization(uuidSchema.parse(value));
  });
  ipcMain.handle(ipcChannels.commercialListContacts, async (event, value: unknown) => {
    assertTrustedSender(event, window);
    return api.listContacts(typeof value === 'string' ? value : undefined);
  });
  ipcMain.handle(ipcChannels.commercialGetContact, async (event, value: unknown) => {
    assertTrustedSender(event, window);
    return api.getContact(uuidSchema.parse(value));
  });
  ipcMain.handle(ipcChannels.commercialListDeals, async (event, value: unknown) => {
    assertTrustedSender(event, window);
    return api.listDeals(typeof value === 'string' ? value : undefined);
  });
  ipcMain.handle(ipcChannels.commercialGetDeal, async (event, value: unknown) => {
    assertTrustedSender(event, window);
    return api.getDeal(uuidSchema.parse(value));
  });
  ipcMain.handle(ipcChannels.commercialListConversations, async (event, value: unknown) => {
    assertTrustedSender(event, window);
    return api.listConversations(typeof value === 'string' ? value : undefined);
  });
  ipcMain.handle(ipcChannels.commercialListMessages, async (event, value: unknown) => {
    assertTrustedSender(event, window);
    const input = conversationMessagesRequestSchema.parse(value);
    return api.listMessages(input.conversationId, input.cursor);
  });
  ipcMain.handle(ipcChannels.commercialMarkConversationRead, async (event, value: unknown) => {
    assertTrustedSender(event, window);
    await api.markConversationRead(uuidSchema.parse(value));
  });
  ipcMain.handle(ipcChannels.commercialGetConversationContext, async (event, value: unknown) => {
    assertTrustedSender(event, window);
    return api.getConversationContext(uuidSchema.parse(value));
  });
  ipcMain.handle(ipcChannels.commercialGetMessageAudio, async (event, value: unknown) => {
    assertTrustedSender(event, window);
    return api.getMessageAudio(uuidSchema.parse(value));
  });
  ipcMain.handle(ipcChannels.interventionViewed, async (event, value: unknown) => {
    assertTrustedSender(event, window);
    return api.viewed(uuidSchema.parse(value));
  });
  ipcMain.handle(ipcChannels.interventionDismiss, async (event, value: unknown) => {
    assertTrustedSender(event, window);
    return api.dismiss(uuidSchema.parse(value));
  });
  ipcMain.handle(ipcChannels.interventionApplied, async (event, value: unknown) => {
    assertTrustedSender(event, window);
    return api.applied(uuidSchema.parse(value));
  });
  ipcMain.handle(
    ipcChannels.interventionFeedback,
    async (event, deliveryId: unknown, input: unknown) => {
      assertTrustedSender(event, window);
      await api.feedback(uuidSchema.parse(deliveryId), interventionFeedbackSchema.parse(input));
    }
  );
  ipcMain.handle(ipcChannels.realtimeStart, (event) => {
    assertTrustedSender(event, window);
    realtime.start();
  });
  ipcMain.handle(ipcChannels.realtimeStop, (event) => {
    assertTrustedSender(event, window);
    realtime.stop();
  });
  ipcMain.handle(ipcChannels.notificationsShow, (event, value: unknown) => {
    assertTrustedSender(event, window);
    const notification = notificationSchema.parse(value);
    if (Notification.isSupported()) new Notification(notification).show();
  });
  ipcMain.handle(ipcChannels.liveCallsGetCurrent, async (event) => {
    assertTrustedSender(event, window);
    return api.getCurrentLiveCall();
  });
  ipcMain.handle(ipcChannels.liveCallsCreate, async (event, value: unknown) => {
    assertTrustedSender(event, window);
    return api.createLiveCall(createLiveCallSchema.parse(value));
  });
  ipcMain.handle(ipcChannels.liveCallsGet, async (event, value: unknown) => {
    assertTrustedSender(event, window);
    return api.getLiveCall(uuidSchema.parse(value));
  });
  ipcMain.handle(ipcChannels.liveCallsStart, async (event, sessionId: unknown, value: unknown) => {
    assertTrustedSender(event, window);
    const id = uuidSchema.parse(sessionId);
    const input = startLiveCallSchema.parse(value);
    if (
      input.captureMode !== 'FIXTURE' &&
      (!liveRuntime.getCapabilities().liveCallSession.enabled ||
        !liveRuntime.getCapabilities().audioCapture.enabled)
    )
      throw new Error('LIVE_CAPTURE_DISABLED');
    const started = await api.startLiveCall(id, input);
    if (input.captureMode !== 'FIXTURE') liveRuntime.activateSession(started.id);
    return started;
  });
  ipcMain.handle(
    ipcChannels.liveCallsHeartbeat,
    async (event, sessionId: unknown, value: unknown) => {
      assertTrustedSender(event, window);
      return api.sendLiveCallHeartbeat(
        uuidSchema.parse(sessionId),
        liveCallHeartbeatSchema.parse(value)
      );
    }
  );
  ipcMain.handle(
    ipcChannels.liveCallsSendTurn,
    async (event, sessionId: unknown, value: unknown) => {
      assertTrustedSender(event, window);
      return api.sendLiveCallTurn(
        uuidSchema.parse(sessionId),
        liveTranscriptTurnSchema.parse(value)
      );
    }
  );
  ipcMain.handle(ipcChannels.liveCallsEnd, async (event, value: unknown) => {
    assertTrustedSender(event, window);
    const sessionId = uuidSchema.parse(value);
    window.webContents.send(ipcChannels.liveCallsCaptureStopRequested);
    try {
      await audioTransport.stop();
      return await api.endLiveCall(sessionId);
    } finally {
      liveRuntime.clearSession(sessionId);
    }
  });
  ipcMain.handle(ipcChannels.liveCallsGetReport, async (event, value: unknown) => {
    assertTrustedSender(event, window);
    return api.getCallReport(uuidSchema.parse(value));
  });
  ipcMain.handle(ipcChannels.liveCallsRetryReport, async (event, value: unknown) => {
    assertTrustedSender(event, window);
    return api.retryCallReport(uuidSchema.parse(value));
  });
  ipcMain.handle(ipcChannels.liveCallsGetTranscript, async (event, value: unknown) => {
    assertTrustedSender(event, window);
    return api.getCallTranscript(uuidSchema.parse(value));
  });
  ipcMain.handle(ipcChannels.liveCallsSimulate, async (event, value: unknown) => {
    assertTrustedSender(event, window);
    if (!liveRuntime.getCapabilities().simulatorEnabled) throw new Error('LIVE_SIMULATOR_DISABLED');
    await api.simulateLiveCall(devLiveCallScenarioSchema.parse(value));
  });
  ipcMain.handle(ipcChannels.liveCallsGetRuntimeCapabilities, (event) => {
    assertTrustedSender(event, window);
    return liveRuntime.getCapabilities();
  });
  ipcMain.handle(ipcChannels.liveCallsRequestMeetingObservationPermission, (event) => {
    assertTrustedSender(event, window);
    return liveRuntime.requestMeetingObservationPermission();
  });
  ipcMain.handle(ipcChannels.liveCallsObserveMeetings, async (event) => {
    assertTrustedSender(event, window);
    if (!liveRuntime.getCapabilities().meetingDetection.available) return [];
    return liveRuntime.observeMeetings();
  });
  ipcMain.handle(ipcChannels.liveCallsSetBackgroundObservation, (event, value: unknown) => {
    assertTrustedSender(event, window);
    if (typeof value !== 'boolean') throw new Error('BACKGROUND_OBSERVATION_INVALID');
    liveRuntime.setBackgroundObservationEnabled(value);
  });
  ipcMain.handle(ipcChannels.liveCallsListSystemAudioSources, async (event) => {
    assertTrustedSender(event, window);
    if (!liveRuntime.getCapabilities().audioCapture.enabled)
      throw new Error('LIVE_CAPTURE_DISABLED');
    return liveRuntime.listSystemAudioSources();
  });
  ipcMain.handle(ipcChannels.liveCallsAuthorizeMicrophone, async (event, value: unknown) => {
    assertTrustedSender(event, window);
    return { authorizedUntil: await liveRuntime.authorizeMicrophone(uuidSchema.parse(value)) };
  });
  ipcMain.handle(ipcChannels.liveCallsAuthorizeAudioDiagnostic, async (event) => {
    assertTrustedSender(event, window);
    return { authorizedUntil: await liveRuntime.authorizeAudioDiagnostic() };
  });
  ipcMain.handle(ipcChannels.liveCallsAuthorizeSystemAudioDiagnostic, (event, value: unknown) => {
    assertTrustedSender(event, window);
    if (typeof value !== 'string' || !value.trim() || value.length > 512)
      throw new Error('DISPLAY_SOURCE_INVALID');
    return { authorizedUntil: liveRuntime.authorizeSystemAudioDiagnostic(value) };
  });
  ipcMain.handle(ipcChannels.liveCallsAuthorizeMacOSSystemAudio, async (event, value: unknown) => {
    assertTrustedSender(event, window);
    return {
      authorizedUntil: await liveRuntime.authorizeMacOSSystemAudio(uuidSchema.parse(value))
    };
  });
  ipcMain.handle(ipcChannels.liveCallsAuthorizeSystemAudio, (event, value: unknown) => {
    assertTrustedSender(event, window);
    const input = systemAudioAuthorizationSchema.parse(value);
    return {
      authorizedUntil: liveRuntime.authorizeSystemAudio(input.sessionId, input.sourceId)
    };
  });
  ipcMain.handle(ipcChannels.liveCallsStartNativeSystemAudio, async (event, value: unknown) => {
    assertTrustedSender(event, window);
    return liveRuntime.startNativeSystemAudio(uuidSchema.parse(value));
  });
  ipcMain.handle(ipcChannels.liveCallsStopNativeSystemAudio, async (event, value: unknown) => {
    assertTrustedSender(event, window);
    await liveRuntime.stopNativeSystemAudio(uuidSchema.parse(value));
  });
  ipcMain.handle(ipcChannels.liveCallsSetCompactMode, (event, value: unknown) => {
    assertTrustedSender(event, window);
    const input = liveCallWindowModeSchema.parse(value);
    if (input.compact) {
      regularBounds = window.getBounds();
      window.setAlwaysOnTop(input.alwaysOnTop, 'floating');
      window.setMinimumSize(380, 520);
      window.setBounds({ width: 430, height: 640 });
    } else {
      window.setAlwaysOnTop(false);
      window.setMinimumSize(1040, 680);
      window.setBounds(regularBounds);
    }
  });
  ipcMain.handle(ipcChannels.liveCallsGetTranscriptionCapability, async (event) => {
    assertTrustedSender(event, window);
    return api.getLiveTranscriptionCapability();
  });
  ipcMain.handle(ipcChannels.liveCallsStartTranscription, async (event, value: unknown) => {
    assertTrustedSender(event, window);
    await audioTransport.start(uuidSchema.parse(value));
  });
  ipcMain.handle(ipcChannels.liveCallsSendAudioChunk, async (event, value: unknown) => {
    assertTrustedSender(event, window);
    if (!value || typeof value !== 'object') throw new Error('LIVE_AUDIO_PACKET_INVALID');
    const candidate = value as Record<string, unknown>;
    if (
      (candidate.source !== 'LOCAL_MIC' && candidate.source !== 'SYSTEM_AUDIO') ||
      candidate.mimeType !== liveAudioMimeType ||
      !Number.isSafeInteger(candidate.sequence) ||
      typeof candidate.capturedAt !== 'string' ||
      !Number.isSafeInteger(candidate.durationMs) ||
      !(candidate.data instanceof Uint8Array)
    )
      throw new Error('LIVE_AUDIO_PACKET_INVALID');
    const capturedAt = new Date(candidate.capturedAt);
    if (!Number.isFinite(capturedAt.getTime())) throw new Error('LIVE_AUDIO_PACKET_INVALID');
    const sequence = Number(candidate.sequence);
    const durationMs = Number(candidate.durationMs);
    const chunk: LiveAudioChunk = {
      id: `${candidate.source}:${sequence}`,
      source: candidate.source,
      sequence,
      capturedAt,
      durationMs,
      mimeType: liveAudioMimeType,
      data: candidate.data
    };
    await audioTransport.send(chunk);
  });
  ipcMain.handle(ipcChannels.liveCallsStopTranscription, async (event) => {
    assertTrustedSender(event, window);
    await audioTransport.stop();
  });
}
