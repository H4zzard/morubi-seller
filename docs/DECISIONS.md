# Morubi — Decision Log

ADRs simplificados. `MANDATED` deriva diretamente do brief; `PROPOSED` requer validação antes de compromisso irreversível; `DEFERRED` registra escolha conscientemente adiada.

## DEC-001 — Morubi não é um CRM

- **Status:** MANDATED
- **Decisão:** CRM externo continua system of record. Morubi é system of intelligence e mantém projeções e derivados.
- **Consequência:** evitar pipeline, CPQ, invoicing, marketing automation e automações genéricas próprias.

## DEC-002 — `CommercialEvent` é o fato comercial canônico

- **Status:** MANDATED
- **Decisão:** canais são normalizados para contrato versionado comum.
- **Consequência:** lógica de inteligência não depende do provider; raw provider event e domain event continuam conceitos separados.

## DEC-003 — Processamento é incremental

- **Status:** MANDATED
- **Decisão:** usar novo bloco lógico + contexto mínimo + estado/memória; histórico completo só por retrieval explícito.
- **Consequência:** menor custo/latência, exigindo reducers, summaries, provenance e versionamento.

## DEC-004 — JEV é a camada de decisão

- **Status:** MANDATED; implementação OPEN
- **Decisão:** JEV classifica, detecta sinais/risco e planeja ações estruturadas; não gera texto longo como responsabilidade principal.
- **Consequência:** contrato/version/evals próprios. Ainda é preciso definir se JEV já existe como modelo/serviço.

## DEC-005 — Geração é separada de decisão

- **Status:** MANDATED
- **Decisão:** LLM pesado é fallback ou workflow explícito para comunicação, síntese e raciocínio complexo.
- **Consequência:** Policy Engine pode vetar geração; templates cobrem intervenções comuns.

## DEC-006 — Mensagens formam blocos lógicos antes da análise

- **Status:** MANDATED
- **Decisão:** agregação/debounce varia por chat, áudio, live call e backfill.
- **Consequência:** decisão aponta para aggregate event e componentes; timers são reconstruíveis e idempotentes.

## DEC-007 — Playbook é versionado e publicação é humana

- **Status:** MANDATED
- **Decisão:** versão publicada é imutável; IA pode propor, nunca publicar automaticamente.
- **Consequência:** cada decisão/score registra playbook version; há draft/review/publish/rollback.

## DEC-008 — Multi-tenancy é shared schema com tenant explícito no MVP

- **Status:** PROPOSED
- **Decisão:** PostgreSQL compartilhado, `organization_id` obrigatório, repositories tenant-scoped e RLS como defesa em profundidade.
- **Alternativas:** database/schema por tenant.
- **Consequência:** operação inicial simples; testes cross-tenant são blocking e isolamento físico pode ser adicionado por requisito enterprise.

## DEC-009 — Começar com monólito modular e workers

- **Status:** PROPOSED
- **Decisão:** uma codebase com módulos de domínio; web/API, realtime e workers podem ter deploy separado.
- **Alternativa rejeitada agora:** microserviços por entidade.
- **Consequência:** transações e entrega simples; contratos/outbox permitem extração futura baseada em evidência.

## DEC-010 — TypeScript end-to-end e PostgreSQL

- **Status:** ACCEPTED
- **Decisão:** TypeScript estrito, Electron/React/Vite, Next.js, Fastify, Zod e PostgreSQL; Redis e storage ficam para fases que precisarem deles.
- **Consequência:** stack coerente para equipe pequena. ORM e providers permanecem decisões específicas.

## DEC-011 — Drizzle é o ORM da fundação

- **Status:** ACCEPTED
- **Decisão:** usar Drizzle com migrations SQL revisáveis, repositories tenant-scoped e RLS PostgreSQL.
- **Consequência:** Prisma não será introduzido em paralelo; SQL de policy/grant continua explícito.

## DEC-012 — Connectors usam adapters e capabilities

- **Status:** MANDATED
- **Decisão:** provider adapters implementam contratos comuns por capacidade; regras de negócio não importam SDK específico.
- **Consequência:** contract tests, canonical DTOs, mappings e runtime compartilhado.

## DEC-013 — Inbox/outbox e entrega at-least-once

- **Status:** PROPOSED
- **Decisão:** webhook é persistido antes do ack; mudança e outbox são transacionais; consumers são idempotentes.
- **Consequência:** tolera perda/duplicata sem exigir exactly-once fictício; exige DLQ/replay/reconciliação.

## DEC-014 — SSE padrão; WebSocket somente onde bidirecional

- **Status:** PROPOSED
- **Decisão:** SSE para cards/status, WebSocket para live call e polling como fallback.
- **Consequência:** menor complexidade fora do streaming, com event IDs/reconnect e auth periódica.

## DEC-015 — PostgreSQL é fonte de verdade; Redis é efêmero

- **Status:** PROPOSED
- **Decisão:** cache, rate limits, locks e timers podem usar Redis; estado oficial é persistente/reconstruível.
- **Consequência:** perda/eviction de Redis degrada performance, não apaga memória comercial.

## DEC-016 — Mídia fica em object storage privado

- **Status:** PROPOSED
- **Decisão:** banco guarda metadata; áudio/gravação/export ficam em storage com criptografia, lifecycle e URL assinada curta.
- **Consequência:** retenção e deleção precisam abranger objeto e derivados.

## DEC-017 — Scores são versionados, explicáveis e não autoritativos

- **Status:** MANDATED por princípio de produto
- **Decisão:** `DealScore`/`CallScore` mantêm fatores, evidências, confiança e scorecard version.
- **Consequência:** UI não mostra número sem contexto; mudança de fórmula cria versão e eval.

## DEC-018 — Outbound CRM é allowlisted e aprovado por política

- **Status:** PROPOSED
- **Decisão:** leitura antes de escrita; comandos externos usam idempotência, audit e human approval onde necessário.
- **Consequência:** reduz corrupção do system of record; UI representa pending/confirmed/conflict.

## DEC-019 — Observabilidade não armazena conteúdo por padrão

- **Status:** PROPOSED
- **Decisão:** logs/traces usam IDs e metadata redacted; prompt/output detalhado fica cifrado, restrito e sujeito a retenção separada.
- **Consequência:** debugging usa referências e acesso controlado, não dumps indiscriminados.

## DEC-020 — Uso de IA é um ledger atribuível

- **Status:** MANDATED
- **Decisão:** toda chamada registra provider/model, tokens/áudio, latência, custo e atribuição a tenant/feature/recurso.
- **Consequência:** quotas, unit economics e fallback podem ser governados desde o piloto.

## DEC-021 — Calls pós-call podem preceder live streaming

- **Status:** PROPOSED
- **Decisão:** validar importação, STT, summaries, consentimento e custos antes ou em paralelo controlado ao copilot live.
- **Consequência:** reduz risco técnico/jurídico e gera dataset; roadmap pode trocar parte das Fases 6 e 7.

## DEC-022 — Analytics gerencial exige evidência e amostra

- **Status:** MANDATED por princípio de produto
- **Decisão:** insights incluem período, coorte, sample size, confiança e drill-down autorizado; correlação não é chamada de causa.
- **Consequência:** mais trabalho de qualidade de dados, mas reduz recomendações gerenciais nocivas.

## DEC-023 — Nenhuma alegação de compliance sem validação

- **Status:** MANDATED
- **Decisão:** projetar capacidades para LGPD/segurança, submeter papéis/bases/contratos à revisão jurídica e certificações a auditoria formal.
- **Consequência:** linguagem de produto e vendas deve refletir o estado real.

## DEC-024 — Primeiro slice é tenancy, não IA

- **Status:** PROPOSED
- **Decisão:** primeira implementação entrega auth, organization/membership/roles, app shell e teste E2E de isolamento.
- **Consequência:** mitiga o maior risco sistêmico antes de ingerir dados sensíveis.

## DEC-025 — Electron é o cliente principal do seller

- **Status:** MANDATED
- **Decisão:** Home, Agenda, Conversas, Oportunidades, Contatos, Calls e Coach serão desktop-first.
- **Consequência:** capacidades nativas futuras ficam no main process/services; domínio continua no backend.

## DEC-026 — Web é a interface principal de manager/admin

- **Status:** MANDATED
- **Decisão:** Next.js atende onboarding, análises, playbook, membros e configurações.
- **Consequência:** seller não depende do web para seu fluxo diário; o web não vira backend de domínio.

## DEC-027 — Fastify é o backend dedicado

- **Status:** ACCEPTED
- **Decisão:** autenticação, autorização, tenancy, persistência, audit e domínio vivem em `apps/api` e packages de backend.
- **Consequência:** Electron e Next.js compartilham contratos HTTP, não regras críticas de negócio.

## DEC-028 — Sessão desktop é mediada pelo main process

- **Status:** ACCEPTED
- **Decisão:** no MVP email/senha, main chama Better Auth, guarda o cookie opaco e faz chamadas autenticadas; renderer recebe somente sessão sanitizada.
- **Consequência:** não há token em `localStorage`. OAuth/social futuro deverá usar browser do sistema + PKCE/deep link.

## DEC-029 — Secrets desktop usam `safeStorage`

- **Status:** ACCEPTED
- **Decisão:** cookie de sessão é cifrado com a primitiva do SO via Electron `safeStorage`, em arquivo privado no `userData`.
- **Consequência:** se criptografia não estiver disponível, persistência falha fechada; keytar pode ser reavaliado se requisitos enterprise exigirem credential store explícito.

## DEC-030 — IPC usa bridge tipada e allowlist fechada

- **Status:** ACCEPTED
- **Decisão:** channels centralizados; preload expõe métodos específicos; main valida sender e input Zod.
- **Consequência:** nenhum `ipcRenderer`, filesystem, process, cookie ou API Node genérica chega ao renderer.

## DEC-031 — Electron Vite e electron-builder formam o toolchain desktop

- **Status:** ACCEPTED
- **Decisão:** electron-vite separa main/preload/renderer, o preload sandboxed é emitido como CommonJS empacotado, e electron-builder prepara artefatos locais.
- **Consequência:** signing Windows e Developer ID/notarization macOS são gates obrigatórios antes de distribuição; auto-update não foi implementado.

## DEC-032 — RLS usa contexto transacional e papel restrito

- **Status:** ACCEPTED
- **Decisão:** a API usa `morubi_app`, sem ownership ou `BYPASSRLS`; `userId` e `organizationId` entram por `set_config(..., true)` dentro de cada transação tenant-scoped.
- **Consequência:** o contexto é compatível com pooling e não persiste ao devolver a conexão; migrations exigem credencial administrativa separada e testes exercitam repository, SQL direto e API.

## DEC-033 — Owner e audit têm invariantes reforçadas no data layer

- **Status:** ACCEPTED
- **Decisão:** somente owner gerencia owners; mutações de membership são serializadas por organização antes de validar o último owner; audit é append-only para o papel de runtime.
- **Consequência:** corridas concorrentes não deixam organização sem owner e a trilha básica não pode ser reescrita pela aplicação.

## DEC-034 — Identidade externa é forte e tenant-scoped

- **Status:** ACCEPTED
- **Decisão:** resolver entidades por `(organization_id, provider, external_workspace_id, entity_type, external_id)`; `connection_id` é opcional até existir uma conexão real.
- **Consequência:** múltiplos providers e workspaces coexistem; o mesmo ID em tenants diferentes não colide; email e telefone nunca disparam merge automático.

## DEC-035 — Proveniência bruta é separada da projeção

- **Status:** ACCEPTED
- **Decisão:** cada entrega aceita cria `source_records` append-only com payload, hash, tempos e chave de idempotência; a entidade canônica guarda apenas campos de produto e freshness.
- **Consequência:** reprocessamento e auditoria preservam história sem contaminar o modelo canônico. Retenção do payload bruto é gate de produção.

## DEC-036 — Participantes de conversa usam relação própria

- **Status:** ACCEPTED
- **Decisão:** `conversation_participants` representa contatos, memberships, participantes externos e sistema; `primary_contact_id` é um atalho opcional de leitura.
- **Consequência:** grupos e canais com múltiplos atores cabem no modelo sem transformar Conversation em relação 1:1.

## DEC-037 — Deals têm status canônico mínimo, não funil universal

- **Status:** ACCEPTED
- **Decisão:** somente `OPEN|WON|LOST` é canônico; ID e label da etapa do provider são preservados sem uma taxonomia universal antecipada.
- **Consequência:** read models funcionam para múltiplos CRMs e mapping de pipelines fica para a fase de connector real.

## DEC-038 — Eventos comerciais são imutáveis e corrigidos por supersessão

- **Status:** ACCEPTED
- **Decisão:** runtime pode inserir e ler `commercial_events`, não atualizar ou excluir; correção cria outro evento apontando `supersedes_event_id`.
- **Consequência:** a timeline é reproduzível e a origem da correção permanece explícita.

## DEC-039 — Arquivamento e tombstone precedem deleção física

- **Status:** ACCEPTED
- **Decisão:** contatos, deals e conversas usam `archived_at`; mensagens removidas na fonte usam `deleted_at`. Exclusão física é responsabilidade futura do workflow de retenção/LGPD.
- **Consequência:** listas read-only não exibem projeções arquivadas e a reconciliação não ressuscita silenciosamente conteúdo removido.

## Conflitos e tensões registrados

1. **Roadmap original sugere live antes de post-call:** validar pós-call primeiro pode reduzir risco; a sequência final depende do acesso técnico ao provider de reunião.
2. **`DealState.stage` versus CRM stage:** manter `deals.stage_id` como projeção autoritativa externa e `deal_states.stage_signal` como inferência, evitando duas “verdades”.
3. **“Tempo real” versus agregação:** debounce acrescenta atraso deliberado; SLO deve contar após bloco estável e ter fechamento antecipado para sinais urgentes.
4. **Admin versus conteúdo sensível:** administrar tenant não deve implicar ouvir todas as gravações; permissão de conteúdo é separada.
5. **Memória integral versus minimização:** long-term memory é capacidade, não licença para retenção infinita; política por classe governa o que permanece.

## Decisões ainda requeridas

- Cloud/região, RPO/RTO e SLO.
- Auth provider/MFA/SSO timeline.
- CRM/canal/design partner piloto.
- Definição e hosting do JEV.
- Providers de STT/LLM/embedding e termos de dados.
- Regras jurídicas de consentimento/retention.
- Pesos/semântica dos scores e campos outbound.

## DEC-040 — Provider piloto permanece bloqueante

- **Status:** ACCEPTED para esta execução; decisão de provider OPEN
- **Decisão:** como `PILOT_CRM_PROVIDER` permaneceu `<CRM_ESCOLHIDO>`, entregar somente o framework provider-agnostic e parar antes do adapter real.
- **Consequência:** nenhum CRM, OAuth, scope, webhook ou limitação externa foi inventado; a UI registra a pendência explicitamente.

## DEC-041 — Connector CRM é read-only e capability-based

- **Status:** ACCEPTED
- **Decisão:** `CRMConnector` contém apenas leituras de account, contacts, deals e capabilities opcionais; não há método outbound.
- **Consequência:** ausência de conversations, stages ou webhooks é representada honestamente e cada provider pode ter um adapter isolado.

## DEC-042 — Provider DTO termina no mapper

- **Status:** ACCEPTED
- **Decisão:** adapters convertem seus DTOs em records normalizados compostos por `SourceEnvelope` e inputs canônicos antes de chamar aplicação/data layer.
- **Consequência:** provider nunca chama repository e tipos de SDK não vazam para domain, DB ou UI.

## DEC-043 — Credencial usa referência opaca e cofre por interface

- **Status:** ACCEPTED; backend de produção DEFERRED
- **Decisão:** `crm_connections` armazena `secret_reference`; `CredentialStore` é a única interface para material secreto. A store em memória é exclusiva de testes.
- **Consequência:** AWS Secrets Manager, GCP Secret Manager ou Azure Key Vault podem ser conectados sem mudar o domínio. Nenhuma conexão real é liberada antes dessa implementação.

## DEC-044 — PostgreSQL rastreia jobs; BullMQ aguarda necessidade real

- **Status:** ACCEPTED
- **Decisão:** persistir solicitação, status, checkpoint e contadores em `sync_jobs`, separando request de execução. Não introduzir Redis/BullMQ sem provider ou workload reais.
- **Consequência:** invariantes e recuperação têm fonte durável; API de mutação e worker continuam desligados até existir executor operacional.

## DEC-045 — Checkpoint avança por página completa

- **Status:** ACCEPTED
- **Decisão:** watermark/cursor opacos avançam somente após todos os registros de uma página persistirem. Falha de registro produz `PARTIAL` e replay da página.
- **Consequência:** nenhum registro é perdido; itens já aceitos no replay são deduplicados por `source_records` e ordering da Fase 2.

## DEC-046 — Retry é classificado, limitado e consciente de rate limit

- **Status:** ACCEPTED
- **Decisão:** repetir `429`, `408` e `5xx` com exponencial, jitter e `Retry-After`; não repetir auth, scope, forbidden ou payload inválido cegamente.
- **Consequência:** erros sanitizados e contadores de retry ficam observáveis sem credenciais ou payload bruto em logs.

## DEC-047 — Webhook depende do protocolo real

- **Status:** DEFERRED
- **Decisão:** não criar endpoint, verifier ou `webhook_events` genéricos enquanto o provider não definir assinatura, event ID, replay window e ACK semantics.
- **Consequência:** polling/reconciliation e inbox serão adicionados conforme capability real, sem falsa segurança.

## DEC-048 — Disconnect preserva projeção e remove acesso futuro

- **Status:** ACCEPTED
- **Decisão:** disconnect marca a conexão, impede sync, apaga o secret pelo cofre e preserva histórico/projeções conforme política.
- **Consequência:** revogação remota fica no adapter; exclusão dos dados não é efeito colateral de desconectar.

## DEC-049 — Fixture é infraestrutura de teste, não provider

- **Status:** ACCEPTED
- **Decisão:** `FixtureCRMConnector` simula paginação, incremental, duplicata, ordering, archive, `429` e `500` e passa pela mesma contract suite dos adapters futuros.
- **Consequência:** CI é determinístico e não depende de sandbox externo; fixture não é registrado nem conectável em produção.

## DEC-050 — DealState usa current + revisions

- **Status:** ACCEPTED
- **Decisão:** um snapshot current por deal e revisões append-only por mudança, com evento, decisão, confiança e evidência.
- **Consequência:** leitura é barata e qualquer mudança pode ser reconstruída; lock/version impedem revisão concorrente silenciosa.

## DEC-051 — Estado muda somente por deltas allowlisted

- **Status:** ACCEPTED
- **Decisão:** provider sugere `SET|ADD|REMOVE|RESOLVE`; reducer determinístico valida campo/operação e produz snapshot.
- **Consequência:** output não substitui JSON arbitrariamente e versões de reducer podem ser avaliadas.

## DEC-052 — Memória é atômica, seletiva e supersedível

- **Status:** ACCEPTED
- **Decisão:** persistir somente fatos duráveis acima de threshold próprio; deduplicar valor ativo e preservar contradições por supersessão.
- **Consequência:** mensagem, evento, memória e estado mantêm responsabilidades distintas; memória não vira cópia de conversa.

## DEC-053 — DecisionProvider é o boundary da JEV

- **Status:** ACCEPTED; provider JEV real DEFERRED
- **Decisão:** domínio depende de input/output estruturado e metadata versionada. Sem contrato real, somente `FixtureDecisionProvider` é executável.
- **Consequência:** nenhuma API JEV foi inventada; adapter futuro passa pelo mesmo parser, policy, contract tests e evals.

## DEC-054 — Policy é determinística e posterior ao provider

- **Status:** ACCEPTED
- **Decisão:** thresholds separados governam objeção, risco, buying signal, intervenção, estado e memória. Resultados são persistidos com reason.
- **Consequência:** confiança do modelo não autoriza ação por si só; mudanças de policy têm versão própria.

## DEC-055 — Shadow mode é o default da inteligência

- **Status:** ACCEPTED
- **Decisão:** decisões, estado permitido, memória e candidatas podem ser registrados, mas intervenções não são visíveis ao seller.
- **Consequência:** false-card rate e calibração podem ser medidos antes da Fase 5.

## DEC-056 — Override organizacional precede template global

- **Status:** ACCEPTED
- **Decisão:** matching seleciona template ativo mais novo do tenant antes do global; ausência retorna `GENERATION_REQUIRED`.
- **Consequência:** playbook local prevalece sem editar catálogo system-owned; geração externa continua desligada.

## DEC-057 — Retrieval v1 é textual e limitado no PostgreSQL

- **Status:** ACCEPTED
- **Decisão:** `ContextRetriever` aplica tenant e budgets; histórico só é carregado após pedido explícito. Não usar vector DB nesta fase.
- **Consequência:** custo, leakage e complexidade são controlados; embeddings permanecem decisão futura baseada em avaliação.

## DEC-058 — Reprocessing é uma nova decisão versionada

- **Status:** ACCEPTED
- **Decisão:** processing key combina evento, versões de decisão/contexto/policy, provider, modelo e versões de modelo/configuração.
- **Consequência:** replay idêntico é deduplicado; modelo ou policy nova gera execução comparável sem reescrever histórico.

## DEC-059 — SSE autenticado sobre outbox PostgreSQL

- **Status:** ACCEPTED
- **Decisão:** server-to-client usa SSE, cookie no header e replay por `Last-Event-ID`; `realtime_events` é a fonte durável.
- **Consequência:** reconexão não depende da memória de uma instância e nenhum token aparece na URL. Broker permanece opcional para escala.

## DEC-060 — Lifecycle de delivery é explícito

- **Status:** ACCEPTED
- **Decisão:** persistir `CREATED|DELIVERED|VIEWED|DISMISSED|APPLIED|EXPIRED` e timestamps; somente ação explícita marca `APPLIED`.
- **Consequência:** funil e expiração são auditáveis; copiar texto não produz falso uso.

## DEC-061 — Feedback não altera a decisão

- **Status:** ACCEPTED
- **Decisão:** `InterventionFeedback` guarda `HELPFUL|NOT_HELPFUL` e ação opcional separado de decisão/candidata.
- **Consequência:** avaliação aprende com o seller sem reescrever evidência histórica.

## DEC-062 — Fadiga e dedupe precedem delivery

- **Status:** ACCEPTED
- **Decisão:** aplicar cooldown por categoria/chave, máximo por janela, prioridade mínima e supressão de informação neutra.
- **Consequência:** relevância vence volume e replay idempotente não duplica cards.

## DEC-063 — Prioridade é determinística e configurável

- **Status:** ACCEPTED
- **Decisão:** risco crítico > objeção > buying signal > discovery > próximo passo > informação; maior prioridade é o card corrente.
- **Consequência:** sinais concorrentes não disputam atenção por ordem acidental de processamento.

## DEC-064 — Expiração é dado de domínio

- **Status:** ACCEPTED
- **Decisão:** toda delivery recebe `expires_at`; leitura fecha itens vencidos e mantém histórico curto.
- **Consequência:** recomendações antigas não permanecem acionáveis silenciosamente.

## DEC-065 — Shadow continua default; visible exige três gates

- **Status:** ACCEPTED
- **Decisão:** delivery exige policy `ALLOW`, tenant visible e realtime ligado. `GENERATION_REQUIRED` nunca é entregue.
- **Consequência:** a Fase 5 pode ser exercitada sem expor cards por omissão.

## DEC-066 — Ownership mínimo do seller é owner do deal

- **Status:** ACCEPTED
- **Decisão:** seller só acessa conversa/contexto/delivery quando `deal.owner_membership_id` é sua membership. Manager segue org-wide até existir membership-equipe.
- **Consequência:** fecha o vazamento organizacional do seller sem inventar hierarquia; team scope é gate futuro documentado.

## DEC-067 — GenerativeProvider é o boundary de geração

- **Status:** ACCEPTED
- **Decisão:** domínio depende de `GenerationInput`/output estruturado e metadata; SDK/HTTP de fornecedor fica em `@morubi/ai`.
- **Consequência:** novos providers não alteram decision, policy, banco ou delivery; fixture usa o mesmo contrato.

## DEC-068 — DeepSeek é o provider inicial, opt-in

- **Status:** ACCEPTED
- **Decisão:** implementar adapter HTTP DeepSeek com JSON mode, modelos configuráveis, timeouts e gates desligados por default.
- **Consequência:** nenhuma chave é exigida sem ativação conjunta; CI usa mock/fixture e egress real continua gate operacional.

## DEC-069 — GenerativeRouter escolhe perfil, não estratégia

- **Status:** ACCEPTED
- **Decisão:** router determinístico seleciona `FAST_GENERATION|DEEP_REASONING` a partir de complexidade/tipo/contexto; recebe estratégia já decidida.
- **Consequência:** custo/latência podem evoluir sem delegar política comercial ao LLM.

## DEC-070 — Output generativo atravessa validação em camadas

- **Status:** ACCEPTED
- **Decisão:** schema, business/company rules, playbook validator, staleness e delivery policy precedem qualquer card; permitir uma correção controlada.
- **Consequência:** provider nunca fala diretamente com seller; `INVALID|REVIEW_REQUIRED` e violações são suprimidos.

## DEC-071 — Prompt é modular, versionado e separa conteúdo não confiável

- **Status:** ACCEPTED
- **Decisão:** compor system role, company rules, strategy, context e output contract; lead/CRM/notas ficam delimitados como `UNTRUSTED_DATA`.
- **Consequência:** reduz prompt injection e permite comparar versões sem prompt monolítico; rationale persistida é breve, não chain-of-thought.

## DEC-072 — Inteligência assíncrona roda em processo dedicado

- **Status:** ACCEPTED
- **Decisão:** remover loops da API e executar intelligence/generation em `apps/worker`, mantendo PostgreSQL `SKIP LOCKED` em vez de introduzir Redis.
- **Consequência:** API fica focada em HTTP/auth/SSE; worker tem retry, recovery, graceful shutdown e escala/deploy independentes.

## DEC-073 — Contexto generativo é mínimo e sanitizado

- **Status:** ACCEPTED
- **Decisão:** reutilizar contexto da decisão, aplicar budgets e redigir PII óbvia/IDs antes do egress; não enviar histórico inteiro.
- **Consequência:** reduz exposição e custo, sem alegar anonimização completa; DPA/retenção permanecem gate.

## DEC-074 — Custo generativo é ledger dimensional configurável

- **Status:** ACCEPTED
- **Decisão:** preços ficam em environment/config; `AIUsage` registra tokens/custo por tenant, seller, conversa, deal, intervenção, provider/model/profile.
- **Consequência:** budgets podem bloquear antes do egress e teto por intervenção pode suprimir; billing completo fica fora da fase.

## DEC-075 — Resultado obsoleto nunca é entregue

- **Status:** ACCEPTED
- **Decisão:** verificar staleness antes e depois do provider usando estado da candidata, decisão mais nova e evento posterior.
- **Consequência:** execução pode terminar `STALE` para auditoria, mas não vira card nem sobrescreve evidência recente.

## DEC-076 — Áudio é asset, não binário PostgreSQL

- **Status:** ACCEPTED
- **Decisão:** persistir metadata/hash/relações em `audio_assets` e bytes em `ObjectStorage` privado.
- **Consequência:** banco permanece adequado a queries; lifecycle do objeto exige cleanup e consistência compensatória.

## DEC-077 — ObjectStorage é vendor-neutral

- **Status:** ACCEPTED
- **Decisão:** contrato próprio sem AWS SDK no domínio; local somente DEV/TEST.
- **Consequência:** S3/R2/GCS/Azure podem substituir backend sem alterar modelo comercial.

## DEC-078 — TranscriptionProvider isola Gemini

- **Status:** ACCEPTED
- **Decisão:** fixture e Gemini implementam o mesmo contrato em `@morubi/ai`; modelo e pricing são configuração.
- **Consequência:** CI é determinístico e provider secundário futuro não invade domínio/worker.

## DEC-079 — Gemini usa contrato oficial Files + Interactions

- **Status:** ACCEPTED
- **Decisão:** upload temporário, modelo transcribe configurável e delete best-effort; sem payload inventado ou SDK espalhado.
- **Consequência:** adapter fica testável por HTTP mock e deve ser revisto quando o contrato beta mudar.

## DEC-080 — Transcript é versionado e possui um CURRENT

- **Status:** ACCEPTED
- **Decisão:** retranscrição cria nova versão, supersede a anterior e nunca sobrescreve silenciosamente.
- **Consequência:** auditoria/provider/model permanecem reproduzíveis; unique parcial impede dois currents.

## DEC-081 — Transcript retorna ao CommercialEvent canônico

- **Status:** ACCEPTED
- **Decisão:** promover output validado a evento textual com `content_origin=AUDIO_TRANSCRIPT`, sem engine paralelo e sem Gemini→DeepSeek direto.
- **Consequência:** state, memory, policy, template, geração e delivery são reutilizados integralmente.

## DEC-082 — Ordering usa o occurredAt original

- **Status:** ACCEPTED
- **Decisão:** conclusão tardia preserva horário da Message e eventos anteriores ao último relevante não avançam DealState.
- **Consequência:** timeline é historicamente correta sem regressão do snapshot atual.

## DEC-083 — Worker existente processa transcrição

- **Status:** ACCEPTED
- **Decisão:** adicionar handler transcription antes de intelligence/generation no `apps/worker`, reutilizando PostgreSQL, `SKIP LOCKED`, retry e shutdown.
- **Consequência:** nenhuma nova operação/queue é introduzida nesta escala.

## DEC-084 — Mídia externa passa por fronteira anti-SSRF

- **Status:** ACCEPTED
- **Decisão:** adapters futuros usam `ExternalMediaFetcher` com HTTPS, resolução IP, redirect revalidation e limites.
- **Consequência:** fetch arbitrário fica proibido; allowlist e controle de egress continuam requisitos do provider real.

## DEC-085 — Retenção de áudio e transcript é independente

- **Status:** ACCEPTED
- **Decisão:** configurar dias distintos; cleanup remove blob e, no prazo textual, redige evento e elimina transcript.
- **Consequência:** suporta minimização/LGPD sem alegar política legal completa; legal hold/auditoria detalhada ficam pendentes.

## DEC-086 — LiveCallSession é a raiz canônica da call

- **Status:** ACCEPTED
- **Decisão:** lifecycle, seller, contexto, provider, fase, memória e heartbeat pertencem a uma sessão tenant-scoped.
- **Consequência:** detecção, transcript, usage e cards compartilham identidade auditável sem depender da janela do desktop.

## DEC-087 — Detecção usa adapters e observações autorizadas

- **Status:** ACCEPTED
- **Decisão:** Meet/Zoom implementam `MeetingProviderAdapter`; coleta de sinais do SO fica fora do domínio e não é simulada como integração real.
- **Consequência:** novos providers e observadores por plataforma podem evoluir sem acoplar sessão ou UI.

## DEC-088 — Captura usa boundary próprio e APIs autorizadas

- **Status:** ACCEPTED
- **Decisão:** `LiveAudioCaptureProvider` isola MediaDevices/MediaRecorder e fixture; main process concede permissão curta, audio-only e single-use.
- **Consequência:** renderer não ganha acesso genérico a mídia; sistema de áudio/mixagem exige adapter futuro.

## DEC-089 — STT realtime é distinto do STT assíncrono

- **Status:** ACCEPTED
- **Decisão:** `RealtimeTranscriptionProvider` não reutiliza o contrato batch da Fase 7; fixture é o único provider executável sem configuração externa.
- **Consequência:** latência, streaming, reconnect e partials podem evoluir sem deformar Audio Intelligence.

## DEC-090 — Streaming é backend-controlled e bounded

- **Status:** ACCEPTED
- **Decisão:** sessão, billing e turns finais passam pelo backend; o desktop nunca recebe chave STT. Manter buffer limitado, descartar oldest sob pressão e remover chunk somente após acknowledge.
- **Consequência:** um adapter real pode usar stream backend ou token efêmero autorizado depois; reconexão reenvia por sequência/idempotência sem crescimento ilimitado.

## DEC-091 — Somente turnos finais entram no pipeline comercial

- **Status:** ACCEPTED
- **Decisão:** partial serve à experiência imediata; final idempotente cria `CommercialEvent(CALL_TRANSCRIPT)` e job prioritário no engine existente.
- **Consequência:** correções do STT não poluem estado, memória, decisões ou custos de inteligência.

## DEC-092 — Agregação de turnos é determinística e limitada

- **Status:** ACCEPTED
- **Decisão:** unir apenas finais adjacentes do mesmo speaker sob gap, duração e tamanho máximos.
- **Consequência:** reduz fragmentação sem inventar diarização ou acumular contexto ilimitado.

## DEC-093 — Memória live é incremental, bounded e monotônica

- **Status:** ACCEPTED
- **Decisão:** guardar somente fatos operacionais curtos e ignorar updates com sequência anterior.
- **Consequência:** UI tem contexto vivo sem transcript inteiro no prompt nem regressão por evento atrasado.

## DEC-094 — Áudio bruto live tem retenção zero por default

- **Status:** ACCEPTED
- **Decisão:** chunks permanecem apenas em memória no caminho live; `raw_live_audio_retention_days=0` é o default.
- **Consequência:** reduz risco e storage; retenção futura exige produto, legal, segurança e storage privado.

## DEC-095 — Consentimento precede captura e é persistido

- **Status:** ACCEPTED
- **Decisão:** start exige `CallConsentRecord`; auto-start fica desligado e só política organizacional explicitamente habilitada pode substituí-lo.
- **Consequência:** detecção nunca equivale a gravação e a confirmação possui ator, versão, horário e fontes.

## DEC-096 — Geração live tem gate independente

- **Status:** ACCEPTED
- **Decisão:** turnos live reutilizam decisão/policy/templates; geração só é enfileirada quando `live_generation_enabled` está ativo além dos gates existentes.
- **Consequência:** latência, custo e egress generativo não entram silenciosamente em calls.

## DEC-097 — Modo compacto reutiliza a janela segura

- **Status:** ACCEPTED
- **Decisão:** compactar/redimensionar a janela Electron existente, com always-on-top opt-in e sem transcript.
- **Consequência:** evita overlay privilegiado adicional e reduz exposição visual durante a call.

# ADR-009 — Relatórios pós-call revisionados

Decisão: separar identidade (`call_reports`) de conteúdo imutável (`call_report_revisions`) e usar uma fila PostgreSQL idempotente (`post_call_jobs`). Motivo: retry, auditoria e reprocessamento não podem sobrescrever uma conclusão anterior.

# ADR-010 — Evidência obrigatória e propostas sem escrita direta

Decisão: toda afirmação factual cita turnos válidos; fatos sem evidência são removidos e campos críticos ausentes não são inferidos. O pós-call persiste propostas reconciliadas, mas somente o engine determinístico existente pode alterar DealState/Memory.

# ADR-011 — Abstração generativa compartilhada

Decisão: ampliar `GenerativeProvider` com `POST_CALL_ANALYSIS`, mantendo fixture sem egress e DeepSeek sob feature flag. Motivo: centralizar timeout, circuit breaker, metadados de modelo e custo sem acoplar domínio ao fornecedor.
