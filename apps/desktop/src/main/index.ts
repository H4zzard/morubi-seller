import {
  app,
  BrowserWindow,
  desktopCapturer,
  Menu,
  net,
  nativeImage,
  Notification,
  protocol,
  session,
  systemPreferences,
  Tray
} from 'electron';
import { join, resolve, sep } from 'node:path';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { DesktopApiClient } from './desktop-api-client.js';
import { parseDesktopRuntimeEnv } from './desktop-runtime-config.js';
import { registerIpcHandlers } from './ipc-handlers.js';
import { SecureAuthStorage } from './secure-auth-storage.js';
import { DesktopRealtimeClient } from './realtime-client.js';
import { LiveMediaPermissionGate } from './live-media-permission.js';
import { WindowsMeetingObservationProvider } from './windows-meeting-observation.js';
import { MacOSMeetingObservationProvider } from './macos-meeting-observation.js';
import { MacOSAudioDeviceInventoryProvider } from './macos-audio-devices.js';
import { LiveCaptureLifecycle } from './live-capture-lifecycle.js';
import { LiveAudioTransportClient } from './live-audio-transport.js';
import { BackgroundAppLifecycle } from './background-app-lifecycle.js';
import {
  MacOSNativeAudioEngine,
  supportsScreenCaptureKitAudio
} from './macos-native-audio-engine.js';
import {
  ipcChannels,
  macOSNativeSystemAudioSourceId,
  type LiveCallRuntimeCapabilities,
  type MeetingCandidateDto,
  type Platform
} from '../shared/ipc.js';

protocol.registerSchemesAsPrivileged([
  { scheme: 'morubi-app', privileges: { standard: true, secure: true, supportFetchAPI: true } }
]);

app.setName('Morubi');
const env = parseDesktopRuntimeEnv(process.env, app.isPackaged);
let appTray: Tray | null = null;
if (!app.isPackaged && env.MORUBI_USER_DATA_DIR) {
  app.setPath('userData', env.MORUBI_USER_DATA_DIR);
}

function registerRendererProtocol(): void {
  const root = resolve(join(__dirname, '../renderer'));
  protocol.handle('morubi-app', (request) => {
    const url = new URL(request.url);
    const relativePath =
      url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
    const target = resolve(root, relativePath);
    if (target !== root && !target.startsWith(`${root}${sep}`)) {
      return new Response('Forbidden', { status: 403 });
    }
    return net.fetch(pathToFileURL(target).toString());
  });
}

function createWindow(showOnReady = true): BrowserWindow {
  const window = new BrowserWindow({
    width: 1366,
    height: 820,
    minWidth: 1040,
    minHeight: 680,
    backgroundColor: '#070a0a',
    show: false,
    title: 'Morubi',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      backgroundThrottling: false,
      devTools: !app.isPackaged
    }
  });

  if (showOnReady) window.once('ready-to-show', () => window.show());
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, navigationUrl) => {
    const allowed =
      navigationUrl.startsWith('morubi-app://app/') ||
      (!app.isPackaged && navigationUrl.startsWith('http://localhost:5173/'));
    if (!allowed) event.preventDefault();
  });

  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (!app.isPackaged && rendererUrl) void window.loadURL(rendererUrl);
  else void window.loadURL('morubi-app://app/index.html');
  return window;
}

function createTray(): Tray {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18"><circle cx="9" cy="9" r="7" fill="none" stroke="white" stroke-width="2"/><path d="M5 11V7l4 3 4-3v4" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const icon = nativeImage
    .createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`)
    .resize({ width: 18, height: 18 });
  if (process.platform === 'darwin') icon.setTemplateImage(true);
  return new Tray(icon);
}

void app.whenReady().then(() => {
  registerRendererProtocol();
  const loginSettings = app.getLoginItemSettings();
  const launchedInBackground =
    process.argv.includes('--background') ||
    (process.platform === 'darwin' && loginSettings.wasOpenedAtLogin);
  const window = createWindow(!launchedInBackground);
  const desktopOrigin =
    env.MORUBI_DESKTOP_ORIGIN ?? (app.isPackaged ? 'morubi-app://app' : 'http://localhost:5173');
  const microphonePermission = new LiveMediaPermissionGate(env.MORUBI_LIVE_CAPTURE_ENABLED);
  const windowsMeetingObservation = new WindowsMeetingObservationProvider();
  const macOSMeetingObservation = new MacOSMeetingObservationProvider({
    screenPermissionGranted: () => systemPreferences.getMediaAccessStatus('screen') === 'granted'
  });
  const macOSAudioDevices = new MacOSAudioDeviceInventoryProvider();
  const systemVersion = process.getSystemVersion();
  const nativeAudioHelperPath = app.isPackaged
    ? join(process.resourcesPath, 'native', 'morubi-audio-engine')
    : resolve(__dirname, '../../native/macos-audio-engine/build/morubi-audio-engine');
  const nativeMacOSAudioAvailable =
    process.platform === 'darwin' &&
    supportsScreenCaptureKitAudio(systemVersion) &&
    existsSync(nativeAudioHelperPath);
  const nativeMacOSAudio = new MacOSNativeAudioEngine({
    helperPath: nativeAudioHelperPath,
    systemVersion,
    screenPermissionStatus: () => systemPreferences.getMediaAccessStatus('screen')
  });
  session.defaultSession.setPermissionRequestHandler(
    (webContents, permission, callback, details) => {
      if (permission === 'display-capture') {
        const currentUrl = webContents.getURL();
        callback(
          microphonePermission.checkSystemAudio({
            requestingWebContentsId: webContents.id,
            allowedWebContentsId: window.webContents.id,
            requestingOrigin: currentUrl.startsWith(desktopOrigin) ? desktopOrigin : currentUrl,
            allowedOrigin: desktopOrigin
          })
        );
        return;
      }
      const reflectedMediaTypes: unknown = Reflect.get(details, 'mediaTypes');
      const mediaTypes = Array.isArray(reflectedMediaTypes)
        ? reflectedMediaTypes.filter((value): value is string => typeof value === 'string')
        : [];
      callback(
        microphonePermission.consumeMicrophone({
          requestingWebContentsId: webContents.id,
          allowedWebContentsId: window.webContents.id,
          permission,
          mediaTypes
        })
      );
    }
  );
  session.defaultSession.setPermissionCheckHandler(
    (webContents, permission, requestingOrigin, details) =>
      permission === 'display-capture'
        ? microphonePermission.checkSystemAudio({
            requestingWebContentsId: webContents?.id ?? null,
            allowedWebContentsId: window.webContents.id,
            requestingOrigin,
            allowedOrigin: desktopOrigin
          })
        : microphonePermission.checkMicrophone({
            requestingWebContentsId: webContents?.id ?? null,
            allowedWebContentsId: window.webContents.id,
            permission,
            mediaType: details.mediaType
          })
  );
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    const sourceId = microphonePermission.consumeSystemAudio({
      trustedFrame: request.frame === window.webContents.mainFrame,
      securityOrigin: request.securityOrigin,
      allowedOrigin: desktopOrigin,
      audioRequested: request.audioRequested,
      videoRequested: request.videoRequested
    });
    if (!sourceId || process.platform !== 'win32') {
      callback({});
      return;
    }
    void desktopCapturer
      .getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 0, height: 0 },
        fetchWindowIcons: false
      })
      .then((sources) => {
        const selected = sources.find((source) => source.id === sourceId);
        if (!selected) {
          callback({});
          return;
        }
        callback({ video: selected, audio: 'loopback' });
      })
      .catch(() => {
        callback({});
      });
  });
  const api = new DesktopApiClient(env.MORUBI_API_URL, new SecureAuthStorage(), desktopOrigin);
  const realtime = new DesktopRealtimeClient(window, api);
  const audioTransport = new LiveAudioTransportClient(api);
  const captureLifecycle = new LiveCaptureLifecycle(
    api,
    async () => {
      await nativeMacOSAudio.stop();
      microphonePermission.clearActiveSession();
    },
    () => {
      if (!window.isDestroyed()) window.webContents.send(ipcChannels.liveCallsCaptureStopRequested);
    }
  );
  const backgroundLifecycle = new BackgroundAppLifecycle(app, window, () =>
    captureLifecycle.cleanup()
  );
  appTray = createTray();
  const renderTrayState = (captureActive: boolean): void => {
    if (!appTray) return;
    appTray.setToolTip(
      captureActive ? 'Morubi — captura autorizada ativa' : 'Morubi — em segundo plano'
    );
    appTray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: captureActive ? 'Captura autorizada ativa' : 'Morubi em segundo plano',
          enabled: false
        },
        { type: 'separator' },
        { label: 'Abrir ou ocultar Morubi', click: () => backgroundLifecycle.toggleWindow() },
        {
          label: 'Iniciar com o sistema',
          type: 'checkbox',
          checked: app.isPackaged && backgroundLifecycle.openAtLogin(),
          enabled: app.isPackaged,
          click: (item) => backgroundLifecycle.setOpenAtLogin(item.checked, process.platform)
        },
        { type: 'separator' },
        { label: 'Encerrar Morubi', click: () => void backgroundLifecycle.requestQuit() }
      ])
    );
  };
  renderTrayState(false);
  appTray.on('click', () => backgroundLifecycle.toggleWindow());
  const desktopPlatform: Platform =
    process.platform === 'win32' || process.platform === 'darwin' ? process.platform : 'linux';
  const getCapabilities = (): LiveCallRuntimeCapabilities => {
    const desktopSupported = process.platform === 'win32' || process.platform === 'darwin';
    const legacyMacOSPermissionGranted =
      process.platform === 'darwin' &&
      systemPreferences.getMediaAccessStatus('screen') === 'granted';
    const meetingDetectionAvailable =
      env.MORUBI_LIVE_CAPTURE_ENABLED &&
      (process.platform === 'win32' || legacyMacOSPermissionGranted);
    return {
      simulatorEnabled: !app.isPackaged && env.MORUBI_LIVE_DEV_SIMULATOR_ENABLED,
      meetingDetection: {
        enabled: env.MORUBI_LIVE_CAPTURE_ENABLED,
        supported: desktopSupported,
        available: meetingDetectionAvailable,
        method:
          process.platform === 'win32'
            ? 'WINDOW_TITLE'
            : process.platform === 'darwin'
              ? 'LEGACY_SCREEN_METADATA'
              : 'NONE',
        permission:
          process.platform !== 'darwin'
            ? 'NOT_APPLICABLE'
            : legacyMacOSPermissionGranted
              ? 'GRANTED'
              : 'OPTIONAL_PERMISSION_REQUIRED'
      },
      audioCapture: {
        enabled: env.MORUBI_LIVE_CAPTURE_ENABLED,
        microphoneSupported: desktopSupported,
        systemAudioSupported: desktopSupported,
        systemAudioMethod:
          process.platform === 'win32'
            ? 'WINDOWS_LOOPBACK'
            : process.platform === 'darwin'
              ? nativeMacOSAudioAvailable
                ? 'MACOS_SCREEN_CAPTURE_KIT'
                : supportsScreenCaptureKitAudio(systemVersion)
                  ? 'MACOS_BLACKHOLE_2CH'
                  : 'MACOS_VIRTUAL_DEVICE_REQUIRED'
              : 'UNSUPPORTED',
        nativeSystemAudioSupported: process.platform === 'win32' || nativeMacOSAudioAvailable,
        microphonePermission: desktopSupported
          ? systemPreferences.getMediaAccessStatus('microphone')
          : 'not-applicable'
      },
      liveCallSession: {
        enabled: env.MORUBI_LIVE_CAPTURE_ENABLED,
        manualStartSupported: desktopSupported && env.MORUBI_LIVE_CAPTURE_ENABLED
      },
      platform: desktopPlatform,
      maxBufferBytes: env.MORUBI_LIVE_AUDIO_BUFFER_BYTES,
      observationIntervalMs: env.MORUBI_MEETING_OBSERVATION_INTERVAL_MS
    };
  };
  const observeMeetingCandidates = (): Promise<MeetingCandidateDto[]> =>
    process.platform === 'darwin'
      ? macOSMeetingObservation.observe()
      : windowsMeetingObservation.observe();
  let lastNotifiedCandidateId: string | null = null;
  let backgroundObservationEnabled = false;
  const notifyDetectedMeeting = (candidates: MeetingCandidateDto[]): void => {
    const candidate = candidates[0] ?? null;
    if (!candidate) {
      lastNotifiedCandidateId = null;
      return;
    }
    if (
      window.isVisible() ||
      candidate.id === lastNotifiedCandidateId ||
      !Notification.isSupported()
    )
      return;
    lastNotifiedCandidateId = candidate.id;
    const notification = new Notification({
      title: 'Possível reunião detectada',
      body: 'Abra o Morubi para confirmar e iniciar o acompanhamento.'
    });
    notification.on('click', () => backgroundLifecycle.showWindow());
    notification.show();
  };
  const backgroundObservationTimer = setInterval(() => {
    if (!backgroundObservationEnabled || !getCapabilities().meetingDetection.available) return;
    void observeMeetingCandidates()
      .then(notifyDetectedMeeting)
      .catch(() => undefined);
  }, env.MORUBI_MEETING_OBSERVATION_INTERVAL_MS);
  backgroundObservationTimer.unref();
  registerIpcHandlers(window, api, realtime, audioTransport, {
    getCapabilities,
    requestMeetingObservationPermission: async () => {
      if (process.platform === 'darwin') {
        await macOSMeetingObservation.requestPermissionAndVerify();
      }
      return getCapabilities();
    },
    observeMeetings: observeMeetingCandidates,
    listSystemAudioSources: async () => {
      if (process.platform === 'darwin') {
        if (nativeMacOSAudioAvailable)
          return [
            {
              id: macOSNativeSystemAudioSourceId,
              name: 'Áudio da reunião',
              kind: 'NATIVE' as const
            }
          ];
        return macOSAudioDevices.listSystemAudioSources();
      }
      if (process.platform !== 'win32') throw new Error('SYSTEM_AUDIO_CAPTURE_UNSUPPORTED');
      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 0, height: 0 },
        fetchWindowIcons: false
      });
      return sources.map((source) => ({
        id: source.id,
        name: source.name.slice(0, 240),
        kind: source.id.startsWith('screen:') ? ('SCREEN' as const) : ('WINDOW' as const)
      }));
    },
    activateSession: (sessionId) => {
      microphonePermission.setActiveSession(sessionId);
      renderTrayState(true);
    },
    clearSession: (sessionId) => {
      void nativeMacOSAudio.stop(sessionId);
      microphonePermission.clearActiveSession(sessionId);
      renderTrayState(false);
    },
    cleanup: async (options) => {
      await captureLifecycle.cleanup(options);
      renderTrayState(false);
    },
    setBackgroundObservationEnabled: (enabled) => {
      backgroundObservationEnabled = enabled;
      if (!enabled) lastNotifiedCandidateId = null;
    },
    authorizeMicrophone: async (sessionId) => {
      if (process.platform === 'darwin') {
        const granted = await systemPreferences.askForMediaAccess('microphone');
        if (!granted) throw new Error('MICROPHONE_PERMISSION_DENIED');
      }
      return microphonePermission.authorizeMicrophone(sessionId);
    },
    authorizeAudioDiagnostic: async () => {
      if (process.platform === 'darwin') {
        const granted = await systemPreferences.askForMediaAccess('microphone');
        if (!granted) throw new Error('MICROPHONE_PERMISSION_DENIED');
      }
      return microphonePermission.authorizeAudioDiagnostic();
    },
    authorizeSystemAudioDiagnostic: (sourceId) =>
      microphonePermission.authorizeSystemAudioDiagnostic(sourceId),
    authorizeMacOSSystemAudio: async (sessionId) => {
      if (process.platform !== 'darwin') throw new Error('MACOS_SYSTEM_AUDIO_UNSUPPORTED');
      const granted = await systemPreferences.askForMediaAccess('microphone');
      if (!granted) throw new Error('MACOS_SYSTEM_AUDIO_PERMISSION_DENIED');
      return microphonePermission.authorizeMicrophone(sessionId);
    },
    authorizeSystemAudio: (sessionId, sourceId) =>
      microphonePermission.authorizeSystemAudio(sessionId, sourceId),
    startNativeSystemAudio: async (sessionId) => {
      if (!microphonePermission.consumeNativeSystemAudio(sessionId, macOSNativeSystemAudioSourceId))
        throw new Error('MACOS_NATIVE_SYSTEM_AUDIO_NOT_AUTHORIZED');
      return nativeMacOSAudio.start(sessionId);
    },
    stopNativeSystemAudio: (sessionId) => nativeMacOSAudio.stop(sessionId),
    onNativeSystemAudioChunk: (listener) => nativeMacOSAudio.onChunk(listener),
    onNativeSystemAudioFailure: (listener) =>
      nativeMacOSAudio.onFailure((sessionId, error) => listener({ sessionId, code: error.message }))
  });
  window.webContents.on('render-process-gone', () => {
    realtime.stop();
    void audioTransport.stop();
    void captureLifecycle.cleanup({ notifyRenderer: false });
  });
  window.on('close', (event) => {
    backgroundLifecycle.handleWindowClose(event);
  });
  window.on('closed', () => {
    realtime.stop();
    void audioTransport.stop();
    void captureLifecycle.cleanup({ notifyRenderer: false });
  });

  app.on('before-quit', (event) => backgroundLifecycle.handleBeforeQuit(event));

  app.on('activate', () => {
    backgroundLifecycle.showWindow();
  });
});
