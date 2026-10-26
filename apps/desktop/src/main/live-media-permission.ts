interface CaptureAuthorization {
  sessionId: string | null;
  authorizedUntil: number;
}

interface SystemAudioAuthorization extends CaptureAuthorization {
  sourceId: string;
}

export class LiveMediaPermissionGate {
  private activeSessionId: string | null = null;
  private microphone: CaptureAuthorization | null = null;
  private systemAudio: SystemAudioAuthorization | null = null;

  public constructor(
    private readonly enabled: boolean,
    private readonly windowMs = 30_000,
    private readonly now: () => number = Date.now
  ) {}

  public setActiveSession(sessionId: string): void {
    if (!this.enabled) throw new Error('LIVE_CAPTURE_DISABLED');
    this.reset();
    this.activeSessionId = sessionId;
  }

  public authorizeMicrophone(sessionId: string): string {
    this.assertActiveSession(sessionId);
    const authorizedUntil = this.now() + this.windowMs;
    this.microphone = { sessionId, authorizedUntil };
    return new Date(authorizedUntil).toISOString();
  }

  public authorizeAudioDiagnostic(): string {
    this.assertEnabled();
    const authorizedUntil = this.now() + this.windowMs;
    this.microphone = { sessionId: null, authorizedUntil };
    return new Date(authorizedUntil).toISOString();
  }

  public authorizeSystemAudio(sessionId: string, sourceId: string): string {
    this.assertActiveSession(sessionId);
    this.assertSourceId(sourceId);
    const authorizedUntil = this.now() + this.windowMs;
    this.systemAudio = { sessionId, sourceId, authorizedUntil };
    return new Date(authorizedUntil).toISOString();
  }

  public authorizeSystemAudioDiagnostic(sourceId: string): string {
    this.assertEnabled();
    this.assertSourceId(sourceId);
    const authorizedUntil = this.now() + this.windowMs;
    this.systemAudio = { sessionId: null, sourceId, authorizedUntil };
    return new Date(authorizedUntil).toISOString();
  }

  public consumeMicrophone(input: {
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
      this.hasValidMicrophoneAuthorization() &&
      input.requestingWebContentsId === input.allowedWebContentsId &&
      input.permission === 'media' &&
      audioOnly;
    if (allowed) this.microphone = null;
    return allowed;
  }

  public checkMicrophone(input: {
    requestingWebContentsId: number | null;
    allowedWebContentsId: number;
    permission: string;
    mediaType: string | undefined;
  }): boolean {
    return (
      this.hasValidMicrophoneAuthorization() &&
      input.requestingWebContentsId === input.allowedWebContentsId &&
      input.permission === 'media' &&
      input.mediaType === 'audio'
    );
  }

  public consumeSystemAudio(input: {
    trustedFrame: boolean;
    securityOrigin: string;
    allowedOrigin: string;
    audioRequested: boolean;
    videoRequested: boolean;
  }): string | null {
    const authorization = this.systemAudio;
    const normalizedOrigin = input.securityOrigin.replace(/\/$/u, '');
    const allowedOrigin = input.allowedOrigin.replace(/\/$/u, '');
    const allowed =
      this.enabled &&
      authorization !== null &&
      this.authorizationMatchesSession(authorization) &&
      this.now() <= authorization.authorizedUntil &&
      input.trustedFrame &&
      normalizedOrigin === allowedOrigin &&
      input.audioRequested &&
      input.videoRequested;
    if (!allowed) return null;
    this.systemAudio = null;
    return authorization.sourceId;
  }

  public consumeNativeSystemAudio(sessionId: string, sourceId: string): boolean {
    const authorization = this.systemAudio;
    const allowed =
      this.enabled &&
      authorization !== null &&
      authorization.sessionId === sessionId &&
      authorization.sessionId === this.activeSessionId &&
      authorization.sourceId === sourceId &&
      this.now() <= authorization.authorizedUntil;
    if (allowed) this.systemAudio = null;
    return allowed;
  }

  public checkSystemAudio(input: {
    requestingWebContentsId: number | null;
    allowedWebContentsId: number;
    requestingOrigin: string;
    allowedOrigin: string;
  }): boolean {
    const authorization = this.systemAudio;
    return (
      this.enabled &&
      authorization !== null &&
      this.authorizationMatchesSession(authorization) &&
      this.now() <= authorization.authorizedUntil &&
      input.requestingWebContentsId === input.allowedWebContentsId &&
      input.requestingOrigin.replace(/\/$/u, '') === input.allowedOrigin.replace(/\/$/u, '')
    );
  }

  public clearActiveSession(sessionId?: string): void {
    if (sessionId && sessionId !== this.activeSessionId) return;
    this.reset();
    this.activeSessionId = null;
  }

  public reset(): void {
    this.microphone = null;
    this.systemAudio = null;
  }

  private hasValidMicrophoneAuthorization(): boolean {
    return (
      this.enabled &&
      this.microphone !== null &&
      this.authorizationMatchesSession(this.microphone) &&
      this.now() <= this.microphone.authorizedUntil
    );
  }

  private authorizationMatchesSession(authorization: CaptureAuthorization): boolean {
    return authorization.sessionId === null || authorization.sessionId === this.activeSessionId;
  }

  private assertSourceId(sourceId: string): void {
    if (!sourceId.trim() || sourceId.length > 512) throw new Error('DISPLAY_SOURCE_INVALID');
  }

  private assertEnabled(): void {
    if (!this.enabled) throw new Error('LIVE_CAPTURE_DISABLED');
  }

  private assertActiveSession(sessionId: string): void {
    this.assertEnabled();
    if (!this.activeSessionId || this.activeSessionId !== sessionId)
      throw new Error('LIVE_CAPTURE_SESSION_NOT_ACTIVE');
  }
}
