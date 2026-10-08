const requiredVariables = [
  'TEST_DATABASE_ADMIN_URL',
  'TEST_DATABASE_URL',
  'TEST_AUTH_DATABASE_URL'
] as const;

export interface TestDatabaseEnvironment {
  adminUrl: string;
  runtimeUrl: string;
  authUrl: string;
}

export function getTestDatabaseEnvironment(
  environment: NodeJS.ProcessEnv = process.env
): TestDatabaseEnvironment {
  const missing = requiredVariables.filter((name) => !environment[name]?.trim());

  if (missing.length > 0) {
    throw new Error(
      `PostgreSQL integration environment is not configured: missing ${missing.join(' / ')}`
    );
  }

  return {
    adminUrl: environment.TEST_DATABASE_ADMIN_URL!.trim(),
    runtimeUrl: environment.TEST_DATABASE_URL!.trim(),
    authUrl: environment.TEST_AUTH_DATABASE_URL!.trim()
  };
}
