# Live Calls — Fase 8 + baseline operacional 9.6

## 1. Escopo e estado

A Fase 8 adiciona calls ao vivo sem criar um segundo motor de inteligência:

```text
MeetingDetector -> LiveCallSession -> consentimento explícito
  -> LiveAudioCaptureProvider -> RealtimeTranscriptionProvider
  -> parcial (somente UI) / final (persistido)
  -> CommercialEvent(contentOrigin=CALL_TRANSCRIPT)
  -> intelligence_jobs(priority=100, source=LIVE_CALL)
  -> Intelligence Engine -> delivery/outbox/SSE -> desktop
```

O caminho operacional separa `MeetingDetection`, `LiveCallSession`, `AudioCapture` e `LiveTranscription`. O vendedor pode iniciar manualmente Meet, Zoom, Teams ou outra reunião mesmo quando nenhum detector automático estiver disponível. Após consentimento, `LOCAL_MIC` e `SYSTEM_AUDIO` são capturados em streams separados. No Windows, sistema usa loopback; no macOS 13+, um helper nativo ScreenCaptureKit entrega somente áudio pelo main process. Com autorização adicional de transcrição e os gates habilitados, PCM normalizado segue por WebSocket binário autenticado até o adapter Gemini no backend. Sem provider, a captura local continua disponível e nenhum áudio sai do dispositivo. Fixtures ficam atrás de flags exclusivas de desenvolvimento.

## 2. Modelo canônico

`LiveCallSession` é a raiz do agregado: tenant, seller, provider, vínculos opcionais com deal/contact/conversation/calendar, lifecycle, captura, transcrição, fase, memória incremental, heartbeat e evidência de detecção. A sessão pode existir sem deal e receber contexto depois por `PATCH /v1/live-calls/:id/context`; um turno final só cria job de inteligência quando há deal associado.

Estados: `DETECTED -> READY|STARTING -> ACTIVE -> ENDING -> ENDED`, com terminais `FAILED` e `CANCELLED`. Transições inválidas e turnos após o encerramento são rejeitados. Uma unique parcial permite no máximo uma sessão `STARTING|ACTIVE|ENDING` por seller e tenant.

## 3. Detecção de reunião e início manual

`MeetingProviderAdapter` isola fornecedores. Meet exige o host HTTPS exato `meet.google.com` quando uma URL está legitimamente disponível. Para navegadores externos no Windows, `WindowsMeetingObservationProvider` lê somente PID, nome do processo, título da janela principal e visibilidade via PowerShell/Win32; não presume acesso à URL, DOM, pixels ou áudio.

Chrome e Edge são elegíveis no Windows; Chrome, Beta e Canary são elegíveis no macOS. Processo, visibilidade e formato do título precisam trazer evidência compatível com Meet. Navegador comum, título ambíguo, janela oculta e lookalikes conhecidos são rejeitados. Como título não confirma URL nem participação efetiva, toda detecção desse provider exige confirmação manual. No macOS, esse observador é legado e opcional porque títulos fornecidos pelo `desktopCapturer` dependem de Gravação da Tela.

O modo manual usa o mesmo endpoint, agregado e lifecycle da detecção automática, com `detectionEvidence=MANUAL`. Flags de detector não bloqueiam uma sessão manual; a flag de captura, o consentimento por sessão e os gates de mídia continuam obrigatórios. Falha ou ausência do detector não encerra uma captura ativa.

### Comparação para detecção do Meet no navegador

| Alternativa                                                            | Privilégio/atrito                                                              | Confiabilidade                                       | Decisão                                             |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------- | --------------------------------------------------- |
| Título de janela/processo                                              | Baixo no Windows; exige Gravação da Tela no macOS                              | Heurística, não comprova host nem participação       | Manter como adapter legado opcional                 |
| Atividade de áudio                                                     | Não exige acesso ao navegador                                                  | Não distingue reunião de música, vídeo ou alerta     | Rejeitada como confirmação                          |
| Agenda                                                                 | Integração autorizada com calendário                                           | Indica evento, não que a reunião esteja aberta       | Apenas contexto futuro                              |
| Extensão com permissão restrita a `meet.google.com` + Native Messaging | Instalação administrada e consentimento do navegador; sem histórico irrestrito | Comprova aba/host do Meet sem ler conversa ou pixels | Caminho recomendado para detecção automática futura |
| Início manual                                                          | Nenhuma permissão de vídeo ou navegador                                        | Ação explícita do vendedor                           | Fallback operacional implementado agora             |

A extensão ainda não está implementada nesta fase. Quando aberta, ela deve apenas publicar presença/estado mínimo de uma aba autorizada para um host permitido ao adapter canônico; não deve transportar áudio, DOM de conversas ou lógica comercial. Zoom desktop e Teams devem ter adapters próprios equivalentes, sem usar mera reprodução de áudio como detecção.

## 4. Captura, consentimento e indicador

`LiveAudioCaptureProvider` define start/pause/resume/stop/health e chunks com sequência, fonte, MIME e duração. O microfone usa `getUserMedia` e Web Audio para produzir PCM, suporta dispositivo explícito, observa mute, fim de track e remoção do dispositivo e mede nível sem interpretar silêncio como fala.

No Windows, o áudio remoto usa `getDisplayMedia` e o `session.setDisplayMediaRequestHandler` disponível no Electron 44.5.1. O usuário escolhe uma fonte retornada por `desktopCapturer`; o main valida renderer, origem, sessão ativa, consentimento temporário e ID exato antes de responder com vídeo técnico e `audio: 'loopback'`. A track de vídeo é interrompida sem leitura de frames. Loopback representa todo áudio reproduzido no sistema, não somente o Meet.

No macOS Ventura, o Electron 44.5.1 não suporta `audio: 'loopback'`. O adapter chama um helper Swift universal que usa ScreenCaptureKit, registra somente output de áudio e não altera a saída do sistema. A permissão do SO aparece como Gravação da Tela; ela pertence à captura de `SYSTEM_AUDIO`, não ao detector nem ao módulo Calls inteiro. O macOS 12 não fornece esse output e permanece bloqueado por um componente virtual licenciado. O fallback BlackHole foi preservado, mas não é distribuído pelo Morubi.

O início exige `CallConsentRecord` com `LOCAL_MIC` e `SYSTEM_AUDIO`. A simples abertura da tela, uma detecção ou a seleção da plataforma não concede acesso à mídia. Auto-start é `false`; política organizacional só é aceita se habilitada. O indicador de captura permanece visível durante a sessão. Se uma fonte falhar, ambas são paradas e a sessão é encerrada; logout, encerramento real e crash também revogam grants e limpam tracks. Ocultar a janela preserva a captura já autorizada. Retenção de áudio bruto live é zero.

## 5. Backpressure, heartbeat e reconexão

`BoundedAudioBuffer` divide o limite local configurável entre as duas fontes, descarta chunks antigos sob pressão e conta drops. Heartbeats levam somente métricas: bytes, chunks, drops, idade do último chunk, níveis, mute e falhas. Quando autorizado, `LiveAudioChunk.data` cruza IPC validado até o Electron main e segue em frames binários pelo WebSocket; não passa por HTTP/JSON/base64. O worker encerra sessões ativas com heartbeat stale.

## 6. Transcrição realtime e turnos

`RealtimeTranscriptionProvider` é separado do `TranscriptionProvider` assíncrono da Fase 7. O provider real implementado é Gemini Live Transcription, aberto somente na API quando os três gates e a credencial existem. Cada fonte recebe um stream independente; o Desktop nunca recebe a chave. Sessões do provider são renovadas aos nove minutos para respeitar o limite oficial de dez minutos.

A decisão de transporte é backend-controlled para sessão, autorização, billing, observabilidade e persistência de turns. O desktop nunca recebe chave secreta de STT. Um token efêmero autorizado pelo backend pode ser avaliado no adapter futuro se reduzir latência sem perder esses controles.

Parciais alimentam apenas a UI e podem ser revisados. Um final substitui o parcial pelo ID estável e é persistido idempotentemente. Nesta fase ele usa `emitCommercialEvent=false`: não cria evento, job, decisão, coaching ou relatório. `LOCAL_MIC` é vendedor; `SYSTEM_AUDIO` é participante remoto não identificado. Gemini Live não oferece diarização do canal remoto. Detalhes e gates estão em `docs/LIVE_TRANSCRIPTION.md`.

## 7. Memória, fases e Copilot

A memória incremental mantém fase, dores, objeções, perguntas abertas, buying signals, ações do seller, última intervenção e sequência. Listas são pequenas e deduplicadas; updates antigos não regressam a memória.

O detector de fase é heurístico e persiste origem/confidence. Cards live usam TTL curto, session/turn IDs, expiram cards anteriores e rejeitam turnos obsoletos. Geração live possui gate próprio desligado; por default o caminho reutiliza decisão, policy e templates existentes.

## 8. Desktop, início manual e modo compacto

A área Calls possui estados aguardando, detectada, consentimento, ativa e encerrada. No estado aguardando, `Iniciar copiloto` permite escolher Google Meet, Zoom, Microsoft Teams ou Outra reunião. A tela mostra duração e sinal/chunks reais das duas fontes. O modo compacto usa a mesma janela e pode ser always-on-top por ação do usuário.

O simulator dev permanece isolado por `MORUBI_LIVE_DEV_SIMULATOR_ENABLED`, só pode aparecer fora de produção e fica desligado por padrão. Quando `MORUBI_LIVE_CAPTURE_ENABLED=true`, a tela Calls usa o observador e os providers reais.

## 9. Persistência e tenancy

Migration `0008_freezing_the_call.sql` cria `live_call_sessions`, `call_consent_records`, `live_transcript_turns` e `call_usage`; adiciona referências live a eventos, usage, deliveries e outbox; e prioridade/deadline à fila existente.

As quatro tabelas possuem `organization_id`, FKs compostas tenant-consistentes, índices tenant-first, grants e RLS `ENABLE + FORCE`. Seller só gerencia a própria sessão; vínculos comerciais são validados no tenant e seguem ownership do deal.

## 10. Métricas e custo

`call_usage` registra duração, áudio processado, tokens de entrada/saída, origem da medição, decisões, gerações, cards, drops e custo em micros. Usage enviado pelo provider é marcado `ACTUAL`; até chegar, o servidor usa `LIVE_TRANSCRIPTION_COST_MICROS_PER_MINUTE` como estimativa. O cliente nunca informa preço. A migration aditiva `0014_live_transcription_usage.sql` preserva tenant, RLS e constraints existentes.

## 11. Flags seguras

Os gates do servidor começam `false`: `LIVE_CALLS_ENABLED`, `MEET_DETECTION_ENABLED`, `ZOOM_DETECTION_ENABLED`, `LIVE_TRANSCRIPTION_ENABLED`, `LIVE_COPILOT_ENABLED` e `LIVE_GENERATION_ENABLED`. O bundle Desktop habilita a captura local consentida por padrão, com `MORUBI_LIVE_CAPTURE_ENABLED=false` disponível como kill switch explícito; desenvolvimento local continua desabilitado sem opt-in. `MORUBI_LIVE_DEV_SIMULATOR_ENABLED` começa `false`. `MORUBI_LIVE_AUDIO_BUFFER_BYTES` limita memória local e `MORUBI_MEETING_OBSERVATION_INTERVAL_MS` controla polling. Settings equivalentes de call continuam tenant-scoped.

## 12. Limites antes de produção

- fornecer credencial server-side e validar Gemini Live com reunião humana autorizada;
- validar região, DPA, tratamento/retenção do provider e preço faturado;
- implementar purga e exclusão autorizada dos finais live e seus derivados;
- validar o observador Meet e o loopback em hardware Windows suportado;
- implementar Zoom sem acoplar a lógica comercial;
- implementar e validar a integração mínima com navegador para detecção automática de Meet sem permissão de vídeo;
- validar o fluxo manual completo, microfone e ScreenCaptureKit no bundle macOS com consentimento humano;
- validar permissões, assinatura/notarização e UX em Windows/macOS reais;
- avaliar diarização, WER, latência p95 e false-card rate com corpus autorizado;
- fazer soak/load de rede/provider e validar a renovação real de sessão.

Bot participante, gravação bruta, DeepSeek, coaching e IA comercial live não fazem parte desta entrega. A integração com navegador é o próximo passo de detecção, não uma dependência do início manual.

# Encerramento e pós-call

Encerrar uma sessão cria atomicamente o relatório `PROCESSING` e o job pós-call. O resultado chega por `call_report.ready`; falhas terminais usam `call_report.failed` e podem ser reenfileiradas sem trocar para uma role administrativa. O transcript canônico continua sendo `live_transcript_turns` com `is_final=true`.
