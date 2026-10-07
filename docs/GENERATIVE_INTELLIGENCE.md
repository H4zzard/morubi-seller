# Morubi — Generative Intelligence

**Status:** Fase 6 implementada em 2026-10-07  
**Default operacional:** desligado por ambiente e por organização; shadow mode preservado

## 1. Responsabilidades

O modelo generativo só transforma uma estratégia já decidida em uma intervenção curta. JEV/Decision Engine classifica o evento, Policy Engine autoriza ou suprime, a Intervention Library tenta resolver por template e somente `GENERATION_REQUIRED` cria trabalho generativo. O modelo não escolhe estratégia, score, permissão, política, estado ou memória.

```text
CommercialEvent -> Decision -> Policy -> Intervention Library
                                      | template -> candidate TEMPLATE
                                      ` generation required -> generation_jobs
                                        -> GenerativeRouter -> GenerativeProvider
                                        -> schema/business/playbook validation
                                        -> stale + delivery policy
                                        -> candidate GENERATED -> delivery
```

Não existe endpoint `generate-anything`. A API apenas ingere comandos leves, atende queries/realtime e oferece inspeção protegida para desenvolvimento.

## 2. Package e providers

`@morubi/ai` contém contratos independentes de fornecedor, prompt, sanitização, roteamento, validação, custo, engine, fixture e adapter DeepSeek. `GenerativeProvider.generate()` recebe `GenerationInput` compacto e retorna output desconhecido mais metadata de modelo/tokens; a validação acontece fora do adapter.

- `FixtureGenerativeProvider`: determinístico; simula válido, schema inválido, timeout, falha, sugestão insegura, resposta longa e estratégia errada.
- `DeepSeekGenerativeProvider`: usa HTTP isolado, bearer auth, JSON mode, timeout por perfil, classificação de `429`/`5xx`, cancelamento e circuit breaker simples.
- Extensões futuras para OpenAI, Anthropic ou Gemini implementam o mesmo contrato sem alterar domínio, banco ou pipeline.

Perfis lógicos:

| Perfil            | Modelo configurado por default | Uso                                       |
| ----------------- | ------------------------------ | ----------------------------------------- |
| `FAST_GENERATION` | `deepseek-flash`               | intervenção simples, menor latência/custo |
| `DEEP_REASONING`  | `deepseek-v4-pro`              | contexto/estratégia de maior complexidade |

Os nomes concretos vêm de `DEEPSEEK_FAST_MODEL` e `DEEPSEEK_REASONING_MODEL`; o domínio persiste perfil e modelo observado, sem hardcode do fornecedor.

## 3. Configuração e gates

`GENERATIVE_AI_ENABLED=false` e `DEEPSEEK_ENABLED=false` são defaults seguros. `DEEPSEEK_API_KEY` só é obrigatória quando os dois gates estão ativos. Também são configuráveis base URL, modelos, timeout por perfil, limite de output, preços por milhão de tokens, polling e batch do worker.

Além dos gates de ambiente, cada tenant possui `generative_ai_enabled`, `generate_in_shadow`, limites de contexto/output, regras da empresa e budgets por organização, seller e intervenção. Template encontrado, policy suprimida, confidence insuficiente ou geração desativada não chama provider.

## 4. Input, minimização e prompt

O input reutiliza o contexto da decisão: estratégia, tipo da intervenção, evento atual, DealState, memórias relevantes, hot context, regras e snippets do playbook. Não carrega histórico completo. `GenerationContextSanitizer` aplica budgets, remove IDs de origem e redige e-mail, telefone e UUID antes do egress.

O prompt versionado separa:

1. `SYSTEM ROLE`;
2. `COMPANY RULES`;
3. `STRATEGY`;
4. `CONTEXT`;
5. `OUTPUT CONTRACT`.

Mensagem do lead, CRM e notas externas ficam entre delimitadores de `UNTRUSTED_DATA`. Conteúdo externo nunca é promovido a instrução de sistema. Prompt/resposta completos não vão para logs operacionais; a execução persiste somente resumo sanitizado e output controlado para inspeção autorizada.

## 5. Output e validação

O contrato Zod estrito contém `title`, `guidance`, `suggestedQuestion`, `warning`, `rationale`, `tone` e `strategy`. `rationale` é uma justificativa curta e estruturada, nunca chain-of-thought.

A sequência obrigatória é:

```text
schema -> business rules -> company rules -> playbook validator
       -> VALID | INVALID | REVIEW_REQUIRED -> delivery policy
```

As regras determinísticas rejeitam estratégia divergente, campos ausentes, resposta longa, preço/desconto/prazo/feature/condição/promessa/urgência ou matéria jurídica/financeira inventada e alteração contratual. Regras da empresa são constraints adicionais. Um output inválido recebe no máximo uma tentativa de correção; nunca há loop nem entrega direta do provider ao seller.

## 6. Jobs, idempotência e falhas

`apps/worker` é processo dedicado para `intelligence_jobs` e `generation_jobs`. A API não agenda timer nem processa IA em request. O worker descobre tenants com conexão administrativa separada e executa cada job na role runtime com `SET LOCAL` e RLS.

Claim usa `FOR UPDATE SKIP LOCKED`, tentativas limitadas, backoff e recuperação de lock abandonado. Shutdown para novos polls e espera o ciclo ativo. Logs estruturados registram profundidade aproximada, claimed/completed/failed, retries e latência sem prompt completo.

`generation_key` e uniques por tenant/candidate tornam replay deduplicável. `GenerativeExecution` também é único por `(organization_id, generation_key)` e `AIUsage` por execução generativa. Assim, o mesmo job não cria nova cobrança lógica. Falha retryable retorna ao job; esgotamento suprime a candidata e mantém causa inspecionável. O seller não vê stack, fornecedor ou erro técnico; templates continuam independentes do circuit breaker.

## 7. Staleness e delivery

O engine verifica staleness antes da chamada e depois de um output válido. Antes da entrega, invalida a geração quando:

- a candidata já deixou `GENERATION_REQUIRED`;
- surgiu decisão mais nova para o deal;
- a conversa recebeu evento posterior.

Execução obsoleta termina `STALE`, sem card. Output válido muda a candidata para `MATCHED` com `source=GENERATED`; a mesma delivery policy da Fase 5 ainda aplica shadow, visibilidade, cooldown, prioridade, TTL e dedupe. Enquanto existe job pendente, o Copilot pode mostrar apenas `ANALYZING`, nunca “DeepSeek pensando”.

## 8. Custo e observabilidade

Preço é configuração do provider, não migration ou regra de domínio. O custo estimado usa input/output tokens e é armazenado em micros. `AIUsage` permite agregar por organização, seller, conversation, deal, candidate/intervention, provider, model e profile. Budgets são verificados antes da chamada; custo final acima do teto por intervenção suprime a entrega.

`GenerativeExecution` registra versões de config/prompt/context/policy, status, validação, tokens, custo e timestamps `generation_started_at`, `generation_completed_at`, `validation_completed_at`, `delivery_created_at`, além de `generation_latency_ms` e `generation_to_delivery_ms`.

## 9. Tenancy e segurança

`generation_jobs` e `generative_executions` têm `organization_id NOT NULL`, FKs compostas tenant-consistentes, índices tenant-first e RLS `ENABLE + FORCE`. Contexto é carregado na mesma organização do job. Apenas o coordenador enumera filas com credencial administrativa; processamento de negócio usa a role restrita.

Endpoints dev exigem `intelligence.dev.inspect`. A UI exibe resumo sanitizado, estratégia, provider/model, output, validação, policy, custo e latência; isso não é exposto ao seller.

## 10. Avaliação e testes

O corpus sintético tem 56 casos `generation-required`, sete em cada categoria: `PRICE`, `COMPETITOR`, `TIMING`, `AUTHORITY`, `TRUST`, `IMPLEMENTATION`, `NEED` e `FOLLOW_UP`. Critérios determinísticos verificam schema, estratégia, pergunta obrigatória, comprimento, termos proibidos e regras comerciais. O harness exporta JSON e CSV com input, critérios, output e validação para revisão humana.

CI não depende da API DeepSeek: o adapter é testado com HTTP mock e o pipeline usa fixture. Um smoke real continua opcional e só pode rodar com chave local deliberadamente configurada.

## 11. Limites e gates abertos

- O PostgreSQL 17 de CI é o gate autoritativo para migration, RLS, cross-tenant, job duplicado e integração ponta a ponta; não há PostgreSQL local disponível nesta execução.
- Preços default são configuração operacional e precisam ser conferidos antes de habilitar egress real.
- Não há fallback textual genérico nesta fase: falha/invalid/stale suprime com segurança.
- Não há billing, anonymizer complexo, benchmark multi-provider, Redis/BullMQ ou LLM judge.
- Fase 3B/CRM real continua adiada.
- A Fase 7 adicionou STT assíncrono antes do `CommercialEvent`; esta camada generativa não chama transcrição diretamente e conserva todas as suas responsabilidades. Calls, Meet/Zoom/Teams, captura do sistema/microfone e diarização continuam fora do escopo.
