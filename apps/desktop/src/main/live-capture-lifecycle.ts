import type { LiveCallDetailDto, LiveCallSessionDto } from '@morubi/contracts';

export interface LiveCaptureLifecycleApi {
  getCurrentLiveCall(): Promise<{ session: LiveCallDetailDto | null }>;
  endLiveCall(sessionId: string): Promise<LiveCallSessionDto>;
}

export class LiveCaptureLifecycle {
  private cleanupPromise: Promise<void> | null = null;

  public constructor(
    private readonly api: LiveCaptureLifecycleApi,
    private readonly clearAuthorization: () => void | Promise<void>,
    private readonly requestRendererStop: () => void
  ) {}

  public cleanup(options: { notifyRenderer?: boolean } = {}): Promise<void> {
    if (this.cleanupPromise) return this.cleanupPromise;
    this.cleanupPromise = this.performCleanup(options).finally(() => {
      this.cleanupPromise = null;
    });
    return this.cleanupPromise;
  }

  private async performCleanup(options: { notifyRenderer?: boolean }): Promise<void> {
    if (options.notifyRenderer !== false) this.requestRendererStop();
    await this.clearAuthorization();
    try {
      const current = await this.api.getCurrentLiveCall();
      if (current.session && !['ENDED', 'FAILED', 'CANCELLED'].includes(current.session.status))
        await this.api.endLiveCall(current.session.id);
    } catch {
      // Tracks/grants are already stopped locally. Heartbeat recovery remains the server fallback.
    }
  }
}
