# Guia do Morubi Desktop

## Primeira configuração

1. Entre com sua conta Morubi.
2. Escolha **Configurar agora**.
3. Autorize a detecção de reuniões quando o sistema solicitar.
4. Escolha seu microfone, fale por alguns segundos e execute o teste.
5. Reproduza áudio na reunião e teste a segunda fonte.

O Morubi só mostra **pronto** depois de comprovar sinal nas duas fontes. O diagnóstico não grava, armazena nem envia o áudio. Se preferir continuar sem concluir, use **Fazer depois** e repita o assistente na opção **Ajuda**.

## Durante uma reunião

O Morubi observa apenas os metadados necessários para reconhecer uma possível reunião compatível. Uma notificação pode aparecer quando a janela principal estiver oculta. Abra o aplicativo, confira a reunião detectada e confirme o consentimento antes de iniciar qualquer captura.

O indicador do Morubi na bandeja do Windows ou na barra de menus do macOS informa quando uma captura autorizada está ativa. Fechar a janela apenas a oculta; não encerra uma call em andamento.

## Iniciar o copiloto

Abra a notificação, confira se a reunião detectada é a correta, escolha o contexto comercial disponível e leia a confirmação de consentimento. O copiloto só inicia após essa confirmação; a detecção em segundo plano nunca autoriza captura automaticamente. Nesta etapa, o fluxo mantém a transcrição e a inteligência sobre áudio desabilitadas.

## Como parar

Use **Encerrar captura** na call. Logout, **Encerrar Morubi**, perda da fonte de áudio ou uma falha crítica também encerram a captura e liberam os dispositivos. Apenas fechar a janela não é uma ação de parada.

## Privacidade

- Nenhuma captura começa automaticamente após a detecção.
- O consentimento é obrigatório para cada call.
- Nesta etapa, o áudio fica somente em buffers limitados na memória local.
- Não há envio ao backend, transcrição, STT ou IA sobre o áudio capturado.
- A fonte dos demais participantes pode incluir sons de outros aplicativos; feche conteúdos que não devem ser capturados.

## Solução de problemas

- **Reunião não detectada:** confirme que o navegador e a reunião são compatíveis e revise a permissão de detecção nos ajustes do sistema.
- **Microfone sem sinal:** confirme a entrada escolhida, a permissão e se outro aplicativo bloqueou o dispositivo.
- **Áudio da reunião indisponível:** execute novamente a configuração. Se nenhuma fonte aparecer no macOS, o instalador atual ainda não inclui o componente necessário; isso não deve ser corrigido com configuração manual pelo vendedor.
- **Dispositivo desconectado:** reconecte-o e reinicie a captura. Por segurança, a captura dual termina quando uma fonte obrigatória desaparece.
- **Aplicativo oculto:** clique no ícone do Morubi na bandeja ou barra de menus para reabrir.
