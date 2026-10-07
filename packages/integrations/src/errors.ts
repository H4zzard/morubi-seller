export type ConnectorErrorCode =
  | 'AUTH_REQUIRED'
  | 'INSUFFICIENT_SCOPE'
  | 'RATE_LIMITED'
  | 'PROVIDER_UNAVAILABLE'
  | 'NETWORK_TIMEOUT'
  | 'INVALID_PAYLOAD'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'PERMANENT_UNSUPPORTED'
  | 'UNKNOWN';

export class ConnectorError extends Error {
  public constructor(
    public readonly code: ConnectorErrorCode,
    message: string,
    public readonly retryable: boolean,
    public readonly options: {
      statusCode?: number;
      retryAfterMs?: number;
      providerRequestId?: string;
      cause?: unknown;
    } = {}
  ) {
    super(message, { cause: options.cause });
    this.name = 'ConnectorError';
  }
}

export function classifyHttpError(input: {
  statusCode?: number;
  message?: string;
  retryAfterMs?: number;
  providerRequestId?: string;
  cause?: unknown;
}): ConnectorError {
  const status = input.statusCode;
  if (status === 401)
    return connectorError(
      'AUTH_REQUIRED',
      false,
      input,
      'A conexão precisa ser autenticada novamente.'
    );
  if (status === 403)
    return connectorError(
      'INSUFFICIENT_SCOPE',
      false,
      input,
      'A conexão não possui o escopo necessário.'
    );
  if (status === 404)
    return connectorError('NOT_FOUND', false, input, 'O recurso externo não foi encontrado.');
  if (status === 408)
    return connectorError(
      'NETWORK_TIMEOUT',
      true,
      input,
      'O provider excedeu o tempo de resposta.'
    );
  if (status === 429)
    return connectorError(
      'RATE_LIMITED',
      true,
      input,
      'O provider limitou temporariamente as requisições.'
    );
  if (status !== undefined && status >= 500)
    return connectorError(
      'PROVIDER_UNAVAILABLE',
      true,
      input,
      'O provider está temporariamente indisponível.'
    );
  return connectorError('UNKNOWN', false, input, 'A integração não pôde concluir a operação.');
}

function connectorError(
  code: ConnectorErrorCode,
  retryable: boolean,
  input: {
    statusCode?: number;
    retryAfterMs?: number;
    providerRequestId?: string;
    cause?: unknown;
  },
  safeMessage: string
): ConnectorError {
  const options: {
    statusCode?: number;
    retryAfterMs?: number;
    providerRequestId?: string;
    cause?: unknown;
  } = {};
  if (input.statusCode !== undefined) options.statusCode = input.statusCode;
  if (input.retryAfterMs !== undefined) options.retryAfterMs = input.retryAfterMs;
  if (input.providerRequestId !== undefined) options.providerRequestId = input.providerRequestId;
  if (input.cause !== undefined) options.cause = input.cause;
  return new ConnectorError(code, safeMessage, retryable, options);
}

const sensitiveKeyPattern =
  /authorization|access.?token|refresh.?token|client.?secret|secret|password|authorization.?code/i;

export function redactCredentials(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactCredentials);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, child]) => [
      key,
      sensitiveKeyPattern.test(key) ? '[REDACTED]' : redactCredentials(child)
    ])
  );
}

export function safeConnectorError(error: unknown): {
  code: ConnectorErrorCode;
  message: string;
  retryable: boolean;
  providerRequestId?: string;
} {
  if (error instanceof ConnectorError) {
    const result: {
      code: ConnectorErrorCode;
      message: string;
      retryable: boolean;
      providerRequestId?: string;
    } = {
      code: error.code,
      message: error.message,
      retryable: error.retryable
    };
    if (error.options.providerRequestId) result.providerRequestId = error.options.providerRequestId;
    return result;
  }
  return {
    code: 'UNKNOWN',
    message: 'A integração não pôde concluir a operação.',
    retryable: false
  };
}
