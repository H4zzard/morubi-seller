import type {
  AudioBinaryDto,
  CallReportDto,
  CallTranscriptDto,
  ContactDetailDto,
  ContactSummaryDto,
  ConversationContextDto,
  ConversationMessagesDto,
  ConversationSummaryDto,
  CursorPageDto,
  DealDetailDto,
  DealSummaryDto,
  DevLiveCallScenarioRequest,
  InterventionCardDto,
  InterventionFeedbackInput,
  OrganizationChoiceDto,
  LiveCallDetailDto,
  LiveCallHeartbeatRequest,
  LiveCallSessionDto,
  LiveCallTurnResultDto,
  LiveTranscriptTurnRequest,
  CreateLiveCallRequest,
  StartLiveCallRequest,
  SessionDto
} from '@morubi/contracts';
import type { SignInInput } from '@morubi/validation';
import type { StoredAuthState } from './secure-auth-storage.js';

export interface AuthStorage {
  read(): Promise<StoredAuthState | null>;
  write(state: StoredAuthState): Promise<void>;
  clear(): Promise<void>;
}

function splitCombinedSetCookie(value: string): string[] {
  return value.split(/,(?=\s*[^;,\s]+=)/u);
}

export function cookieHeader(response: Response): string {
  const getSetCookie = Reflect.get(response.headers, 'getSetCookie');
  const reflected: unknown =
    typeof getSetCookie === 'function'
      ? Reflect.apply(getSetCookie, response.headers, [])
      : null;

  const values =
    Array.isArray(reflected) && reflected.every((value) => typeof value === 'string')
      ? reflected
      : splitCombinedSetCookie(response.headers.get('set-cookie') ?? '');

  return values
    .map((value) => value.split(';', 1)[0])
    .filter(Boolean)
    .join('; ');
}

export class DesktopApiClient {
  public constructor(
    private readonly baseUrl: string,
    private readonly storage: AuthStorage,
    private readonly origin: string,
    private readonly fetcher: typeof fetch = (input, init) => globalThis.fetch(input, init)
  ) {}

  public async signIn(input: SignInInput): Promise<SessionDto> {
    const response = await this.fetcher(`${this.baseUrl}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: this.origin,
        'x-morubi-client': 'desktop'
      },
      body: JSON.stringify(input)
    });

    if (!response.ok) {
      throw new Error(this.authFailureMessage(response.status));
    }

    const cookie = cookieHeader(response);

    if (!cookie) {
      throw new Error('O servidor não criou uma sessão segura.');
    }

    try {
      await this.storage.write({ cookie, organizationId: null });

      const organizations = await this.listOrganizations();

      if (organizations.length === 1 && organizations[0]) {
        await this.storage.write({
          cookie,
          organizationId: organizations[0].organization.id
        });
      }

      const session = await this.getSession();

      if (!session) {
        throw new Error('A sessão não pôde ser validada.');
      }

      if (session.tenant) {
        const stored = await this.storage.read();

        if (stored) {
          await this.request('/v1/auth/session/audit', stored, {
            method: 'POST'
          });
        }
      }

      return session;
    } catch (error) {
      await this.storage.clear();
      throw error;
    }
  }

  public async getSession(): Promise<SessionDto | null> {
    const state = await this.storage.read();

    if (!state) {
      return null;
    }

    const response = await this.request('/v1/auth/session', state);

    if (response.status === 401) {
      await this.storage.clear();
      return null;
    }

    if (!response.ok) {
      throw new Error('Não foi possível consultar a sessão.');
    }

    return (await response.json()) as SessionDto;
  }

  public async listOrganizations(): Promise<OrganizationChoiceDto[]> {
    const state = await this.storage.read();

    if (!state) {
      return [];
    }

    const response = await this.request('/v1/organizations', state);

    if (!response.ok) {
      throw new Error('Não foi possível listar as organizações.');
    }

    return (await response.json()) as OrganizationChoiceDto[];
  }

  public async setOrganization(organizationId: string): Promise<SessionDto> {
    const state = await this.storage.read();

    if (!state) {
      throw new Error('Sessão não encontrada.');
    }

    const organizations = await this.listOrganizations();

    if (!organizations.some((choice) => choice.organization.id === organizationId)) {
      throw new Error('Organização não autorizada.');
    }

    await this.storage.write({ ...state, organizationId });

    const session = await this.getSession();

    if (!session?.tenant) {
      throw new Error('O tenant não pôde ser resolvido.');
    }

    await this.request(
      '/v1/auth/session/audit',
      { ...state, organizationId },
      { method: 'POST' }
    );

    return session;
  }

  public async signOut(): Promise<void> {
    const state = await this.storage.read();

    try {
      if (state) {
        await this.request('/api/auth/sign-out', state, {
          method: 'POST'
        });
      }
    } finally {
      await this.storage.clear();
    }
  }

  public listContacts(
    search?: string
  ): Promise<CursorPageDto<ContactSummaryDto>> {
    return this.getJson(
      `/v1/contacts${search ? `?search=${encodeURIComponent(search)}` : ''}`
    );
  }

  public getContact(contactId: string): Promise<ContactDetailDto> {
    return this.getJson(`/v1/contacts/${contactId}`);
  }

  public listDeals(
    search?: string
  ): Promise<CursorPageDto<DealSummaryDto>> {
    return this.getJson(
      `/v1/deals${search ? `?search=${encodeURIComponent(search)}` : ''}`
    );
  }

  public getDeal(dealId: string): Promise<DealDetailDto> {
    return this.getJson(`/v1/deals/${dealId}`);
  }

  public listConversations(
    search?: string
  ): Promise<CursorPageDto<ConversationSummaryDto>> {
    return this.getJson(
      `/v1/conversations${search ? `?search=${encodeURIComponent(search)}` : ''}`
    );
  }

  public listMessages(
    conversationId: string,
    cursor?: string
  ): Promise<ConversationMessagesDto> {
    return this.getJson(
      `/v1/conversations/${conversationId}/messages${
        cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''
      }`
    );
  }

  public async markConversationRead(conversationId: string): Promise<void> {
    const state = await this.storage.read();

    if (!state?.organizationId) {
      throw new Error('Selecione uma organização.');
    }

    const response = await this.request(
      `/v1/conversations/${conversationId}/read`,
      state,
      { method: 'POST' }
    );

    if (!response.ok) {
      throw new Error('Não foi possível atualizar a leitura.');
    }
  }

  public getConversationContext(
    conversationId: string
  ): Promise<ConversationContextDto> {
    return this.getJson(`/v1/conversations/${conversationId}/context`);
  }

  public async getMessageAudio(messageId: string): Promise<AudioBinaryDto> {
    const state = await this.storage.read();

    if (!state?.organizationId) {
      throw new Error('Selecione uma organização.');
    }

    const response = await this.request(
      `/v1/messages/${messageId}/audio`,
      state
    );

    if (!response.ok) {
      throw new Error('O áudio não está disponível.');
    }

    const bytes = new Uint8Array(await response.arrayBuffer());

    return {
      mimeType:
        response.headers.get('content-type')?.split(';', 1)[0] ??
        'application/octet-stream',
      dataBase64: Buffer.from(bytes).toString('base64')
    };
  }

  public viewed(deliveryId: string): Promise<InterventionCardDto> {
    return this.postJson(`/v1/interventions/${deliveryId}/viewed`);
  }

  public dismiss(deliveryId: string): Promise<InterventionCardDto> {
    return this.postJson(`/v1/interventions/${deliveryId}/dismiss`);
  }

  public applied(deliveryId: string): Promise<InterventionCardDto> {
    return this.postJson(`/v1/interventions/${deliveryId}/applied`);
  }

  public async feedback(
    deliveryId: string,
    input: InterventionFeedbackInput
  ): Promise<void> {
    const state = await this.storage.read();

    if (!state?.organizationId) {
      throw new Error('Selecione uma organização.');
    }

    const response = await this.request(
      `/v1/interventions/${deliveryId}/feedback`,
      state,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input)
      }
    );

    if (!response.ok) {
      throw new Error('Não foi possível registrar o feedback.');
    }
  }

  public async realtime(
    lastEventId: string | null,
    signal: AbortSignal
  ): Promise<Response> {
    const state = await this.storage.read();

    if (!state?.organizationId) {
      throw new Error('Selecione uma organização.');
    }

    const headers: Record<string, string> = {
      accept: 'text/event-stream'
    };

    if (lastEventId) {
      headers['last-event-id'] = lastEventId;
    }

    return this.request('/v1/realtime/events', state, {
      headers,
      signal
    });
  }

  public getCurrentLiveCall(): Promise<{
    session: LiveCallDetailDto | null;
  }> {
    return this.getJson('/v1/live-calls/current');
  }

  public createLiveCall(
    input: CreateLiveCallRequest
  ): Promise<LiveCallSessionDto> {
    return this.requestJson('/v1/live-calls', 'POST', input);
  }

  public startLiveCall(
    sessionId: string,
    input: StartLiveCallRequest
  ): Promise<LiveCallSessionDto> {
    return this.requestJson(
      `/v1/live-calls/${sessionId}/start`,
      'POST',
      input
    );
  }

  public getLiveCall(sessionId: string): Promise<LiveCallDetailDto> {
    return this.getJson(`/v1/live-calls/${sessionId}`);
  }

  public sendLiveCallHeartbeat(
    sessionId: string,
    input: LiveCallHeartbeatRequest
  ): Promise<{ receivedAt: string; bufferAccepted: boolean }> {
    return this.requestJson(
      `/v1/live-calls/${sessionId}/heartbeat`,
      'POST',
      input
    );
  }

  public sendLiveCallTurn(
    sessionId: string,
    input: LiveTranscriptTurnRequest
  ): Promise<LiveCallTurnResultDto> {
    return this.requestJson(
      `/v1/live-calls/${sessionId}/turns`,
      'POST',
      input
    );
  }

  public endLiveCall(sessionId: string): Promise<LiveCallSessionDto> {
    return this.requestJson(
      `/v1/live-calls/${sessionId}/end`,
      'POST'
    );
  }

  public getCallReport(sessionId: string): Promise<CallReportDto> {
    return this.getJson(`/v1/live-calls/${sessionId}/report`);
  }

  public retryCallReport(sessionId: string): Promise<CallReportDto> {
    return this.requestJson(
      `/v1/live-calls/${sessionId}/report/retry`,
      'POST'
    );
  }

  public getCallTranscript(
    sessionId: string
  ): Promise<CallTranscriptDto> {
    return this.getJson(`/v1/live-calls/${sessionId}/transcript`);
  }

  public simulateLiveCall(
    input: DevLiveCallScenarioRequest
  ): Promise<unknown> {
    return this.requestJson(
      '/v1/dev/live-calls/simulate',
      'POST',
      input
    );
  }

  private async getJson<T>(path: string): Promise<T> {
    const state = await this.storage.read();

    if (!state?.organizationId) {
      throw new Error('Selecione uma organização.');
    }

    const response = await this.request(path, state);

    if (!response.ok) {
      throw new Error('Não foi possível carregar os dados comerciais.');
    }

    return (await response.json()) as T;
  }

  private async postJson<T>(path: string): Promise<T> {
    const state = await this.storage.read();

    if (!state?.organizationId) {
      throw new Error('Selecione uma organização.');
    }

    const response = await this.request(path, state, {
      method: 'POST'
    });

    if (!response.ok) {
      throw new Error('Não foi possível atualizar a intervenção.');
    }

    return (await response.json()) as T;
  }

  private async requestJson<T>(
    path: string,
    method: 'POST' | 'PATCH',
    body?: unknown
  ): Promise<T> {
    const state = await this.storage.read();

    if (!state?.organizationId) {
      throw new Error('Selecione uma organização.');
    }

    const response = await this.request(path, state, {
      method,
      ...(body === undefined
        ? {}
        : {
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body)
          })
    });

    if (!response.ok) {
      throw new Error('Não foi possível atualizar a call ao vivo.');
    }

    return (await response.json()) as T;
  }

  private request(
    path: string,
    state: { cookie: string; organizationId: string | null },
    init: RequestInit = {}
  ): Promise<Response> {
    const headers = new Headers(init.headers);

    headers.set('cookie', state.cookie);
    headers.set('accept', 'application/json');
    headers.set('origin', this.origin);
    headers.set('x-request-id', crypto.randomUUID());
    headers.set('x-morubi-client', 'desktop');

    if (state.organizationId) {
      headers.set('x-organization-id', state.organizationId);
    }

    return this.fetcher(`${this.baseUrl}${path}`, {
      ...init,
      headers
    });
  }

  private authFailureMessage(status: number): string {
    if (status === 401) return 'E-mail ou senha inválidos.';
    if (status === 403) return 'Não foi possível validar a origem segura do aplicativo.';
    if (status === 429) return 'Muitas tentativas de login. Aguarde e tente novamente.';
    if (status >= 500) return 'O serviço de autenticação está temporariamente indisponível.';
    return 'Não foi possível autenticar. Verifique os dados e tente novamente.';
  }
}
