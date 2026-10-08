# Post-call intelligence

## Escopo da Fase 9

O Morubi transforma uma `live_call_session` encerrada em um relatório comercial estruturado, assíncrono, versionado e rastreável. A Fase 9 não implementa automação autônoma nem a Fase 10. A Fase 3B permanece adiada.

## Fluxo

1. `LiveCallRepository.end` muda a sessão para `ENDED` e, na mesma transação, cria `call_reports(PROCESSING)` e o job idempotente `post_call_jobs`.
2. O worker atende primeiro transcrição, intelligence e generation; post-call usa prioridade 10 e vem depois das filas live.
3. Apenas turnos finais são ordenados e segmentados por limite de caracteres. Cada segmento passa por extração estruturada; chamadas longas passam por uma reconciliação hierárquica final.
4. O output é validado por Zod. Toda afirmação exige `{ value, confidence, evidenceTurnIds }`. Referências fora da sessão são descartadas e resumo/assessment sem evidência rejeitam o relatório.
5. O commit usa advisory lock, supersede a revisão `CURRENT`, cria uma nova revisão imutável, registra `ai_usage` e publica `call_report.ready`.

## Dados e idempotência

- `post_call_jobs`: fila PostgreSQL com `PENDING | PROCESSING | COMPLETED | FAILED | RETRY | CANCELLED`, tentativas, backoff, lock recuperável e unique por organização, sessão e `processing_version`.
- `call_reports`: identidade estável e estado público `PROCESSING | READY | FAILED`, único por sessão.
- `call_report_revisions`: histórico imutável. Apenas uma revisão pode ser `CURRENT`; reprocessamento cria a versão seguinte e nunca sobrescreve o conteúdo anterior.
- Um retry após falha reutiliza o job. Uma recuperação após commit deduplica pela revisão corrente e não gera duplicata.

## Conteúdo e evidência

O contrato contém resumo executivo, contexto, dores, necessidades, objeções, sinais de compra, decisores, concorrentes, orçamento, timeline, compromissos por ator, próximos passos explícitos, próximos passos sugeridos, perguntas, riscos, gaps, observações de playbook e assessment. `experimentalScore` é opcional e nunca é apresentado como verdade objetiva.

Ausência de evidência permanece ausência: orçamento, concorrente, decisor, prazo ou compromisso não são inferidos. Próximos passos sugeridos ficam separados dos explicitamente combinados.

## Estado comercial e memória

O modelo não grava `deal_states` nem `memory_facts`. O reconciliador produz propostas evidenciadas, classifica duplicatas como `NOOP_DUPLICATE` e baixa confiança como `REVIEW_REQUIRED`. Os eventos finais da própria call continuam passando pelo `IntelligenceProcessor`, que é o único caminho determinístico para aplicar estado/memória e seus thresholds. Assim o pós-call complementa e reconcilia, sem criar uma segunda autoridade de escrita.

## Provider, segurança e custo

`GenerativeProvider` expõe `analyzePostCall` com o perfil `POST_CALL_ANALYSIS`. `POST_CALL_PROVIDER=fixture` é determinístico e não usa rede; `deepseek` exige feature flag e credencial. Transcript, estado e memória são marcados como dados não confiáveis no prompt. Logs guardam IDs, tentativas, latência e códigos sanitizados, nunca transcrição, output ou credencial.

Cada revisão registra provider/model, prompt/config/processing version, tokens, custo estimado e contagem de evidências. `ai_usage` referencia a revisão. Limites de segmento/output e três tentativas limitam custo e blast radius.

## APIs e acesso

- `GET /v1/call-reports`
- `GET /v1/live-calls/:sessionId/report`
- `POST /v1/live-calls/:sessionId/report/retry`
- `GET /v1/live-calls/:sessionId/transcript`

Não existe CRUD genérico. Seller acessa apenas suas calls; manager/admin/owner acessam o tenant. As três tabelas usam RLS forçada com `morubi_app` sem bypass.

## Realtime e interface

Os envelopes v1 aceitam `call_report.processing`, `call_report.ready` e `call_report.failed`. Desktop exibe processamento, relatório, blocos comerciais e retry. Web lista relatórios para manager/admin/owner.

## Avaliação

`pnpm test:post-call` executa corpus sintético determinístico de 30 calls e mede schema pass rate, precisão das evidências e false fact rate. `exportPostCallEvaluationCsv` permite exportação CSV; o resultado em memória é JSON serializável. Integração PostgreSQL cobre RLS, ownership, idempotência, reprocessamento, evidência e ausência de orçamento inventado.
