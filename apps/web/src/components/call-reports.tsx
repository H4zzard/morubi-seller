'use client';

import { useEffect, useState } from 'react';
import type { CallReportDto } from '@morubi/contracts';
import { apiClient } from '../lib/api';

export function CallReports() {
  const [reports, setReports] = useState<CallReportDto[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void apiClient
      .request<CallReportDto[]>('/v1/call-reports')
      .then(setReports)
      .catch(() => setError('Não foi possível carregar os relatórios de calls.'));
  }, []);

  return (
    <section>
      <span className="morubi-eyebrow">Post-call intelligence</span>
      <h1>Calls analisadas</h1>
      <p>Relatórios estruturados com rastreabilidade até os turnos da transcrição.</p>
      {error ? <div className="desktop-error">{error}</div> : null}
      <div className="commercial-list">
        {reports.map((report) => (
          <article className="commercial-card" key={report.id}>
            <header>
              <strong>
                {report.currentRevision?.content.executiveSummary.value ?? 'Analisando call…'}
              </strong>
              <span className="role-pill">{report.status}</span>
            </header>
            {report.currentRevision ? (
              <p>
                {report.currentRevision.content.pains.length} dores ·{' '}
                {report.currentRevision.content.explicitNextSteps.length} próximos passos explícitos
              </p>
            ) : null}
          </article>
        ))}
        {!reports.length && !error ? <p>Nenhum relatório disponível.</p> : null}
      </div>
    </section>
  );
}
