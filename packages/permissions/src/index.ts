import type { Role } from '@morubi/contracts';
import type { TenantContext } from '@morubi/domain';

export const permissions = [
  'organization.view',
  'organization.update',
  'membership.view',
  'membership.manage',
  'membership.owner.manage',
  'seller.useDesktop',
  'analytics.view',
  'playbook.manage',
  'settings.manage',
  'commercial.read',
  'commercial.ingest',
  'integration.read',
  'integration.manage',
  'intelligence.read',
  'intelligence.dev.read',
  'intervention.viewOwn',
  'intervention.feedbackOwn',
  'intelligence.dev.inspect'
] as const;

export type Permission = (typeof permissions)[number];

const rolePermissions: Record<Role, readonly Permission[]> = {
  SELLER: [
    'organization.view',
    'seller.useDesktop',
    'commercial.read',
    'intelligence.read',
    'intervention.viewOwn',
    'intervention.feedbackOwn'
  ],
  MANAGER: [
    'organization.view',
    'membership.view',
    'seller.useDesktop',
    'analytics.view',
    'commercial.read',
    'integration.read',
    'intelligence.read',
    'intervention.viewOwn',
    'intervention.feedbackOwn'
  ],
  ADMIN: [
    'organization.view',
    'organization.update',
    'membership.view',
    'membership.manage',
    'seller.useDesktop',
    'analytics.view',
    'playbook.manage',
    'settings.manage',
    'commercial.read',
    'commercial.ingest',
    'integration.read',
    'integration.manage',
    'intelligence.read',
    'intelligence.dev.read',
    'intervention.viewOwn',
    'intervention.feedbackOwn',
    'intelligence.dev.inspect'
  ],
  OWNER: [...permissions]
};

export function permissionsForRole(role: Role): readonly Permission[] {
  return rolePermissions[role];
}

export function can(
  context: Pick<TenantContext, 'role' | 'permissions'>,
  permission: Permission
): boolean {
  return (
    context.permissions.includes(permission) && rolePermissions[context.role].includes(permission)
  );
}

export function assertPermission(
  context: Pick<TenantContext, 'role' | 'permissions'>,
  permission: Permission
): void {
  if (!can(context, permission)) {
    const error = new Error('FORBIDDEN');
    error.name = 'PermissionDeniedError';
    throw error;
  }
}

export type NavigationItemKey =
  | 'home'
  | 'agenda'
  | 'conversations'
  | 'opportunities'
  | 'contacts'
  | 'calls'
  | 'coach'
  | 'analytics'
  | 'playbook'
  | 'settings';

const baseSellerNavigation: readonly NavigationItemKey[] = [
  'home',
  'agenda',
  'conversations',
  'opportunities',
  'contacts',
  'calls',
  'coach'
];

export function desktopNavigationForRole(role: Role): readonly NavigationItemKey[] {
  const items = [...baseSellerNavigation];
  if (role !== 'SELLER') items.push('analytics');
  if (role === 'ADMIN' || role === 'OWNER') items.push('playbook', 'settings');
  return items;
}
