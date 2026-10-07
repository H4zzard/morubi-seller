export class LiveMediaPermissionGate {
  private authorizedUntil = 0;

  public constructor(
    private readonly enabled: boolean,
    private readonly windowMs = 30_000,
    private readonly now: () => number = Date.now
  ) {}

  public authorize(): string {
    if (!this.enabled) throw new Error('LIVE_CAPTURE_DISABLED');
    this.authorizedUntil = this.now() + this.windowMs;
    return new Date(this.authorizedUntil).toISOString();
  }

  public consume(input: {
    requestingWebContentsId: number;
    allowedWebContentsId: number;
    permission: string;
    mediaTypes: readonly string[];
  }): boolean {
    const audioOnly =
      input.mediaTypes.length > 0 &&
      input.mediaTypes.includes('audio') &&
      !input.mediaTypes.includes('video');
    const allowed =
      this.enabled &&
      input.requestingWebContentsId === input.allowedWebContentsId &&
      input.permission === 'media' &&
      audioOnly &&
      this.now() <= this.authorizedUntil;
    if (allowed) this.reset();
    return allowed;
  }

  public check(input: {
    requestingWebContentsId: number | null;
    allowedWebContentsId: number;
    permission: string;
    mediaType: string | undefined;
  }): boolean {
    return (
      this.enabled &&
      input.requestingWebContentsId === input.allowedWebContentsId &&
      input.permission === 'media' &&
      input.mediaType === 'audio' &&
      this.now() <= this.authorizedUntil
    );
  }

  public reset(): void {
    this.authorizedUntil = 0;
  }
}
