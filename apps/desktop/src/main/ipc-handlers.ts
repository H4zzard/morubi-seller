import { app, ipcMain, Notification, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
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
  uuidSchema
} from '@morubi/validation';
import { ipcChannels } from '../shared/ipc.js';
import type { DesktopApiClient } from './desktop-api-client.js';
import type { DesktopRealtimeClient } from './realtime-client.js';

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
  authorizeMicrophone: () => Promise<string>
): void {
  let regularBounds = window.getBounds();
  ipcMain.handle(ipcChannels.systemGetVersion, (event) => {
    assertTrustedSender(event, window);
    return app.getVersion();
  });
  ipcMain.handle(ipcChannels.systemGetPlatform, (event) => {
    assertTrustedSender(event, window);
    return process.platform;
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
    return api.startLiveCall(uuidSchema.parse(sessionId), startLiveCallSchema.parse(value));
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
    return api.endLiveCall(uuidSchema.parse(value));
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
    await api.simulateLiveCall(devLiveCallScenarioSchema.parse(value));
  });
  ipcMain.handle(ipcChannels.liveCallsAuthorizeMicrophone, async (event) => {
    assertTrustedSender(event, window);
    return { authorizedUntil: await authorizeMicrophone() };
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
}
