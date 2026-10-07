'use client';

import { useEffect, useState, type ReactNode } from 'react';
import type { ContactSummaryDto, CursorPageDto, DealSummaryDto } from '@morubi/contracts';
import { apiClient } from '../lib/api';

export function ContactList() {
  const [data, setData] = useState<CursorPageDto<ContactSummaryDto> | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void apiClient
      .request<CursorPageDto<ContactSummaryDto>>('/v1/contacts')
      .then(setData)
      .catch(() => setError('Não foi possível carregar os contatos.'));
  }, []);
  return (
    <CommercialFrame eyebrow="Contexto comercial" title="Contatos" error={error}>
      {data?.items.map((contact) => (
        <article className="web-commercial-card" key={contact.id}>
          <strong>{contact.name}</strong>
          <span>
            {contact.jobTitle ?? 'Cargo não informado'}
            {contact.companyName ? ` · ${contact.companyName}` : ''}
          </span>
          <small>{contact.email ?? contact.phone ?? 'Sem email ou telefone'}</small>
          <footer>
            {contact.primaryProvider ?? 'manual'} · {contact.syncStatus}
          </footer>
        </article>
      ))}
    </CommercialFrame>
  );
}

export function DealList() {
  const [data, setData] = useState<CursorPageDto<DealSummaryDto> | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void apiClient
      .request<CursorPageDto<DealSummaryDto>>('/v1/deals')
      .then(setData)
      .catch(() => setError('Não foi possível carregar as oportunidades.'));
  }, []);
  return (
    <CommercialFrame eyebrow="Pipeline projetado" title="Oportunidades" error={error}>
      {data?.items.map((deal) => (
        <article className="web-commercial-card" key={deal.id}>
          <strong>{deal.title}</strong>
          <span>
            {deal.providerStageLabel ?? 'Etapa não informada'} · {deal.status}
          </span>
          <small>{deal.contactNames.join(', ') || 'Sem contato relacionado'}</small>
          <footer>
            {deal.amountMinor && deal.currency
              ? new Intl.NumberFormat('pt-BR', {
                  style: 'currency',
                  currency: deal.currency
                }).format(Number(deal.amountMinor) / 100)
              : 'Valor não informado'}
          </footer>
        </article>
      ))}
    </CommercialFrame>
  );
}

function CommercialFrame({
  eyebrow,
  title,
  error,
  children
}: {
  eyebrow: string;
  title: string;
  error: string | null;
  children: ReactNode;
}) {
  return (
    <section className="web-commercial">
      <span className="morubi-eyebrow">{eyebrow}</span>
      <h1>{title}</h1>
      {error ? (
        <p className="form-error">{error}</p>
      ) : (
        <div className="web-commercial-grid">{children ?? <p>Carregando…</p>}</div>
      )}
    </section>
  );
}
