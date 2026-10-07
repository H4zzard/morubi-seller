# Morubi CRM Copilot — texto e realtime

**Status:** Fase 5 implementada em 2026-10-06  
**Default:** shadow; entrega ao seller e feedback desligados por feature flag

## 1. Fluxo entregue

```text
Message -> CommercialEvent -> intelligence_jobs -> IntelligenceProcessor
        -> InterventionCandidate -> template or generation_jobs
        -> validated generated candidate -> delivery policy -> InterventionDelivery
        -> realtime_events -> SSE -> Electron main -> preload -> renderer
        -> viewed / dismissed / applied / feedback
```

A rota de fixture apenas ingere a mensagem/evento e enfileira o trabalho; inteligência não roda no request HTTP. O processo dedicado `apps/worker` reclama jobs por tenant com `FOR UPDATE SKIP LOCKED`, tenta no máximo três vezes, usa backoff e mantém chaves idempotentes. Falha de inteligência ou geração não desfaz nem bloqueia a conversa.

## 2. Delivery policy

Somente candidata `MATCHED`, `ALLOW`, em modo visible e com realtime habilitado pode virar card. `GENERATION_REQUIRED` nunca é entregue diretamente: a Fase 6 pode convertê-la em `MATCHED` com `source=GENERATED` somente após sanitização, validação, staleness e cost policy. Prioridade padrão: risco crítico (100), objeção (80), buying signal (60), discovery gap (50), próximo passo (40) e informação (20). Informação neutra é sempre suprimida.

`IntelligenceSettings` controla `maxCardsPerWindow`, `cardWindowSeconds`, `cooldownSeconds`, `minimumPriority`, `deliveryTtlSeconds`, `realtimeEnabled` e `feedbackEnabled`. O policy aplica limite por janela, cooldown/deduplicação por categoria e chave. O card corrente é o elegível de maior prioridade; expirados deixam de ser atuais.

Estados persistidos: `CREATED`, `DELIVERED`, `VIEWED`, `DISMISSED`, `APPLIED`, `EXPIRED`. Aplicação é sempre ação explícita do seller; copiar sugestão não marca uso automaticamente. Feedback `HELPFUL|NOT_HELPFUL` é separado da decisão e não reescreve output, estado ou memória.

## 3. Realtime

`GET /v1/realtime/events` usa SSE autenticado por cookie e seleção de tenant validada no servidor. O cursor fica em `Last-Event-ID`, nunca na URL. A outbox `realtime_events` permite replay após reconnect; envelopes têm `id`, `version`, `type`, `occurredAt`, `correlationId`, `conversationId`, `dealId` e `payload`.

No Electron, apenas o main process lê a sessão cifrada e abre a conexão. Ele aplica backoff exponencial de 1–30 s, preserva o último ID, valida cada envelope com Zod e envia somente dados validados por canais IPC fixos. O preload oferece bridge mínima e remove listeners ao desmontar; renderer nunca recebe cookies/tokens. Não há notificação do sistema operacional.

## 4. Seller UX

Conversas usam três colunas: lista com contato/empresa/oportunidade/estado/atenção e unread persistido por membership, timeline paginada com remetente/horário/origem e placeholder de áudio, e painel contextual. O painel expõe resumo, oportunidade, estado, dores, objeções, decisores, próximo passo, memória e `MorubiCopilotPanel` — sem provider, policy reason, confidence numérica ou metadados internos.

Estados do painel: `IDLE`, `ANALYZING`, `INSIGHT_READY`, `INTERVENTION_READY`, `SUPPRESSED`, `ERROR`. `SUPPRESSED` existe no contrato interno e nunca é mostrado como falha ao seller. O produto é zero-prompt: não há chat genérico nem composer de produção.

## 5. Ownership e tenancy

Seller só lista/abre deals e conversas cujo `deals.owner_membership_id` corresponde à membership ativa. Contexto, delivery, lifecycle, feedback e stream ainda exigem o alvo da própria membership. OWNER/ADMIN/MANAGER mantêm leitura organizacional nesta fase. Não existe vínculo membership-equipe implementado; portanto o futuro escopo de manager por equipe é um gate explícito, não uma regra simulada.

Todas as novas tabelas têm `organization_id`, FKs tenant-consistentes, índices tenant-first e RLS `ENABLE + FORCE`. O organization ID enviado pelo cliente continua sendo apenas seleção; sessão e membership resolvem a autoridade.

## 6. Fixtures e operação

`/app/dev/conversations` é OWNER/ADMIN e oferece shadow/visible, feedback, sete cenários sintéticos e telemetria. Cenários: preço, concorrente, timing, decisor, buying signal, rejeição e neutral. Não existe endpoint para criar uma intervenção manualmente.

Flags:

- `REALTIME_ENABLED=false` — kill switch do stream;
- `SELLER_FEEDBACK_ENABLED=false` — default do feedback quando não há setting do tenant;
- `SHADOW_MODE=true` e `INTERVENTIONS_VISIBLE=false` — default de entrega;
- `INTELLIGENCE_DEV_UI` / `NEXT_PUBLIC_INTELLIGENCE_DEV_UI` — acesso ao laboratório.

## 7. Observabilidade e avaliação

Logs correlacionam request, job, evento, decisão e delivery; delivery persiste `end_to_end_latency_ms`. Analytics expõe contagens de lifecycle/feedback, p50/p95 e `false_card_rate = NOT_HELPFUL / (HELPFUL + NOT_HELPFUL)`. O harness offline agora exporta JSON/CSV com esperado, detectado e “seria entregue em visible” para revisão humana. Todo conteúdo é sintético.

## 8. Geração integrada na Fase 6

Se não há template adequado, a candidata cria um `generation_job` idempotente. Enquanto ele está pendente, o painel pode exibir apenas “Analisando contexto...”. O seller nunca vê provider/model, prompt, rationale interno ou erro técnico. Falha, output inválido/inseguro, budget excedido e staleness resultam em supressão silenciosa; a delivery policy da Fase 5 continua sendo a última barreira.

A inspeção autorizada de desenvolvimento mostra resumo sanitizado, estratégia, provider/model, output, validação, custo e latência. O fluxo completo e seus gates estão em `GENERATIVE_INTELLIGENCE.md`.

## 9. Áudio assíncrono na Fase 7

A timeline substitui o placeholder por player compacto carregado sob demanda via Electron main/API autorizada, status, duração e transcript expansível. Enquanto o job está pendente mostra processamento; falha é amigável e não expõe provider. Depois da promoção, Copilot recebe o mesmo `CommercialEvent` textual e não precisa conhecer o STT.

O laboratório dev adiciona cinco áudios sintéticos e consulta asset/job/transcript. `AUDIO_INTELLIGENCE_ENABLED` e `GEMINI_TRANSCRIPTION_ENABLED` permanecem false por default. Detalhes: `AUDIO_INTELLIGENCE.md`.

## 10. Limites

CRM real continua bloqueado por seleção de provider (Fase 3B). DeepSeek e Gemini ficam desligados por default e não foram exercitados com credenciais reais. Não há calls, Meet/Zoom/Teams, captura de desktop/microfone, streaming, diarização, detecção automática de aplicação, envio automático ou probabilidade numérica de fechamento. SSE usa polling curto da outbox; escala multi-instância pode adicionar `LISTEN/NOTIFY` ou broker sem mudar o contrato durável.

## 11. Extensão Live Calls da Fase 8

A Fase 8 reutiliza este mesmo delivery/outbox/SSE para turns finais de call. Cards carregam `liveCallSessionId`/`liveTranscriptTurnId`, têm TTL curto, expiram o card anterior da sessão e são rejeitados quando a sequência já ficou stale. A área Calls e o modo compacto recebem o mesmo envelope validado pelo Electron main.

Meet/Zoom nesta fase significam adapters de detecção e simulator, não integração automática com aplicativos reais. Há adapter autorizado de microfone, mas ele ainda não está ligado a STT streaming externo; áudio do sistema, Teams e diarização seguem pendentes. Consulte `LIVE_CALLS.md`.
