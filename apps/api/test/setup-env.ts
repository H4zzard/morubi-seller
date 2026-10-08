import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';

export const apiEnvironmentFile = fileURLToPath(new URL('../.env', import.meta.url));

export function loadApiTestEnvironment(): void {
  const result = config({ path: apiEnvironmentFile, override: false, quiet: true });
  const error = result.error as NodeJS.ErrnoException | undefined;

  if (error && error.code !== 'ENOENT') {
    throw new Error(`Unable to load the API test environment from ${apiEnvironmentFile}`, {
      cause: error
    });
  }
}

loadApiTestEnvironment();
