# Captura real de Live Calls no Windows — Fase 9.5C

## Escopo operacional

Este slice detecta uma possível reunião do Google Meet no Chrome/Edge, exige confirmação e consentimento, cria/inicia a `LiveCallSession`, captura duas fontes separadas e encerra tudo com cleanup. Não abre STT, DeepSeek, Gemini, transporte de áudio ou gravação em disco.

## Configuração

Desktop:

```env
MORUBI_LIVE_CAPTURE_ENABLED=true
MORUBI_LIVE_DEV_SIMULATOR_ENABLED=false
MORUBI_LIVE_AUDIO_BUFFER_BYTES=4194304
MORUBI_MEETING_OBSERVATION_INTERVAL_MS=3000
```

API e tenant também precisam permitir Live Calls e detecção Meet. `LIVE_TRANSCRIPTION_ENABLED` deve continuar `false` nesta etapa. A sessão ativa persiste `transcription_mode=DISABLED` pela migration aditiva `0013_capture_without_stt.sql`.

## Observação de reuniões

`WindowsMeetingObservationProvider` executa um script PowerShell fixo, sem interpolação de entrada, para consultar processos com janela principal e `IsWindowVisible`. Somente PID, processo e título entram no `MeetingDetector`. O provider não acessa URL da aba, conteúdo da janela, DOM, pixels, câmera ou áudio.

Detecção por título é sempre uma sugestão com confirmação manual. Um navegador aberto não basta. Títulos de busca/ajuda e processos não suportados são rejeitados. O encerramento é detectável quando o processo candidato deixa de aparecer em três observações consecutivas; nesse caso as duas fontes são interrompidas.

## Microfone e loopback

- `LOCAL_MIC`: `navigator.mediaDevices.getUserMedia`, escolha de dispositivo, `MediaRecorder`, nível via `AnalyserNode`, mute/unmute, `devicechange` e fim de track.
- `SYSTEM_AUDIO`: lista explícita de fontes com `desktopCapturer`, autorização de uso único no main, `getDisplayMedia({audio:true, video:true})` e resposta `audio: 'loopback'` no `setDisplayMediaRequestHandler`.

Electron 44.5.1 declara loopback como suportado somente no Windows. A fonte visual é uma exigência técnica do Chromium/Electron: frames não são lidos nem persistidos e a track de vídeo é parada. O loopback pode conter sons de qualquer aplicativo do sistema e não equivale a isolamento do áudio do Meet.

## Segurança e cleanup

O main valida `webContents`, origem, sessão ativa, grant temporário e o ID exato selecionado. `contextIsolation`, sandbox, `nodeIntegration=false` e `webSecurity` permanecem ativos. Falha ou cancelamento de qualquer fonte para ambas, limpa buffers e leva a sessão a estado terminal. Logout e crash do renderer também encerram a sessão pelo main process.

## Estado de validação

Os contratos, gates, detector, buffers e cleanup possuem testes automatizados. O ambiente de implementação é macOS; portanto, Chrome/Edge, WASAPI loopback, headset, microfone interno, troca de dispositivo e negativas reais do Windows estão **PENDENTES DE VALIDAÇÃO HUMANA EM HARDWARE WINDOWS**. Testes com mocks não contam como essa validação.

A matriz por SO e arquitetura está em `docs/DESKTOP_COMPATIBILITY.md`. A implementação equivalente no macOS usa os mesmos contratos e lifecycle, com adapters nativos próprios; isso não substitui a validação real do Windows.
