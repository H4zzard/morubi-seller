import { contextBridge, ipcRenderer } from 'electron';
import type { MorubiBridge } from '../shared/ipc.js';
import { ipcChannels } from '../shared/ipc.js';

const bridge: MorubiBridge = {
  system: {
    getVersion: () => ipcRenderer.invoke(ipcChannels.systemGetVersion) as Promise<string>,
    getPlatform: () =>
      ipcRenderer.invoke(ipcChannels.systemGetPlatform) as ReturnType<
        MorubiBridge['system']['getPlatform']
      >
  },
  auth: {
    signIn: (input) =>
      ipcRenderer.invoke(ipcChannels.authSignIn, input) as ReturnType<
        MorubiBridge['auth']['signIn']
      >,
    getSession: () =>
      ipcRenderer.invoke(ipcChannels.authGetSession) as ReturnType<
        MorubiBridge['auth']['getSession']
      >,
    signOut: () =>
      ipcRenderer.invoke(ipcChannels.authSignOut) as ReturnType<MorubiBridge['auth']['signOut']>,
    listOrganizations: () =>
      ipcRenderer.invoke(ipcChannels.authListOrganizations) as ReturnType<
        MorubiBridge['auth']['listOrganizations']
      >,
    setOrganization: (organizationId) =>
      ipcRenderer.invoke(ipcChannels.authSetOrganization, organizationId) as ReturnType<
        MorubiBridge['auth']['setOrganization']
      >
  },
  commercial: {
    listContacts: (search) =>
      ipcRenderer.invoke(ipcChannels.commercialListContacts, search) as ReturnType<
        MorubiBridge['commercial']['listContacts']
      >,
    getContact: (contactId) =>
      ipcRenderer.invoke(ipcChannels.commercialGetContact, contactId) as ReturnType<
        MorubiBridge['commercial']['getContact']
      >,
    listDeals: (search) =>
      ipcRenderer.invoke(ipcChannels.commercialListDeals, search) as ReturnType<
        MorubiBridge['commercial']['listDeals']
      >,
    getDeal: (dealId) =>
      ipcRenderer.invoke(ipcChannels.commercialGetDeal, dealId) as ReturnType<
        MorubiBridge['commercial']['getDeal']
      >,
    listConversations: (search) =>
      ipcRenderer.invoke(ipcChannels.commercialListConversations, search) as ReturnType<
        MorubiBridge['commercial']['listConversations']
      >,
    listMessages: (conversationId, cursor) =>
      ipcRenderer.invoke(ipcChannels.commercialListMessages, {
        conversationId,
        cursor
      }) as ReturnType<MorubiBridge['commercial']['listMessages']>,
    markConversationRead: (conversationId) =>
      ipcRenderer.invoke(ipcChannels.commercialMarkConversationRead, conversationId) as ReturnType<
        MorubiBridge['commercial']['markConversationRead']
      >,
    getConversationContext: (conversationId) =>
      ipcRenderer.invoke(
        ipcChannels.commercialGetConversationContext,
        conversationId
      ) as ReturnType<MorubiBridge['commercial']['getConversationContext']>,
    getMessageAudio: (messageId) =>
      ipcRenderer.invoke(ipcChannels.commercialGetMessageAudio, messageId) as ReturnType<
        MorubiBridge['commercial']['getMessageAudio']
      >
  },
  interventions: {
    viewed: (deliveryId) =>
      ipcRenderer.invoke(ipcChannels.interventionViewed, deliveryId) as ReturnType<
        MorubiBridge['interventions']['viewed']
      >,
    dismiss: (deliveryId) =>
      ipcRenderer.invoke(ipcChannels.interventionDismiss, deliveryId) as ReturnType<
        MorubiBridge['interventions']['dismiss']
      >,
    applied: (deliveryId) =>
      ipcRenderer.invoke(ipcChannels.interventionApplied, deliveryId) as ReturnType<
        MorubiBridge['interventions']['applied']
      >,
    feedback: (deliveryId, input) =>
      ipcRenderer.invoke(ipcChannels.interventionFeedback, deliveryId, input) as ReturnType<
        MorubiBridge['interventions']['feedback']
      >
  },
  realtime: {
    subscribe: (listener) => {
      const wrapped = (_event: Electron.IpcRendererEvent, value: Parameters<typeof listener>[0]) =>
        listener(value);
      ipcRenderer.on(ipcChannels.realtimeEvent, wrapped);
      void ipcRenderer.invoke(ipcChannels.realtimeStart);
      return () => {
        ipcRenderer.removeListener(ipcChannels.realtimeEvent, wrapped);
        void ipcRenderer.invoke(ipcChannels.realtimeStop);
      };
    }
  },
  liveCalls: {
    getCurrent: () =>
      ipcRenderer.invoke(ipcChannels.liveCallsGetCurrent) as ReturnType<
        MorubiBridge['liveCalls']['getCurrent']
      >,
    create: (input) =>
      ipcRenderer.invoke(ipcChannels.liveCallsCreate, input) as ReturnType<
        MorubiBridge['liveCalls']['create']
      >,
    get: (sessionId) =>
      ipcRenderer.invoke(ipcChannels.liveCallsGet, sessionId) as ReturnType<
        MorubiBridge['liveCalls']['get']
      >,
    start: (sessionId, input) =>
      ipcRenderer.invoke(ipcChannels.liveCallsStart, sessionId, input) as ReturnType<
        MorubiBridge['liveCalls']['start']
      >,
    heartbeat: (sessionId, input) =>
      ipcRenderer.invoke(ipcChannels.liveCallsHeartbeat, sessionId, input) as ReturnType<
        MorubiBridge['liveCalls']['heartbeat']
      >,
    sendTurn: (sessionId, input) =>
      ipcRenderer.invoke(ipcChannels.liveCallsSendTurn, sessionId, input) as ReturnType<
        MorubiBridge['liveCalls']['sendTurn']
      >,
    end: (sessionId) =>
      ipcRenderer.invoke(ipcChannels.liveCallsEnd, sessionId) as ReturnType<
        MorubiBridge['liveCalls']['end']
      >,
    simulate: (input) =>
      ipcRenderer.invoke(ipcChannels.liveCallsSimulate, input) as ReturnType<
        MorubiBridge['liveCalls']['simulate']
      >,
    authorizeMicrophone: () =>
      ipcRenderer.invoke(ipcChannels.liveCallsAuthorizeMicrophone) as ReturnType<
        MorubiBridge['liveCalls']['authorizeMicrophone']
      >,
    setCompactMode: (input) =>
      ipcRenderer.invoke(ipcChannels.liveCallsSetCompactMode, input) as ReturnType<
        MorubiBridge['liveCalls']['setCompactMode']
      >
  },
  notifications: {
    show: (input) =>
      ipcRenderer.invoke(ipcChannels.notificationsShow, input) as ReturnType<
        MorubiBridge['notifications']['show']
      >
  }
};

contextBridge.exposeInMainWorld('morubi', bridge);
