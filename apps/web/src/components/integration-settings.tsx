'use client';

import { useEffect, useState } from 'react';
import type { CRMIntegrationOverviewDto } from '@morubi/contracts';
import { apiClient } from '../lib/api';

export function IntegrationSettings() {
  const [data, setData] = useState<CRMIntegrationOverviewDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void apiClient
      .request<CRMIntegrationOverviewDto>('/v1/integrations/crm')
      .then(setData)
      .catch(() => setError('Não foi possível carregar as integrações.'));
  }, []);

  return (
    <section className="web-commercial integration-settings">
      <span className="morubi-eyebrow">Configurações</span>
      <h1>Integrações</h1>
      {error ? <p className="form-error">{error}</p> : null}
      {data?.providerSelectionRequired ? (
        <div className="integration-notice" role="status">
          <strong>CRM piloto pendente</strong>
          <p>
            O framework read-only está preparado, mas nenhum provider foi escolhido. Conexão, OAuth
            e webhooks permanecem desabilitados até essa decisão.
          </p>
        </div>
      ) : null}
      <div className="web-commercial-grid">
        {data?.connections.map((connection) => (
          <article className="web-commercial-card" key={connection.id}>
            <div className="integration-card__head">
              <strong>{connection.externalAccountName}</strong>
              <span className={`health-badge health-badge--${connection.health.toLowerCase()}`}>
                {connection.health}
              </span>
            </div>
            <span>
              {connection.provider} · {connection.status}
            </span>
            <small>
              {connection.contactCount} contatos · {connection.dealCount} oportunidades
            </small>
            <footer>
              {connection.lastSuccessfulSyncAt
                ? `Último sync ${new Date(connection.lastSuccessfulSyncAt).toLocaleString('pt-BR')}`
                : 'Ainda não sincronizado'}
            </footer>
          </article>
        ))}
      </div>
    </section>
  );
}
