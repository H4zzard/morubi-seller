import type { Role } from '@morubi/contracts';

export interface TenantContext {
  userId: string;
  organizationId: string;
  membershipId: string;
  role: Role;
  permissions: readonly string[];
}

export const auditActions = [
  'user.login',
  'organization.created',
  'membership.created',
  'membership.role_changed',
  'membership.removed',
  'integration.connected',
  'integration.disconnected',
  'integration.reauthenticated',
  'integration.manual_sync_requested'
] as const;

export type AuditAction = (typeof auditActions)[number];

export function slugifyOrganizationName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
}

export class AppError extends Error {
  public constructor(
    public readonly code:
      | 'UNAUTHORIZED'
      | 'FORBIDDEN'
      | 'NOT_FOUND'
      | 'VALIDATION_ERROR'
      | 'CONFLICT'
      | 'INTERNAL_ERROR',
    message: string,
    public readonly statusCode: number,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const errors = {
  unauthorized: () => new AppError('UNAUTHORIZED', 'Autenticação necessária.', 401),
  forbidden: () => new AppError('FORBIDDEN', 'Você não pode realizar esta ação.', 403),
  notFound: () => new AppError('NOT_FOUND', 'Recurso não encontrado.', 404),
  conflict: (message = 'O recurso já existe ou foi alterado.') =>
    new AppError('CONFLICT', message, 409),
  validation: (details?: unknown) =>
    new AppError('VALIDATION_ERROR', 'Os dados informados são inválidos.', 400, details)
};

export * from './commercial.js';
