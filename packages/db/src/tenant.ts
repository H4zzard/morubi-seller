import { sql, type SQL } from 'drizzle-orm';
import type { TenantContext } from '@morubi/domain';

interface SqlExecutor {
  execute(query: SQL): Promise<unknown>;
}

export async function setTenantContext(
  executor: SqlExecutor,
  context: Pick<TenantContext, 'userId' | 'organizationId'>
): Promise<void> {
  await executor.execute(
    sql`select set_config('app.current_user_id', ${context.userId}, true), set_config('app.current_organization_id', ${context.organizationId}, true)`
  );
}

export async function setUserContext(executor: SqlExecutor, userId: string): Promise<void> {
  await executor.execute(
    sql`select set_config('app.current_user_id', ${userId}, true), set_config('app.current_organization_id', '', true)`
  );
}
