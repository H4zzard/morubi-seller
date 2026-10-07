import { describe, expect, it } from 'vitest';
import { can, desktopNavigationForRole, permissionsForRole } from './index.js';

describe('permission matrix', () => {
  it('não permite gestão de membros ao seller', () => {
    expect(
      can({ role: 'SELLER', permissions: permissionsForRole('SELLER') }, 'membership.manage')
    ).toBe(false);
  });

  it('permite analytics ao manager sem settings', () => {
    const context = { role: 'MANAGER' as const, permissions: permissionsForRole('MANAGER') };
    expect(can(context, 'analytics.view')).toBe(true);
    expect(can(context, 'settings.manage')).toBe(false);
  });

  it('reserva promoção e remoção de owners ao próprio owner', () => {
    const admin = { role: 'ADMIN' as const, permissions: permissionsForRole('ADMIN') };
    const owner = { role: 'OWNER' as const, permissions: permissionsForRole('OWNER') };
    expect(can(admin, 'membership.manage')).toBe(true);
    expect(can(admin, 'membership.owner.manage')).toBe(false);
    expect(can(owner, 'membership.owner.manage')).toBe(true);
  });

  it('monta navegação por papel sem checks espalhados na UI', () => {
    expect(desktopNavigationForRole('SELLER')).not.toContain('analytics');
    expect(desktopNavigationForRole('OWNER')).toContain('settings');
  });

  it('permite leitura comercial a todos e restringe ingestão a admin e owner', () => {
    const seller = { role: 'SELLER' as const, permissions: permissionsForRole('SELLER') };
    const admin = { role: 'ADMIN' as const, permissions: permissionsForRole('ADMIN') };
    expect(can(seller, 'commercial.read')).toBe(true);
    expect(can(seller, 'commercial.ingest')).toBe(false);
    expect(can(admin, 'commercial.ingest')).toBe(true);
  });

  it('separates integration read and management by role', () => {
    const seller = { role: 'SELLER' as const, permissions: permissionsForRole('SELLER') };
    const manager = { role: 'MANAGER' as const, permissions: permissionsForRole('MANAGER') };
    const admin = { role: 'ADMIN' as const, permissions: permissionsForRole('ADMIN') };
    expect(can(seller, 'integration.read')).toBe(false);
    expect(can(manager, 'integration.read')).toBe(true);
    expect(can(manager, 'integration.manage')).toBe(false);
    expect(can(admin, 'integration.manage')).toBe(true);
  });

  it('reserva tooling de intelligence a admin e owner', () => {
    const manager = { role: 'MANAGER' as const, permissions: permissionsForRole('MANAGER') };
    const admin = { role: 'ADMIN' as const, permissions: permissionsForRole('ADMIN') };
    expect(can(manager, 'intelligence.read')).toBe(true);
    expect(can(manager, 'intelligence.dev.read')).toBe(false);
    expect(can(admin, 'intelligence.dev.read')).toBe(true);
  });
});
