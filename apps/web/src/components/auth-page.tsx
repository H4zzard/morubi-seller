'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Button, MorubiMark } from '@morubi/ui';
import { authClient } from '../lib/auth-client';

function formString(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === 'string' ? value : '';
}

export function AuthPage({ mode }: { mode: 'login' | 'signup' }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const email = formString(form, 'email');
    const password = formString(form, 'password');
    const result =
      mode === 'signup'
        ? await authClient.signUp.email({ email, password, name: formString(form, 'name') })
        : await authClient.signIn.email({ email, password });
    setPending(false);
    if (result.error) {
      setError(result.error.message ?? 'Não foi possível autenticar.');
      return;
    }
    router.push(mode === 'signup' ? '/onboarding' : '/app');
  }

  return (
    <main className="auth-page">
      <section className="auth-story">
        <MorubiMark />
        <div>
          <span className="morubi-eyebrow">System of intelligence</span>
          <h1>Venda com contexto. Lidere com evidência.</h1>
          <p>
            O workspace que acompanha como o time vende e transforma cada interação em inteligência
            comercial acionável.
          </p>
        </div>
        <small style={{ color: 'var(--muted)' }}>Morubi · Fundação técnica</small>
      </section>
      <section className="auth-panel">
        <div className="auth-card">
          <h2>{mode === 'login' ? 'Acesse sua conta' : 'Crie sua conta'}</h2>
          <p>
            {mode === 'login'
              ? 'Continue para o workspace.'
              : 'Você será owner da nova organização.'}
          </p>
          <form className="auth-form" onSubmit={(event) => void submit(event)}>
            {mode === 'signup' ? (
              <label className="field">
                Nome
                <input name="name" required minLength={2} autoComplete="name" />
              </label>
            ) : null}
            <label className="field">
              Email
              <input name="email" type="email" required autoComplete="email" />
            </label>
            <label className="field">
              Senha
              <input
                name="password"
                type="password"
                required
                minLength={8}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              />
            </label>
            {error ? <div className="form-error">{error}</div> : null}
            <Button disabled={pending} type="submit">
              {pending ? 'Aguarde…' : mode === 'login' ? 'Entrar' : 'Criar conta'}
            </Button>
          </form>
          <div className="auth-switch">
            {mode === 'login' ? 'Ainda não tem conta? ' : 'Já possui conta? '}
            <Link href={mode === 'login' ? '/signup' : '/login'}>
              {mode === 'login' ? 'Começar agora' : 'Entrar'}
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
