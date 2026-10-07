# Morubi — Especificação de Produto

**Status:** fonte de verdade inicial  
**Baseline:** 2026-10-05  
**Escopo:** definição do produto; não autoriza implementação

## 1. Visão

Morubi é um **System of Intelligence** para operações comerciais B2B. Ele observa como o time vende em CRMs, conversas e calls; apoia o vendedor durante o trabalho; e transforma interações em estado estruturado, intervenções, coaching e diagnóstico operacional.

> O Morubi acompanha como o time vende, ajuda enquanto ele está vendendo e transforma cada interação em inteligência para melhorar toda a operação comercial.

O CRM externo permanece o **system of record** para contatos, oportunidades, pipeline e atividades. Morubi mantém projeções sincronizadas e dados derivados próprios (estado, scores, memórias, análises e intervenções), sem competir pela autoria do pipeline.

## 2. Princípios de produto

1. **Inteligência antes de administração:** uma funcionalidade só entra se aumentar compreensão, decisão ou desempenho comercial.
2. **CRM como fonte operacional:** evitar duplicar automação genérica, pipeline ou cadastro que já pertence ao CRM.
3. **Ajuda no fluxo de trabalho:** insights acionáveis e contextualizados, não dashboards ornamentais.
4. **Humano no controle:** recomendações, scores e sugestões de playbook são explicáveis e revisáveis; mudanças oficiais exigem aprovação.
5. **Incremental por padrão:** processar o novo evento e o estado relevante, não reenviar o histórico inteiro.
6. **Tempo certo:** intervenção curta e rápida durante a venda; análises profundas em background.
7. **Tenant e privacidade desde o desenho:** toda leitura, escrita, busca e execução de IA tem contexto de organização.
8. **Auditabilidade:** origem, versão, evidência e custo de decisões importantes devem ser rastreáveis.
9. **Configuração por organização:** etapas, critérios, linguagem e playbook não são universais.
10. **Scores apoiam, não sentenciam:** exibir fatores, confiança e atualização; nunca esconder incerteza atrás de um número.

## 3. Personas e necessidades

### Seller — SDR, BDR, closer ou executivo

Precisa priorizar o dia, preparar-se rapidamente, entender o contexto de cada oportunidade, reagir melhor a objeções, cumprir próximos passos e desenvolver habilidades. Seu fluxo deve privilegiar seus próprios deals, contatos, conversas, calls e coach.

### Manager — coordenador, Head of Sales, diretor, founder ou Revenue Leader

Precisa identificar padrões que explicam conversão/perda, acompanhar aderência ao playbook, orientar o time com evidências e intervir em risco relevante. Precisa de diagnóstico operacional, não apenas agregados.

### Admin / Organization Owner

Precisa configurar organização, membros, equipes, integrações, retenção, consentimento e playbook; acompanhar sincronização, consumo e auditoria. `OWNER` é responsável último pela organização; `ADMIN` administra sem necessariamente possuir poderes destrutivos ou financeiros.

## 4. Problemas que o produto resolve

- Contexto comercial fragmentado em CRM, WhatsApp, calendário e plataformas de reunião.
- Vendedores entram em calls sem histórico ou sinais de risco relevantes.
- Objeções e buying signals são percebidos tarde ou de forma inconsistente.
- Gestores ouvem poucas calls e confundem sintomas com causas.
- Follow-ups, compromissos e perguntas abertas se perdem no texto.
- Playbooks estáticos não refletem a operação e raramente fecham o ciclo de aprendizagem.
- Uso indiscriminado de LLM eleva latência, custo e risco de respostas inconsistentes.

## 5. Módulos

| Módulo                    | Resultado principal                                              | Público        | Classificação inicial    |
| ------------------------- | ---------------------------------------------------------------- | -------------- | ------------------------ |
| Home                      | Workspace diário, agenda, prioridades, alertas e próximos passos | Seller         | MVP                      |
| Agenda                    | Visão diária/semanal sincronizada e contexto pré-reunião         | Seller/Manager | NEXT                     |
| Conversas                 | Timeline consolidada, estado e copilot de conversas              | Seller/Manager | MVP                      |
| Oportunidades             | Projeção inteligente do pipeline externo                         | Seller/Manager | MVP                      |
| Contatos                  | Contexto consolidado e relationship summary                      | Seller/Manager | MVP                      |
| Calls                     | Preparação, captura, live copilot e pós-call                     | Seller/Manager | NEXT                     |
| Coach                     | Treino e avaliação baseados em gaps reais                        | Seller/Manager | LATER                    |
| Análises                  | Diagnósticos operacionais com evidências                         | Manager        | LATER                    |
| Playbook                  | Contexto comercial versionado                                    | Admin/Manager  | MVP (base), LATER (vivo) |
| Configurações/Integrações | Organização, membros, conectores, privacidade e consumo          | Admin/Owner    | MVP                      |

`MVP`, nesta documentação, significa capacidade necessária para o primeiro fluxo validável; não implica que todos os módulos MVP sejam construídos simultaneamente.

## 6. Jornadas

### Seller

1. Abre a Home e vê calls do dia, follow-ups vencidos, deals críticos e leads sem resposta.
2. Antes de uma interação, revisa resumo, objeções, decisores, perguntas abertas e próximo passo.
3. Durante conversa/call, recebe no máximo intervenções relevantes, com motivo e evidência.
4. Após a interação, confirma ou corrige resumo, tarefas e campos extraídos antes do sync quando a política exigir.
5. Acompanha seus padrões no Coach e pratica cenários baseados em gaps reais.

### Manager

1. Acessa diagnósticos por equipe e período respeitando seu escopo de gestão.
2. Parte de um padrão (“preço apresentado cedo”) para as oportunidades/calls que o sustentam.
3. Analisa evidências, confiança e coortes; evita conclusões com amostra insuficiente.
4. Cria ações de coaching ou propõe mudança de playbook.
5. Mede se comportamento e resultado mudaram depois da intervenção.

### Admin / Owner

1. Cria a organização, políticas e membros; atribui papéis e equipes.
2. Conecta CRM e, depois, calendário/canais de call; acompanha saúde e escopos concedidos.
3. Mapeia pipeline/campos e executa backfill controlado.
4. Publica uma versão de playbook e configura critérios/intervenções.
5. Define retenção/consentimento e acompanha uso, custo, auditoria e falhas de sincronização.

## 7. Escopo por horizonte

### MVP

- Autenticação, organizações, memberships, equipes e RBAC básico.
- App shell responsivo com sidebar e navegação condicionada por permissão.
- Um conector CRM piloto por meio da abstração comum.
- Sincronização de contatos, deals, stages, mensagens/atividades disponíveis e usuários externos.
- Contatos e Oportunidades como projeções read-mostly, com link e proveniência do CRM.
- Ingestão idempotente e normalização em `CommercialEvent`.
- Timeline de Conversas e agregação de mensagens rápidas.
- `DealState` incremental: intenção, dores, objeções, decisores, concorrentes, orçamento, prazo, próximo passo, sentimento, risco e perguntas abertas.
- Motor JEV inicial baseado em contrato versionado (regras/classificador), Policy Engine e biblioteca de intervenções.
- Home mínima com agenda derivada quando disponível, ações pendentes e riscos.
- Playbook versionado mínimo para produtos, ICP, etapas, objeções, critérios e intervenções.
- Tarefas sugeridas; sync externo apenas com política, permissão e confirmação adequadas.
- Observabilidade de IA, uso/custo, auditoria e controles de retenção desde o início.

### NEXT

- Conectores adicionais, calendário e canais de conversa.
- Near real-time conversation copilot com feedback explícito sobre cards.
- Agenda diária/semanal e preparação automática.
- Pipeline de áudio: upload, transcrição e diarização conforme suporte.
- Calls: importação/gravação autorizada, transcript, post-call summary, scores e campos extraídos.
- Live copilot em calls após validar latência, consentimento e qualidade.
- Embeddings e recuperação histórica com filtros tenant-first.
- Métricas de seller e custos por call/minuto/conversa/feature.
- Fluxo robusto de revisão/aprovação antes de escrever no CRM.

### LATER

- Coach com roleplay, cenários derivados de padrões reais e avaliação longitudinal.
- Diagnósticos gerenciais causais com coortes, evidências e guardrails estatísticos.
- Living Playbook: sugestões, simulação de impacto, aprovação e publicação humana.
- Teams e provedores especializados adicionais.
- Benchmarks anonimizados somente com base legal, isolamento e opt-in explícitos.
- Billing por seats/uso e controles comerciais, sem transformar o produto em sistema financeiro.

## 8. Requisitos dos módulos

### Home

- Saudação e foco no dia; sem grid de gráficos.
- Calls com horário, participante, tipo, `DealScore`, risco/objeção e preparação.
- Ações ordenadas por urgência, impacto e confiança.
- Alertas deduplicados, silenciáveis e com explicação.
- Escopo do seller por padrão; manager pode selecionar equipe se autorizado.

### Agenda

- Dia/semana; reunião, seller, lead, deal, tipo, horário, status e origem.
- Dados sincronizados, sem edição avançada de calendário no Morubi.
- Resolução explícita de timezone e atualização/cancelamento idempotentes.

### Conversas

- Threads por canal/origem, timeline normalizada e anexos referenciados.
- Diferenciar conteúdo original, transcrição, resumo e inferência.
- Agregação antes da análise; reprocessamento reproduzível por versão.
- Cards com ação, justificativa, evidência, confiança e expiração.

### Oportunidades

- Nome, empresa, valor/moeda, owner, stage, última interação, próxima ação, scores, risco, intenção, objeções e health.
- Projeção ligada ao registro externo; sem pipeline complexo nativo.
- Sinalizar dados desatualizados e conflito de origem.

### Contatos

- Identidade, empresa/cargo, canais, origem, deals, conversas, calls, fatos e resumo relacional.
- Merge/deduplicação auditável; não mesclar somente por nome.
- PII mascarada conforme permissão e política.

### Calls

- Pré-call: contexto, objetivo, histórico, riscos e perguntas.
- Live: transcript parcial, speaker, progresso configurável, sinais e cards de baixa distração.
- Pós-call: transcript final, resumo, próximos passos, scores, evidências, campos, tarefas e coaching.
- Consentimento e estado de gravação sempre visíveis.

### Coach

- Cenários vinculados a competências e evidências reais, sem copiar PII desnecessária.
- Dificuldade configurável, avaliação reproduzível, feedback e evolução.
- Separar treino privado de avaliação formal do gestor.

### Análises

- Insight narrativo + tamanho de amostra + período + segmento + evidências.
- Drill-down controlado por permissão.
- Distinguir correlação de causalidade e suppressão de grupos pequenos.

### Playbook

- Draft, revisão, publicação, desativação e versionamento imutável de versões publicadas.
- Conteúdo estruturado e documentos de apoio.
- Cada execução de IA registra a versão efetiva utilizada.
- Sugestão automática nunca altera versão oficial.

## 9. Métricas de sucesso

- Tempo até o seller encontrar contexto para uma interação.
- Percentual de interações com próximo passo capturado/confirmado.
- Precisão e aceitação/rejeição de intervenções por tipo.
- Latência p50/p95 de card após bloco lógico.
- Cobertura de deals com `DealState` fresco.
- Redução de follow-ups vencidos e de campos manuais, sem sacrificar qualidade.
- Uso semanal por seller e manager, medido por ações úteis, não pageviews.
- Custo de IA por organização, seller, call, minuto, conversa e feature.
- Taxa de correção humana de resumos, campos e scores.
- Evolução de comportamentos-alvo e, como indicador atrasado, conversão/ciclo.

## 10. Fora de escopo

- CRM completo ou pipeline autoritativo próprio.
- Propostas/CPQ completos, assinatura, invoicing e cobrança operacional.
- Marketing automation, campanhas e email marketing.
- Automação genérica de workflows não ligada à inteligência comercial.
- Discador/plataforma de videoconferência próprios.
- Alteração automática de playbook oficial.
- Promessa de previsão de receita ou decisão de pessoal totalmente automatizada.
- Afirmação de compliance/certificação sem auditoria formal.

## 11. Regras de UX e identidade

- Sidebar: Home, Agenda, Conversas, Oportunidades, Contatos, Calls e Coach; Análises para manager; Playbook e Configurações para admin.
- Verde-água, preto e branco formam a identidade; contraste e estados não dependem apenas de cor.
- Revelação progressiva: ação e motivo primeiro; evidência e detalhes sob demanda.
- Estado vazio e estado de sincronização devem explicar o próximo passo.
- Conteúdo de IA deve ser identificado, permitir feedback e nunca aparentar certeza inexistente.

## 12. Suposições

- **ASSUMPTION P-01:** produto inicia greenfield; o diretório inspecionado está vazio.
- **ASSUMPTION P-02:** primeira região de dados será definida antes do piloto; português do Brasil é o idioma inicial, com modelo internacionalizável.
- **ASSUMPTION P-03:** haverá um CRM piloto escolhido por capacidade de webhook/API e clientes de design partner.
- **ASSUMPTION P-04:** seller pode corrigir dados derivados; escrita de volta ao CRM será allowlist por campo e política.
- **ASSUMPTION P-05:** `DealScore` mede saúde/probabilidade operacional configurável; `CallScore` mede qualidade da interação. Ambos mantêm versão, fatores e confiança.

## 13. OPEN QUESTIONS

1. Qual CRM e qual canal de conversa serão o primeiro design partner?
2. O produto começará com autenticação própria, provedor gerenciado ou SSO obrigatório?
3. Qual região de hospedagem e quais requisitos contratuais de residência de dados?
4. Quem pode ouvir/gravar calls e qual fluxo jurídico de consentimento por país/canal?
5. Quais campos o MVP pode escrever no CRM, e quais sempre exigem confirmação?
6. Qual definição de sucesso e quais pesos iniciais do `DealScore` por organização?
7. O JEV é nome de um componente proprietário/modelo específico ou apenas o contrato lógico do Decision Engine?
8. Qual SLA de latência e disponibilidade para conversation/live-call copilot?
9. Qual retenção padrão para áudio, transcript, prompts e logs?
10. Há necessidade de sub-organizações, múltiplas unidades ou data residency já no primeiro ano?

## 14. Incremento validável — CRM Copilot em texto

A Fase 5 entrega ajuda contextual zero-prompt em Conversas: lista priorizável, timeline, contexto comercial e um único card acionável. O seller pode copiar pergunta, marcar uso, dispensar e avaliar utilidade. Confidence numérica, policy/provider/model e estado `SUPPRESSED` não são linguagem de seller.

O produto evita fadiga por limite, cooldown, dedupe, prioridade e expiração. Shadow é default; visible é opt-in. Não há chat genérico, autosend, composer de produção, notificação do SO nem probabilidade numérica de fechamento. Métricas incluem lifecycle, feedback, latência e false-card rate.
