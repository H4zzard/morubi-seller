'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import type { OrganizationChoiceDto } from '@morubi/contracts';
import { Button, MorubiMark } from '@morubi/ui';
import { apiClient, setActiveOrganizationId } from '../../lib/api';

export default function OnboardingPage() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const formValue = new FormData(event.currentTarget).get('name');
    const name = typeof formValue === 'string' ? formValue : '';
    try {
      const created = await apiClient.request<OrganizationChoiceDto>('/v1/organizations', {
        method: 'POST',
        body: JSON.stringify({ name })
      });
      setActiveOrganizationId(created.organization.id);
      router.push('/app');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível criar a organização.');
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="auth-page" style={{ gridTemplateColumns: '1fr' }}>
      <section className="auth-panel">
        <div className="auth-card">
          <MorubiMark />
          <div style={{ height: 28 }} />
          <h2>Configure sua organização</h2>
          <p>Este será o boundary seguro dos dados do seu time.</p>
          <form className="auth-form" onSubmit={(event) => void submit(event)}>
            <label className="field">
              Nome da empresa
              <input name="name" required minLength={2} maxLength={120} autoFocus />
            </label>
            {error ? <div className="form-error">{error}</div> : null}
            <Button disabled={pending}>{pending ? 'Criando…' : 'Criar organização'}</Button>
          </form>
        </div>
      </section>
    </main>
  );
}
