# Captura nativa de Live Calls no macOS — Fase 9.5H

## Decisão técnica

O fluxo canônico continua sendo `consentimento -> LiveCallSession -> captura dual -> heartbeat -> encerramento`. `MeetingDetection`, `LOCAL_MIC` e `SYSTEM_AUDIO` são capacidades independentes. Esta fase não habilita transporte de áudio, STT, Gemini, DeepSeek, Intelligence Engine nem gravação em disco.

No macOS 13+, `SYSTEM_AUDIO` usa um helper Swift próprio baseado em ScreenCaptureKit. O helper registra exclusivamente `SCStreamOutputType.audio`, configura PCM estéreo de 48 kHz, exclui o processo do Morubi e não registra output de vídeo. Ele observa o áudio reproduzido sem trocar a saída padrão, portanto o vendedor continua ouvindo normalmente. No Ventura, o sistema associa essa capacidade à permissão **Gravação da Tela**, apesar de o Morubi não ler, transmitir nem persistir pixels.

O Electron 44.5.1 não oferece `audio: 'loopback'` no macOS. O helper existe para manter o domínio, consentimento, lifecycle e buffers compartilhados sem mover captura privilegiada para o renderer. Main e helper usam stdin/stdout herdados, nonce aleatório de 256 bits por processo e `sessionId` exato. Mensagens têm schema e limites de tamanho; stderr técnico não chega à interface.

## Matriz nativa

| Sistema           | Caminho                                                                     | Estado                                                                           |
| ----------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| macOS 13 Ventura  | ScreenCaptureKit, output somente de áudio                                   | Implementado; sinal real provado em Intel 13.7.8                                 |
| macOS 14.0–14.1   | ScreenCaptureKit                                                            | Implementado, sem hardware validado                                              |
| macOS 14.2+       | Core Audio Process Tap disponível no SO; ScreenCaptureKit é o adapter atual | Process Tap auditado, não implementado nem validado                              |
| macOS 12 Monterey | ScreenCaptureKit não fornece output de áudio                                | Sem caminho nativo zero-config no SDK alvo; requer componente virtual licenciado |

O binário do helper é universal (`x86_64` + `arm64`) e tem deployment target 12.0, mas sua função de áudio falha fechada abaixo do macOS 13. Compilar uma fatia arm64 não equivale a validação física em Apple Silicon.

## Permissões e consentimento

- **Microfone:** solicitado depois que o usuário marca o consentimento da sessão e o backend confirma a `LiveCallSession`.
- **Gravação da Tela:** no macOS 13+, solicitada pelo sistema quando o helper inicia a captura de áudio. É necessária para `SYSTEM_AUDIO`, não para abrir Calls, criar a sessão, usar o microfone ou iniciar manualmente.
- **Detector legado:** também pode depender de Gravação da Tela, mas sua indisponibilidade nunca bloqueia o início manual.
- **Câmera, Automação e Acessibilidade:** não são usadas por esse engine.

Uma sessão não abre o helper antes do consentimento. A autorização IPC expira, é vinculada ao ID da sessão e é consumida uma vez. Encerrar, fazer logout, revogar consentimento, perder uma fonte ou sair de verdade para o helper e as duas fontes. Ocultar a janela mantém somente uma captura já autorizada e o menu bar indica o estado.

## Evidência real no Ventura

Host: MacBookPro14,1, Intel i5 dual-core, 8 GB, macOS 13.7.8. O probe otimizado reproduziu um som conhecido e mediu, sem escrever áudio:

- 349 sample buffers e 335.040 frames;
- 2.680.320 bytes PCM observados;
- 127 buffers não silenciosos;
- pico `0,20794` e RMS médio `0,00564`;
- 48 kHz, 2 canais;
- zero buffers de vídeo.

Uma execução anterior do protocolo streaming autenticado produziu cinco chunks, 1.605.120 bytes e pico `0,20859`, sem stderr. Medição curta do helper: aproximadamente 11 MiB de RSS máximo e zero swap. Isso comprova o engine no host, não uma reunião humana completa no `.app` assinado.

## Fallback preservado

O adapter `MacOSBlackHoleSystemAudioCaptureProvider` e seu inventário foram preservados para engenharia e para macOS 12. Eles não são selecionados quando o helper nativo está disponível. O Morubi não embute, baixa ou instala BlackHole: o projeto é GPL-3.0 e informa licenciamento separado para produtos não GPL. Qualquer driver integrado exigirá revisão jurídica, pacote assinado/notarizado, consentimento administrativo e rollback testado.

## Validação humana restante

No mesmo `/Applications/Morubi.app` que será usado no teste:

1. abra Calls e confirme que nenhuma fonte inicia antes de marcar o consentimento;
2. clique em **Iniciar copiloto**, autorize Microfone e Gravação da Tela quando o macOS pedir e reabra o app se solicitado;
3. reproduza áudio remoto em uma reunião e fale no microfone;
4. confirme chunks e níveis independentes em **Seu microfone** e **Áudio da reunião**, mantendo a audição normal;
5. oculte e reabra a janela e confirme continuidade;
6. encerre e confirme cleanup das duas fontes;
7. confirme em proxy/logs que apenas heartbeat e métricas sanitizadas saíram do Desktop.

Assinatura ad hoc pode mudar a identidade percebida pelo TCC a cada rebuild. Distribuição requer Developer ID estável, hardened runtime, notarização e repetição desse roteiro no artefato final.
