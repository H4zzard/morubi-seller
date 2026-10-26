import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, listWorkerQueues, type DatabaseHandle } from '@morubi/db';
import { getTestDatabaseEnvironment } from './test-database-env.js';

const { adminUrl, workerCoordinatorUrl } = getTestDatabaseEnvironment();

describe('worker coordinator database boundary', () => {
  let admin: DatabaseHandle;
  let coordinator: DatabaseHandle;

  beforeAll(() => {
    admin = createDatabase(adminUrl);
    coordinator = createDatabase(workerCoordinatorUrl);
  });

  afterAll(async () => {
    await coordinator.close();
    await admin.close();
  });

  it('exposes only the queue snapshot needed for tenant-scoped processing', async () => {
    await expect(listWorkerQueues(coordinator.db)).resolves.toEqual(expect.any(Array));
    await expect(
      coordinator.pool.query('select id from organizations limit 1')
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      coordinator.pool.query('update generation_jobs set status = status where false')
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('keeps the coordinator function security-definer, fixed-path and non-public', async () => {
    const result = await admin.pool.query<{
      securityDefiner: boolean;
      configuration: string[] | null;
      publicCanExecute: boolean;
      workerCanExecute: boolean;
    }>(`
      select
        p.prosecdef as "securityDefiner",
        p.proconfig as configuration,
        exists (
          select 1
          from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
          where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
        ) as "publicCanExecute",
        has_function_privilege('morubi_worker', p.oid, 'EXECUTE') as "workerCanExecute"
      from pg_proc p
      where p.oid = 'public.morubi_worker_queue_snapshot()'::regprocedure
    `);
    expect(result.rows[0]).toMatchObject({
      securityDefiner: true,
      publicCanExecute: false,
      workerCanExecute: true
    });
    expect(result.rows[0]?.configuration).toContain('search_path=pg_catalog, public');
  });
});
