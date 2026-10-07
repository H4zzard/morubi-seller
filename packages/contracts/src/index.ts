export const roles = ['OWNER', 'ADMIN', 'MANAGER', 'SELLER'] as const;
export type Role = (typeof roles)[number];

export interface UserDto {
  id: string;
  name: string;
  email: string;
}

export interface OrganizationDto {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
}

export interface MembershipDto {
  id: string;
  organizationId: string;
  userId: string;
  role: Role;
  user?: UserDto;
  createdAt: string;
  updatedAt: string;
}

export interface OrganizationChoiceDto {
  organization: OrganizationDto;
  membership: MembershipDto;
}

export interface TenantContextDto {
  userId: string;
  organizationId: string;
  membershipId: string;
  role: Role;
  permissions: string[];
}

export interface SessionDto {
  user: UserDto;
  tenant: TenantContextDto | null;
  organizations?: OrganizationChoiceDto[];
}

export type ErrorCode =
  'UNAUTHORIZED' | 'FORBIDDEN' | 'NOT_FOUND' | 'VALIDATION_ERROR' | 'CONFLICT' | 'INTERNAL_ERROR';

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    requestId: string;
    issues?: Array<{ path: string; message: string }>;
  };
}

export * from './commercial.js';
export * from './copilot.js';
export * from './integrations.js';
export * from './live-calls.js';
