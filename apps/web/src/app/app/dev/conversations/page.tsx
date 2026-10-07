import { ConversationSimulator } from '../../../../components/conversation-simulator';

export default function ConversationDevPage() {
  return (
    <section>
      <div className="eyebrow">Ferramenta interna · admin only</div>
      <h1>CRM Copilot lab</h1>
      <p>Fixtures locais percorrem mensagem, evento, worker, política, outbox e desktop.</p>
      <ConversationSimulator />
    </section>
  );
}
