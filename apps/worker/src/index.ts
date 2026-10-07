import 'dotenv/config';
import { parseWorkerEnv } from '@morubi/config';
import { createDatabase } from '@morubi/db';
import { WorkerRuntime } from './runtime.js';
import { MorubiWorkerService, type WorkerLogger } from './service.js';

const env = parseWorkerEnv(process.env);
const database = createDatabase(env.DATABASE_URL);
const coordinatorDatabase = createDatabase(env.DATABASE_ADMIN_URL ?? env.DATABASE_URL);
const logger: WorkerLogger = {
  info(value, message) {
    if (env.LOG_LEVEL !== 'silent')
      console.log(JSON.stringify({ level: 'info', message, ...value }));
  },
  error(value, message) {
    if (env.LOG_LEVEL !== 'silent')
      console.error(JSON.stringify({ level: 'error', message, ...value }));
  }
};
const service = new MorubiWorkerService(database, coordinatorDatabase, env, logger);
const runtime = new WorkerRuntime(() => service.cycle(), env.WORKER_POLL_INTERVAL_MS);

let shutdownStarted = false;
async function shutdown(signal: string): Promise<void> {
  if (shutdownStarted) return;
  shutdownStarted = true;
  logger.info({ signal }, 'Worker graceful shutdown started');
  await runtime.stop();
  await database.close();
  await coordinatorDatabase.close();
  logger.info({ signal }, 'Worker graceful shutdown completed');
}

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

try {
  await runtime.start();
} catch (error) {
  logger.error({ errorCode: error instanceof Error ? error.name : 'UNKNOWN' }, 'Worker failed');
  await database.close();
  await coordinatorDatabase.close();
  process.exitCode = 1;
}
