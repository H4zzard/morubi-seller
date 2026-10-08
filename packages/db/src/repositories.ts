import { randomUUID } from 'node:crypto';
import { and, asc, count, eq, sql } from 'drizzle-orm';
import type { OrganizationChoiceDto, Role } from '@morubi/contracts';
import {
  errors,
  slugifyOrganizationName,
  type AuditAction,
  type TenantContext
} from '@morubi/domain';
import { can, permissionsForRole } from '@morubi/permissions';
import type { MorubiDatabase } from './database.js';
import { auditLogs, memberships, organizations } from './schema.js';
import { setTenantContext, setUserContext } from './tenant.js';

function organizationDto(row: typeof organizations.$inferSelect) {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function membershipDto(row: typeof memberships.$inferSelect) {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

async function insertAudit(
  tx: Parameters<Parameters<MorubiDatabase['transaction']>[0]>[0],
  values: {
    organizationId: string;
    actorUserId: string;
    action: AuditAction;
    resourceType: string;
    resourceId: string;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  await tx.insert(auditLogs).values({ ...values, metadata: values.metadata ?? {} });
}

async function lockOrganizationMemberships(
  tx: Parameters<Parameters<MorubiDatabase['transaction']>[0]>[0],
  organizationId: string
): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${organizationId}::text, 0::bigint))`
  );
}

export async function resolveTenantContext(
  db: MorubiDatabase,
  userId: string,
  organizationId: string
): Promise<TenantContext | null> {
  return db.transaction(async (tx) => {
    await setTenantContext(tx, { userId, organizationId });
    const [membership] = await tx
      .select()
      .from(memberships)
      .where(and(eq(memberships.organizationId, organizationId), eq(memberships.userId, userId)))
      .limit(1);
    if (!membership) return null;
    return {
      userId,
      organizationId,
      membershipId: membership.id,
      role: membership.role,
      permissions: permissionsForRole(membership.role)
    };
  });
}

export class OrganizationRepository {
  public constructor(private readonly db: MorubiDatabase) {}

  public async listForUser(userId: string): Promise<OrganizationChoiceDto[]> {
    return this.db.transaction(async (tx) => {
      await setUserContext(tx, userId);
      const rows = await tx
        .select({ organization: organizations, membership: memberships })
        .from(memberships)
        .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
        .where(eq(memberships.userId, userId))
        .orderBy(asc(organizations.name));
      return rows.map((row) => ({
        organization: organizationDto(row.organization),
        membership: membershipDto(row.membership)
      }));
    });
  }

  public async createForUser(userId: string, name: string, requestedSlug?: string) {
    const organizationId = randomUUID();
    const slugBase = requestedSlug ?? slugifyOrganizationName(name);
    const slug = slugBase || `organization-${organizationId.slice(0, 8)}`;
    return this.db.transaction(async (tx) => {
      await setTenantContext(tx, { userId, organizationId });
      const [organization] = await tx
        .insert(organizations)
        .values({ id: organizationId, name, slug })
        .returning();
      if (!organization) throw new Error('Organization insert did not return a row');
      const [membership] = await tx
        .insert(memberships)
        .values({ organizationId, userId, role: 'OWNER' })
        .returning();
      if (!membership) throw new Error('Membership insert did not return a row');
      await insertAudit(tx, {
        organizationId,
        actorUserId: userId,
        action: 'organization.created',
        resourceType: 'organization',
        resourceId: organizationId,
        metadata: { initialRole: 'OWNER' }
      });
      await insertAudit(tx, {
        organizationId,
        actorUserId: userId,
        action: 'membership.created',
        resourceType: 'membership',
        resourceId: membership.id,
        metadata: { role: 'OWNER', source: 'onboarding' }
      });
      return {
        organization: organizationDto(organization),
        membership: membershipDto(membership)
      };
    });
  }

  public async getCurrent(context: TenantContext) {
    return this.db.transaction(async (tx) => {
      await setTenantContext(tx, context);
      const [organization] = await tx
        .select()
        .from(organizations)
        .where(eq(organizations.id, context.organizationId))
        .limit(1);
      return organization ? organizationDto(organization) : null;
    });
  }
}

export class MembershipRepository {
  public constructor(
    private readonly db: MorubiDatabase,
    private readonly context: TenantContext
  ) {}

  public async list() {
    return this.db.transaction(async (tx) => {
      await setTenantContext(tx, this.context);
      const rows = await tx
        .select()
        .from(memberships)
        .where(eq(memberships.organizationId, this.context.organizationId))
        .orderBy(asc(memberships.createdAt));
      return rows.map(membershipDto);
    });
  }

  public async addByUserId(userId: string, role: Role) {
    return this.db.transaction(async (tx) => {
      await setTenantContext(tx, this.context);
      if (role === 'OWNER' && !can(this.context, 'membership.owner.manage')) {
        throw errors.forbidden();
      }
      const [membership] = await tx
        .insert(memberships)
        .values({ organizationId: this.context.organizationId, userId, role })
        .returning();
      if (!membership) throw new Error('Membership insert did not return a row');
      await insertAudit(tx, {
        organizationId: this.context.organizationId,
        actorUserId: this.context.userId,
        action: 'membership.created',
        resourceType: 'membership',
        resourceId: membership.id,
        metadata: { role }
      });
      return membershipDto(membership);
    });
  }

  public async updateRole(membershipId: string, role: Role) {
    return this.db.transaction(async (tx) => {
      await setTenantContext(tx, this.context);
      await lockOrganizationMemberships(tx, this.context.organizationId);
      const [current] = await tx
        .select()
        .from(memberships)
        .where(
          and(
            eq(memberships.id, membershipId),
            eq(memberships.organizationId, this.context.organizationId)
          )
        )
        .limit(1);
      if (!current) throw errors.notFound();
      if (
        (current.role === 'OWNER' || role === 'OWNER') &&
        !can(this.context, 'membership.owner.manage')
      ) {
        throw errors.forbidden();
      }
      if (current.role === 'OWNER' && role !== 'OWNER') await this.assertAnotherOwner(tx);
      const [updated] = await tx
        .update(memberships)
        .set({ role, updatedAt: new Date() })
        .where(
          and(
            eq(memberships.id, membershipId),
            eq(memberships.organizationId, this.context.organizationId)
          )
        )
        .returning();
      if (!updated) throw errors.notFound();
      await insertAudit(tx, {
        organizationId: this.context.organizationId,
        actorUserId: this.context.userId,
        action: 'membership.role_changed',
        resourceType: 'membership',
        resourceId: membershipId,
        metadata: { from: current.role, to: role }
      });
      return membershipDto(updated);
    });
  }

  public async remove(membershipId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await setTenantContext(tx, this.context);
      await lockOrganizationMemberships(tx, this.context.organizationId);
      const [current] = await tx
        .select()
        .from(memberships)
        .where(
          and(
            eq(memberships.id, membershipId),
            eq(memberships.organizationId, this.context.organizationId)
          )
        )
        .limit(1);
      if (!current) throw errors.notFound();
      if (current.role === 'OWNER' && !can(this.context, 'membership.owner.manage')) {
        throw errors.forbidden();
      }
      if (current.role === 'OWNER') await this.assertAnotherOwner(tx);
      await tx
        .delete(memberships)
        .where(
          and(
            eq(memberships.id, membershipId),
            eq(memberships.organizationId, this.context.organizationId)
          )
        );
      await insertAudit(tx, {
        organizationId: this.context.organizationId,
        actorUserId: this.context.userId,
        action: 'membership.removed',
        resourceType: 'membership',
        resourceId: membershipId,
        metadata: { removedUserId: current.userId, previousRole: current.role }
      });
    });
  }

  private async assertAnotherOwner(
    tx: Parameters<Parameters<MorubiDatabase['transaction']>[0]>[0]
  ): Promise<void> {
    const [result] = await tx
      .select({ value: count() })
      .from(memberships)
      .where(
        and(
          eq(memberships.organizationId, this.context.organizationId),
          eq(memberships.role, 'OWNER')
        )
      );
    if (!result || result.value <= 1)
      throw errors.conflict('A organização precisa manter ao menos um owner.');
  }
}

export class AuditRepository {
  public constructor(
    private readonly db: MorubiDatabase,
    private readonly context: TenantContext
  ) {}

  public async record(
    action: AuditAction,
    resourceType: string,
    resourceId: string,
    metadata: Record<string, unknown> = {}
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await setTenantContext(tx, this.context);
      await insertAudit(tx, {
        organizationId: this.context.organizationId,
        actorUserId: this.context.userId,
        action,
        resourceType,
        resourceId,
        metadata
      });
    });
  }
}
