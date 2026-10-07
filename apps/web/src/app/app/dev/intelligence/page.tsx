import { IntelligenceDecisions } from '../../../../components/intelligence-decisions';

export default function IntelligenceDevPage() {
  return (
    <section>
      <div className="eyebrow">Ferramenta interna · admin only</div>
      <h1>Intelligence e geração</h1>
      <p>
        Decisões, geração estruturada, validação, custo e latência para inspeção autorizada. Prompts
        completos e dados pessoais não são exibidos.
      </p>
      <IntelligenceDecisions />
    </section>
  );
}
