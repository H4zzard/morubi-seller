import { _electron as electron, expect, test } from '@playwright/test';
import { join } from 'node:path';

test('boots the isolated Electron renderer and shows login', async () => {
  const environment: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) environment[key] = value;
  }
  delete environment.ELECTRON_RUN_AS_NODE;

  const launchOptions: Parameters<typeof electron.launch>[0] = {
    args: [join(process.cwd(), 'out/main/index.js')],
    env: environment
  };
  const executablePath = process.env.MORUBI_ELECTRON_EXECUTABLE_PATH;
  if (executablePath) launchOptions.executablePath = executablePath;
  const application = await electron.launch(launchOptions);

  try {
    const window = await application.firstWindow();
    const pageErrors: string[] = [];
    window.on('pageerror', (error) => pageErrors.push(error.message));
    await window.reload();

    await expect(window).toHaveTitle('Morubi');
    await expect(
      window.getByRole('heading', { name: 'Entrar no Morubi' }),
      `Renderer errors: ${pageErrors.join('; ') || 'none'}`
    ).toBeVisible();
  } finally {
    await application.close();
  }
});
