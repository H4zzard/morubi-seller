import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('login, tenant session, restart persistence, logout and subsequent login', async ({
  playwright
}) => {
  const unique = crypto.randomUUID();
  const email = `desktop-${unique}@example.test`;
  const password = `Desktop-${unique}`;
  const browser = await playwright.chromium.launch();
  const web = await browser.newPage();
  await web.goto('http://localhost:3000/signup');
  await web.getByLabel('Nome').fill('Desktop E2E');
  await web.getByLabel('Email').fill(email);
  await web.getByLabel('Senha').fill(password);
  await web.getByRole('button', { name: 'Criar conta' }).click();
  await expect(web).toHaveURL(/\/onboarding$/);
  await web.getByLabel('Nome da empresa').fill(`Desktop E2E ${unique.slice(0, 8)}`);
  await web.getByRole('button', { name: 'Criar organização' }).click();
  await expect(web).toHaveURL(/\/app$/);

  const profileDirectory = await mkdtemp(join(tmpdir(), 'morubi-desktop-e2e-'));
  const environment: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) environment[key] = value;
  }
  delete environment.ELECTRON_RUN_AS_NODE;
  environment.MORUBI_USER_DATA_DIR = profileDirectory;

  const launchOptions: Parameters<typeof electron.launch>[0] = {
    args: [join(process.cwd(), 'out/main/index.js')],
    env: environment
  };
  const executablePath = process.env.MORUBI_ELECTRON_EXECUTABLE_PATH;
  if (executablePath) launchOptions.executablePath = executablePath;
  let application = await electron.launch(launchOptions);

  try {
    let window = await application.firstWindow();
    const pageErrors: string[] = [];
    window.on('pageerror', (error) => pageErrors.push(error.message));
    await window.reload();

    await expect(window).toHaveTitle('Morubi');
    await expect(
      window.getByRole('heading', { name: 'Entrar no Morubi' }),
      `Renderer errors: ${pageErrors.join('; ') || 'none'}`
    ).toBeVisible();

    await window.getByLabel('Email').fill(email);
    await window.getByLabel('Senha').fill(password);
    await window.getByRole('button', { name: 'Entrar' }).click();
    await expect(window.getByText('API conectada')).toBeVisible();
    await expect(window.getByText('Desktop E2E')).toBeVisible();

    await application.close();
    application = await electron.launch(launchOptions);
    window = await application.firstWindow();
    await expect(window.getByText('API conectada')).toBeVisible();
    await expect(window.getByText('Desktop E2E')).toBeVisible();

    await window.getByRole('button', { name: 'Sair' }).click();
    await expect(window.getByRole('heading', { name: 'Entrar no Morubi' })).toBeVisible();
    await window.getByLabel('Email').fill(email);
    await window.getByLabel('Senha').fill(password);
    await window.getByRole('button', { name: 'Entrar' }).click();
    await expect(window.getByText('API conectada')).toBeVisible();
  } finally {
    await application.close();
    await browser.close();
    await rm(profileDirectory, { recursive: true, force: true });
  }
});
