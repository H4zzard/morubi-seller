# Live Calls — Fase 8

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

O fluxo executável de desenvolvimento usa detecção, captura e transcrição fixture. Existe um adapter de microfone com `MediaDevices`/`MediaRecorder`, protegido pelo main process do Electron, mas ele não é conectado a um fornecedor STT real nesta fase. Captura de áudio do sistema, observação automática do SO e providers externos não são alegados como prontos.

## 2. Modelo canônico

`LiveCallSession` é a raiz do agregado: tenant, seller, provider, vínculos opcionais com deal/contact/conversation/calendar, lifecycle, captura, transcrição, fase, memória incremental, heartbeat e evidência de detecção. A sessão pode existir sem deal e receber contexto depois por `PATCH /v1/live-calls/:id/context`; um turno final só cria job de inteligência quando há deal associado.

Estados: `DETECTED -> READY|STARTING -> ACTIVE -> ENDING -> ENDED`, com terminais `FAILED` e `CANCELLED`. Transições inválidas e turnos após o encerramento são rejeitados. Uma unique parcial permite no máximo uma sessão `STARTING|ACTIVE|ENDING` por seller e tenant.

## 3. Detecção de reunião

`MeetingProviderAdapter` isola fornecedores. Meet exige o host HTTPS exato `meet.google.com`; Zoom aceita host `zoom.us`/subdomínio ou nome de processo conhecido. Lookalike hosts são rejeitados.

Não há varredura de janelas/processos no produto. O detector é uma camada pura e testada; o desktop oferece `FixtureMeetingDetector` no simulador. Um observador real de Windows/macOS deve ser implementado depois com permissões, distribuição assinada e testes por versão do SO.

## 4. Captura, consentimento e indicador

`LiveAudioCaptureProvider` define start/pause/resume/stop/health e chunks com sequência, fonte, MIME e duração. Há fixture determinística e adapter de microfone do renderer. A permissão do main process é de uso único por 30 segundos, somente áudio e somente para o `webContents` principal; request e check handlers são validados e a autorização é revogada em consumo, crash e fechamento. O pacote macOS declara `NSMicrophoneUsageDescription` e o main solicita `askForMediaAccess('microphone')` antes do gate interno.

O início exige `CallConsentRecord`. Auto-start é `false`; política organizacional só é aceita se habilitada. Áudio de sistema/mixagem ainda não tem adapter real. O indicador “Morubi está ouvindo esta call” permanece visível durante a sessão. Retenção de áudio bruto live é zero e nenhum chunk fixture é persistido.

## 5. Backpressure, heartbeat e reconexão

`BoundedAudioBuffer` tem limite tenant-configurável (default 4 MiB), descarta chunks antigos sob pressão e conta drops. O transporte consulta o head com `peek` e só remove após `acknowledge`, permitindo retry após desconexão. Heartbeats atualizam sessão/usage e recusam buffers acima do limite. O worker encerra sessões ativas com heartbeat stale. SSE mantém outbox durável e `Last-Event-ID`.

## 6. Transcrição realtime e turnos

`RealtimeTranscriptionProvider` é separado do `TranscriptionProvider` assíncrono da Fase 7. Não há credencial ou contrato de provider realtime configurado; o único executável é `FixtureRealtimeTranscriptionProvider`, determinístico e sem egress.

A decisão de transporte é backend-controlled para sessão, autorização, billing, observabilidade e persistência de turns. O desktop nunca recebe chave secreta de STT. Um token efêmero autorizado pelo backend pode ser avaliado no adapter futuro se reduzir latência sem perder esses controles.

Parciais podem alimentar UI, mas não criam evento, job ou decisão. Um final substitui o parcial idempotentemente e entra no pipeline comercial. `LiveTurnAggregator` une finais adjacentes do mesmo speaker sob limites de gap, caracteres e duração. Diarização real permanece pendente.

## 7. Memória, fases e Copilot

A memória incremental mantém fase, dores, objeções, perguntas abertas, buying signals, ações do seller, última intervenção e sequência. Listas são pequenas e deduplicadas; updates antigos não regressam a memória.

O detector de fase é heurístico e persiste origem/confidence. Cards live usam TTL curto, session/turn IDs, expiram cards anteriores e rejeitam turnos obsoletos. Geração live possui gate próprio desligado; por default o caminho reutiliza decisão, policy e templates existentes.

## 8. Desktop e modo compacto

A área Calls possui estados aguardando, detectada, ativa e encerrada; exibe consentimento, contexto, fase, duração, transcript, memória e guidance. O modo compacto usa a mesma janela, pode ser always-on-top por ação do usuário e não mostra transcript.

O simulator dev cria Meet/Zoom fixture, inicia com consentimento manual, emite roteiro parcial/final e encerra a sessão. Ele exige conversa vinculada a deal e fica indisponível em produção.

## 9. Persistência e tenancy

Migration `0008_freezing_the_call.sql` cria `live_call_sessions`, `call_consent_records`, `live_transcript_turns` e `call_usage`; adiciona referências live a eventos, usage, deliveries e outbox; e prioridade/deadline à fila existente.

As quatro tabelas possuem `organization_id`, FKs compostas tenant-consistentes, índices tenant-first, grants e RLS `ENABLE + FORCE`. Seller só gerencia a própria sessão; vínculos comerciais são validados no tenant e seguem ownership do deal.

## 10. Métricas e custo

`call_usage` registra duração, áudio processado, unidades, decisões, gerações, cards, drops e custo em micros. IDs live também chegam a `AIUsage`. O custo STT é calculado no servidor a partir da duração e `LIVE_TRANSCRIPTION_COST_MICROS_PER_MINUTE`; o cliente não informa preço. O detalhe expõe `speechToCardMs` quando há delivery.

## 11. Flags seguras

Todos começam `false`: `LIVE_CALLS_ENABLED`, `MEET_DETECTION_ENABLED`, `ZOOM_DETECTION_ENABLED`, `LIVE_TRANSCRIPTION_ENABLED`, `LIVE_COPILOT_ENABLED`, `LIVE_GENERATION_ENABLED` e `MORUBI_LIVE_CAPTURE_ENABLED`. Settings equivalentes existem por tenant.

## 12. Limites antes de produção

- escolher provider STT realtime, região, DPA, retenção e preço;
- implementar transporte streaming real e conectar captura com recuperação de rede;
- implementar observadores Meet/Zoom autorizados por SO;
- decidir captura de áudio remoto/sistema por plataforma;
- validar permissões, assinatura/notarização e UX em Windows/macOS reais;
- avaliar diarização, WER, latência p95 e false-card rate com corpus autorizado;
- aplicar migration/RLS no PostgreSQL e fazer soak/load com infraestrutura real.

Teams, bot participante, browser extension, gravação bruta, envio automático e Fase 9 não fazem parte desta entrega.
