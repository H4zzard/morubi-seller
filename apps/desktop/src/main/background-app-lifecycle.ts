export interface BackgroundApplication {
  quit(): void;
  getLoginItemSettings(): { openAtLogin: boolean };
  setLoginItemSettings(settings: { openAtLogin: boolean; args?: string[] }): void;
}

export interface BackgroundWindow {
  focus(): void;
  hide(): void;
  isDestroyed(): boolean;
  isVisible(): boolean;
  show(): void;
}

export interface PreventableEvent {
  preventDefault(): void;
}

/** Shared Windows/macOS policy. Native tray/menu construction stays in the main adapter. */
export class BackgroundAppLifecycle {
  private quitAuthorized = false;
  private quitPromise: Promise<void> | null = null;

  public constructor(
    private readonly application: BackgroundApplication,
    private readonly window: BackgroundWindow,
    private readonly cleanup: () => Promise<void>
  ) {}

  public handleWindowClose(event: PreventableEvent): boolean {
    if (this.quitAuthorized) return false;
    event.preventDefault();
    this.window.hide();
    return true;
  }

  public handleBeforeQuit(event: PreventableEvent): void {
    if (this.quitAuthorized) return;
    event.preventDefault();
    void this.requestQuit();
  }

  public showWindow(): void {
    if (this.window.isDestroyed()) return;
    this.window.show();
    this.window.focus();
  }

  public toggleWindow(): void {
    if (this.window.isVisible()) this.window.hide();
    else this.showWindow();
  }

  public openAtLogin(): boolean {
    return this.application.getLoginItemSettings().openAtLogin;
  }

  public setOpenAtLogin(enabled: boolean, platform: NodeJS.Platform): void {
    this.application.setLoginItemSettings(
      platform === 'win32'
        ? { openAtLogin: enabled, args: enabled ? ['--background'] : [] }
        : { openAtLogin: enabled }
    );
  }

  public requestQuit(): Promise<void> {
    if (this.quitPromise) return this.quitPromise;
    this.quitPromise = this.cleanup().finally(() => {
      this.quitAuthorized = true;
      this.application.quit();
    });
    return this.quitPromise;
  }
}
