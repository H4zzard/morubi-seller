import { PlugZap } from 'lucide-react';
import Link from 'next/link';

export default function Page() {
  return (
    <section className="web-commercial">
      <span className="morubi-eyebrow">Sistema</span>
      <h1>Configurações</h1>
      <div className="web-commercial-grid">
        <Link className="web-commercial-card" href="/app/settings/integrations">
          <PlugZap aria-hidden size={20} />
          <strong>Integrações</strong>
          <span>Conexões de CRM, saúde e sincronizações.</span>
          <footer>Abrir configurações</footer>
        </Link>
      </div>
    </section>
  );
}
