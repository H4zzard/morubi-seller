import { app, BrowserWindow, net, protocol, session, systemPreferences } from 'electron';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseDesktopEnv } from '@morubi/config';
import { DesktopApiClient } from './desktop-api-client.js';
import { registerIpcHandlers } from './ipc-handlers.js';
import { SecureAuthStorage } from './secure-auth-storage.js';
import { DesktopRealtimeClient } from './realtime-client.js';
import { LiveMediaPermissionGate } from './live-media-permission.js';

protocol.registerSchemesAsPrivileged([
  { scheme: 'morubi-app', privileges: { standard: true, secure: true, supportFetchAPI: true } }
]);

const env = parseDesktopEnv(process.env);
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

function createWindow(): BrowserWindow {
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
      devTools: !app.isPackaged
    }
  });

  window.once('ready-to-show', () => window.show());
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

void app.whenReady().then(() => {
  registerRendererProtocol();
  const window = createWindow();
  const microphonePermission = new LiveMediaPermissionGate(env.MORUBI_LIVE_CAPTURE_ENABLED);
  session.defaultSession.setPermissionRequestHandler(
    (webContents, permission, callback, details) => {
      const reflectedMediaTypes: unknown = Reflect.get(details, 'mediaTypes');
      const mediaTypes = Array.isArray(reflectedMediaTypes)
        ? reflectedMediaTypes.filter((value): value is string => typeof value === 'string')
        : [];
      callback(
        microphonePermission.consume({
          requestingWebContentsId: webContents.id,
          allowedWebContentsId: window.webContents.id,
          permission,
          mediaTypes
        })
      );
    }
  );
  session.defaultSession.setPermissionCheckHandler(
    (webContents, permission, _requestingOrigin, details) =>
      microphonePermission.check({
        requestingWebContentsId: webContents?.id ?? null,
        allowedWebContentsId: window.webContents.id,
        permission,
        mediaType: details.mediaType
      })
  );
  const desktopOrigin =
    env.MORUBI_DESKTOP_ORIGIN ??
    (app.isPackaged ? 'morubi-app://app' : 'http://localhost:5173');
  const api = new DesktopApiClient(
    env.MORUBI_API_URL,
    new SecureAuthStorage(),
    desktopOrigin
  );
  const realtime = new DesktopRealtimeClient(window, api);
  registerIpcHandlers(window, api, realtime, async () => {
    if (process.platform === 'darwin') {
      const granted = await systemPreferences.askForMediaAccess('microphone');
      if (!granted) throw new Error('MICROPHONE_PERMISSION_DENIED');
    }
    return microphonePermission.authorize();
  });
  window.webContents.on('render-process-gone', () => {
    microphonePermission.reset();
    realtime.stop();
  });
  window.on('closed', () => {
    microphonePermission.reset();
    realtime.stop();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
