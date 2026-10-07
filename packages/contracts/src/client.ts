import type { ApiErrorBody } from './index.js';

export class ApiClientError extends Error {
  public constructor(
    public readonly status: number,
    public readonly body: ApiErrorBody
  ) {
    super(body.error.message);
    this.name = 'ApiClientError';
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  getOrganizationId?: () => string | null | Promise<string | null>;
  getHeaders?: () => HeadersInit | Promise<HeadersInit>;
  fetcher?: typeof fetch;
}

export class ApiClient {
  readonly #baseUrl: string;
  readonly #getOrganizationId?: ApiClientOptions['getOrganizationId'];
  readonly #getHeaders?: ApiClientOptions['getHeaders'];
  readonly #fetcher: typeof fetch;

  public constructor(options: ApiClientOptions) {
    this.#baseUrl = options.baseUrl.replace(/\/$/, '');
    this.#getOrganizationId = options.getOrganizationId;
    this.#getHeaders = options.getHeaders;
    this.#fetcher = options.fetcher ?? fetch;
  }

  public async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const requestId = crypto.randomUUID();
    const organizationId = await this.#getOrganizationId?.();
    const extraHeaders = await this.#getHeaders?.();
    const headers = new Headers(extraHeaders);
    new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    headers.set('accept', 'application/json');
    headers.set('x-request-id', requestId);
    if (organizationId) headers.set('x-organization-id', organizationId);
    if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');

    const response = await this.#fetcher(`${this.#baseUrl}${path}`, {
      ...init,
      headers,
      credentials: init.credentials ?? 'include'
    });

    if (!response.ok) {
      const fallback: ApiErrorBody = {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'A solicitação não pôde ser concluída.',
          requestId
        }
      };
      const body = (await response.json().catch(() => fallback)) as ApiErrorBody;
      throw new ApiClientError(response.status, body);
    }

    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }
}
