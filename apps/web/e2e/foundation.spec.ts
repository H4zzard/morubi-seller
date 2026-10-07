import { expect, test } from '@playwright/test';

test('signup, onboarding, login and role-aware navigation', async ({ browser, page }) => {
  const unique = crypto.randomUUID();
  const ownerEmail = `owner-${unique}@example.test`;
  const sellerEmail = `seller-${unique}@example.test`;
  const password = 'Morubi-foundation-2026!';
  const organizationName = `Morubi E2E ${unique.slice(0, 8)}`;

  await page.goto('/signup');
  await page.getByLabel('Nome').fill('Owner E2E');
  await page.getByLabel('Email').fill(ownerEmail);
  await page.getByLabel('Senha').fill(password);
  await page.getByRole('button', { name: 'Criar conta' }).click();
  await expect(page).toHaveURL(/\/onboarding$/);

  await page.getByLabel('Nome da empresa').fill(organizationName);
  await page.getByRole('button', { name: 'Criar organização' }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByLabel('Organização ativa')).toContainText(organizationName);
  await expect(page.getByRole('link', { name: 'Playbook' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Membros' })).toBeVisible();

  await page.getByRole('link', { name: 'Contatos' }).click();
  await expect(page).toHaveURL(/\/app\/contacts$/);
  await expect(page.getByRole('heading', { name: 'Contatos' })).toBeVisible();
  await page.getByRole('link', { name: 'Oportunidades' }).click();
  await expect(page).toHaveURL(/\/app\/opportunities$/);
  await expect(page.getByRole('heading', { name: 'Oportunidades' })).toBeVisible();
  await page.getByRole('link', { name: /Configura/ }).click();
  await page.getByRole('link', { name: 'Integrações' }).click();
  await expect(page).toHaveURL(/\/app\/settings\/integrations$/);
  await expect(page.getByRole('heading', { name: 'Integrações' })).toBeVisible();
  await expect(page.getByText('CRM piloto pendente')).toBeVisible();

  const organizationId = await page.evaluate(() =>
    window.localStorage.getItem('morubi.activeOrganizationId')
  );
  expect(organizationId).toBeTruthy();

  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByLabel('Email').fill(ownerEmail);
  await page.getByLabel('Senha').fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByText(ownerEmail)).toBeVisible();

  const sellerContext = await browser.newContext();
  const sellerPage = await sellerContext.newPage();
  try {
    await sellerPage.goto('/signup');
    await sellerPage.getByLabel('Nome').fill('Seller E2E');
    await sellerPage.getByLabel('Email').fill(sellerEmail);
    await sellerPage.getByLabel('Senha').fill(password);
    await sellerPage.getByRole('button', { name: 'Criar conta' }).click();
    await expect(sellerPage).toHaveURL(/\/onboarding$/);

    const membershipStatus = await page.evaluate(
      async ({ email, tenantId }) => {
        const response = await fetch('http://localhost:4000/v1/memberships', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'content-type': 'application/json',
            'x-organization-id': tenantId
          },
          body: JSON.stringify({ email, role: 'SELLER' })
        });
        return response.status;
      },
      { email: sellerEmail, tenantId: organizationId! }
    );
    expect(membershipStatus).toBe(201);

    await sellerPage.evaluate((tenantId) => {
      window.localStorage.setItem('morubi.activeOrganizationId', tenantId);
    }, organizationId!);
    await sellerPage.goto('/app');
    await expect(sellerPage.getByText(sellerEmail)).toBeVisible();
    await expect(sellerPage.getByRole('link', { name: 'Análises' })).toHaveCount(0);
    await expect(sellerPage.getByRole('link', { name: 'Playbook' })).toHaveCount(0);
    await expect(sellerPage.getByRole('link', { name: 'Membros' })).toHaveCount(0);
    await expect(sellerPage.getByRole('link', { name: 'Configurações' })).toHaveCount(0);
  } finally {
    await sellerContext.close();
  }
});
