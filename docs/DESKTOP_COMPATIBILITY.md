# Compatibilidade global do Desktop Morubi

Esta matriz separa implementação de validação real. Testes automatizados e mocks não contam como validação de hardware.

| Plataforma        | Arquitetura                                | Detecção Meet                             | `LOCAL_MIC`           | `SYSTEM_AUDIO`                           | Background/tray        | Estado real                                                   |
| ----------------- | ------------------------------------------ | ----------------------------------------- | --------------------- | ---------------------------------------- | ---------------------- | ------------------------------------------------------------- |
| Windows 10        | x64                                        | Implementado (Chrome/Edge)                | Implementado          | Loopback Electron/WASAPI implementado    | Implementado           | Pendente de hardware Windows                                  |
| Windows 11        | x64                                        | Implementado (Chrome/Edge)                | Implementado          | Loopback Electron/WASAPI implementado    | Implementado           | Pendente de hardware Windows                                  |
| Windows 10/11     | ARM64                                      | Código compartilhado                      | Código compartilhado  | Dependente do Electron/driver ARM64      | Código compartilhado   | Build, instalação e hardware não validados                    |
| macOS 12 Monterey | Intel x64                                  | Legado opcional por metadata/CoreGraphics | Implementado          | Sem API nativa; fallback virtual externo | Implementado           | Hardware e componente de distribuição não validados           |
| macOS 13 Ventura  | Intel x64                                  | Legado opcional por metadata/CoreGraphics | Validado no host real | ScreenCaptureKit audio-only              | Validado anteriormente | Engine nativo com sinal real; fluxo humano no bundle pendente |
| macOS 14.0–14.1   | Intel/Apple Silicon                        | Mesmo adapter macOS                       | Código compartilhado  | ScreenCaptureKit audio-only              | Código compartilhado   | Sem hardware validado                                         |
| macOS 14.2+       | Intel/Apple Silicon conforme suporte do SO | Mesmo adapter macOS                       | Código compartilhado  | ScreenCaptureKit; Process Tap futuro     | Código compartilhado   | Process Tap ainda não implementado/validado                   |
| macOS 13+         | Apple Silicon                              | Mesmo adapter macOS                       | Código compartilhado  | Helper universal arm64 compilado         | Código compartilhado   | Instalação, permissão TCC e hardware arm64 não validados      |

## Arquitetura única

- `MeetingDetection`, `LiveCallSession` e `AudioCapture` expõem estados independentes; consentimento, buffers, heartbeat, contratos, autenticação, tenancy, RLS e cleanup são compartilhados.
- `WindowsMeetingObservationProvider` e `MacOSMeetingObservationProvider` adaptam somente a observação nativa.
- `MediaDevicesMicrophoneCaptureProvider` é compartilhado.
- `WindowsSystemAudioCaptureProvider` usa loopback do Electron/WASAPI; `MacOSNativeSystemAudioCaptureProvider` usa o helper ScreenCaptureKit pelo main. O adapter BlackHole permanece como fallback isolado.
- `BackgroundAppLifecycle` mantém a mesma política de tray, ocultação, startup opcional e encerramento explícito; Electron fornece os adapters nativos.

Meet, Zoom, Teams e Outro funcionam no início manual pela mesma `LiveCallSession`. Zoom e Teams não possuem observadores automáticos operacionais nesta fase. Para o Meet web, a próxima integração automática recomendada é uma extensão de navegador restrita a `meet.google.com` e ligada ao Desktop por Native Messaging; ela não está implementada nem classificada como validada.

## Segundo plano e consentimento

Fechar a janela oculta o Morubi em vez de encerrar o processo. Uma captura já autorizada continua ativa e o tray/menu bar passa a exibir esse estado. A captura termina somente por encerramento explícito da call, logout, encerramento real do aplicativo, revogação/falha da fonte ou crash. O ícone permite reabrir ou ocultar a janela, habilitar/desabilitar inicialização com o sistema e encerrar explicitamente.

Inicialização automática começa desabilitada e só muda por ação do usuário no menu do tray. Quando iniciado pelo login, o app permanece oculto. A sessão autenticada continua no storage seguro já existente; nenhuma credencial nova é persistida por este lifecycle.

## Recursos e desempenho

- polling padrão de janelas: 3 segundos, configurável entre 1 e 60 segundos;
- thumbnails macOS solicitadas em `0x0`, sem leitura ou retenção de frames;
- buffers de áudio: 4 MiB por padrão e 64 MiB de limite total configurável, divididos entre as fontes;
- chunks e métricas ficam em memória; áudio não vai ao backend nem ao disco nesta fase;
- sem STT, modelo local ou IA generativa no Desktop;
- ao fechar a janela, polling e uma eventual captura autorizada continuam; buffers permanecem limitados e somente em memória;
- o diagnóstico lê níveis por 1,5 segundo, descarta imediatamente o stream e não usa `MediaRecorder`, disco ou backend.
- medição curta no MacBookPro14,1/8 GB: conjunto Electron em 293–295 MiB sem captura e 359–360 MiB com captura dual oculta; CPU agregada de 9,1–9,8% durante dez segundos. Não é soak test nem SLA.

CPU, RAM, bateria, suspensão/retomada e estabilidade prolongada ainda exigem medições reais em cada classe de hardware. Em especial: Intel dual-core/8 GB, MacBook 2015/Monterey, Apple Silicon, Windows 10, Windows 11 e Windows ARM64.

## Limitações conhecidas

- Electron 44.5.1 oferece `audio: 'loopback'` somente no Windows. No macOS 13+, o Morubi usa ScreenCaptureKit diretamente; a permissão é exibida como Gravação da Tela embora nenhum output de vídeo seja registrado.
- No macOS 12, BlackHole continua sendo somente fallback de engenharia/licenciamento; ele captura todo áudio roteado e exige configuração externa.
- `SYSTEM_AUDIO` pode conter várias pessoas e outros aplicativos. Ele não identifica participantes; qualquer diarização futura deve usar `UNKNOWN` quando não houver confiança.
- O helper é universal, mas o bundle Electron Apple Silicon, a instalação e o hardware ainda não foram validados.
- Assinatura, notarização e prompts TCC podem alterar o comportamento entre desenvolvimento e bundle distribuído.
