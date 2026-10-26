import { CircleHelp, LockKeyhole, Mic, MonitorSpeaker, Power, Radio, Sparkles } from 'lucide-react';
import { Button } from '@morubi/ui';

export function HelpCenter({ onRerunOnboarding }: { onRerunOnboarding: () => void }) {
  return (
    <section className="help-center">
      <span className="morubi-eyebrow">Ajuda</span>
      <h1>Central de ajuda do Desktop</h1>
      <p>Orientações para configurar, acompanhar e encerrar uma call com controle explícito.</p>
      <div className="help-center__grid">
        <article>
          <LockKeyhole />
          <h2>Login e privacidade</h2>
          <p>
            Sua sessão fica no armazenamento seguro do sistema. O Morubi não inicia áudio sem sua
            confirmação.
          </p>
        </article>
        <article>
          <Radio />
          <h2>Detecção</h2>
          <p>
            Mantenha o aplicativo aberto ou na bandeja. Ao detectar uma reunião compatível, ele pede
            sua confirmação.
          </p>
        </article>
        <article>
          <Mic />
          <h2>Microfone</h2>
          <p>
            Se não houver sinal, confirme a entrada selecionada e a permissão nos ajustes de
            privacidade.
          </p>
        </article>
        <article>
          <MonitorSpeaker />
          <h2>Outros participantes</h2>
          <p>
            Use o teste de áudio. “Pronto” só aparece quando um sinal real da reunião foi
            comprovado.
          </p>
        </article>
        <article>
          <Sparkles />
          <h2>Iniciar o copiloto</h2>
          <p>
            Confira a reunião detectada, escolha o contexto e confirme o consentimento. A observação
            em segundo plano nunca inicia o copiloto sozinha.
          </p>
        </article>
        <article>
          <Power />
          <h2>Parar e sair</h2>
          <p>
            Fechar a janela mantém o Morubi na bandeja. Use “Encerrar call”, logout ou “Encerrar
            Morubi” para parar.
          </p>
        </article>
        <article>
          <CircleHelp />
          <h2>Problemas</h2>
          <p>
            Reconecte dispositivos removidos e execute novamente a configuração. Uma falha crítica
            encerra a captura.
          </p>
        </article>
      </div>
      <Button onClick={onRerunOnboarding}>Executar configuração novamente</Button>
    </section>
  );
}
