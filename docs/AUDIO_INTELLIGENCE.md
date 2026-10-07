# Audio Intelligence — Fase 7

## 1. Escopo

A Fase 7 processa mensagens de áudio assíncronas já enviadas a uma conversa. Não captura microfone, áudio do sistema ou reuniões e não implementa streaming, diarização, call detection ou voice coach.

O princípio central é um único pipeline comercial:

```text
Message(AUDIO) -> AudioAsset -> TranscriptionJob -> AudioTranscript
  -> CommercialEvent(contentOrigin=AUDIO_TRANSCRIPT)
  -> IntelligenceJob -> Decision/Policy -> Template ou geração -> Delivery
```

Não existe `AudioIntelligenceEngine`. Depois da transcrição validada, o Intelligence Engine recebe texto canônico como em qualquer outro evento.

## 2. Modelo e proveniência

- `audio_assets` liga tenant, conversa, mensagem, contato/deal, remetente, `occurred_at` original, SHA-256, MIME, tamanho, duração, storage key, origem e retenção.
- `audio_transcripts` guarda versões imutáveis com provider, model, texto, idioma, confidence opcional, usage, custo e job. A versão ativa usa `CURRENT`; retranscrição supersede a anterior sem sobrescrevê-la.
- `transcription_jobs` é a fila PostgreSQL durável, com chave de processamento, tentativas limitadas, backoff, lock recuperável, correlation ID e erro sanitizado.
- `commercial_events.audio_transcript_id` responde qual transcript originou o evento. O transcript responde asset, job, provider/model; o asset responde mensagem, origem e hash.

O hash não é identidade global. A deduplicação combina `message_id + sha256` e é limitada à organização; o mesmo arquivo em outro contexto mantém proveniência própria.

## 3. Armazenamento privado

`@morubi/storage` define `ObjectStorage` (`put`, `get`, `delete`, `exists`, `createReadStream`). O domínio não importa SDK de nuvem. `LocalObjectStorage` é apenas o backend inicial de DEV/TEST, sob `.data/audio`, com escrita temporária/rename e validação de containment contra path traversal. A storage key é `organizations/{organizationId}/audio/{audioAssetId}.{ext}`.

O renderer nunca recebe path local. `GET /v1/messages/:messageId/audio` resolve sessão, membership, tenant e ownership antes de o Electron main receber bytes; o preload expõe somente IPC tipado. O renderer cria um blob temporário e revoga sua URL.

S3, R2, GCS ou Azure Blob podem implementar o mesmo contrato. Em produção, o backend local ainda deve ser substituído por object storage privado e política operacional de backup/criptação.

## 4. Ingestão e validação

`AudioAssetService` valida tenant e vínculo `Message(AUDIO)`, limite, duração, MIME declarado e magic bytes; calcula SHA-256; grava o objeto; cria asset/job numa transação; e remove o objeto se a transação falhar. Formatos iniciais realmente aceitos: WAV, MPEG/MP3, Ogg e WebM. MP4 não foi habilitado sem validação de container suficiente.

Não há endpoint público genérico de upload. A Fase 7 publica somente leitura autorizada e o simulador admin/dev.

## 5. Mídia externa e SSRF

`ExternalMediaFetcher` é a fronteira para adapters futuros. Ele aceita somente HTTPS sem credenciais/porta arbitrária, resolve DNS antes de cada request, rejeita localhost, loopback, unspecified, link-local, CGNAT, redes privadas IPv4/IPv6 e valida novamente todos os redirects. `file:`, `ftp:` e HTTP são bloqueados.

O fetcher limita timeout, redirects, MIME, `Content-Length` e bytes efetivamente lidos do stream. Adapters reais deverão acrescentar allowlist de hosts do provider. DNS rebinding entre resolução e conexão requer proteção adicional de rede/egress antes de produção.

## 6. Providers de transcrição

`TranscriptionProvider` recebe somente bytes, MIME, duração e hint opcional de idioma. Não recebe nome, e-mail, telefone, DealState ou histórico. Ele apenas transcreve; não resume, traduz, responde nem classifica.

`FixtureTranscriptionProvider` é determinístico e cobre saída válida, vazia, timeout, 429, 500, schema inválido, idioma desconhecido e arquivo corrompido. `GeminiTranscriptionProvider` fica isolado em `@morubi/ai`, usa timeout, classificação de retry e circuit breaker.

O adapter segue o contrato oficial atual: upload temporário pela Files API, transcrição assíncrona pelo endpoint Interactions e remoção best-effort do arquivo remoto. Modelo configurável: `GEMINI_TRANSCRIPTION_MODEL`, default `gemini-3.5-transcribe`. A detecção de idioma é automática quando não há hint. O arquivo temporário do provider não é a fonte permanente do Morubi.

Referências operacionais: [Audio transcription](https://ai.google.dev/gemini-api/docs/transcribe), [Gemini 3.5 Transcribe](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-transcribe) e [Files API](https://ai.google.dev/gemini-api/docs/files).

## 7. Jobs, retries e falhas

O mesmo `apps/worker` processa transcrição antes de intelligence e generation. Claim usa `FOR UPDATE SKIP LOCKED`; locks com mais de cinco minutos são recuperáveis. Timeout/429/5xx usam backoff exponencial até `max_attempts`. MIME inválido, corrupção, output vazio/schema inválido e source tombstoned não entram em retry cego.

Falha terminal marca asset como `FAILED` e não cria transcript, evento ou intelligence job. O seller vê estado amigável, nunca status HTTP, stack ou resposta do Gemini. Uma mensagem tombstoned antes da promoção impede evento comercial ativo.

## 8. Ordering, idempotência e versionamento

O `CommercialEvent.occurred_at` é sempre o horário original da mensagem, não o término da transcrição. Assim, áudio das 10:01 concluído às 10:03 permanece antes do texto das 10:02.

Processing keys e uniques impedem dois assets por mensagem, dois transcripts pelo mesmo job, duas versões com o mesmo número, dois eventos equivalentes e dois intelligence jobs para o evento. Uma unique parcial garante um único transcript `CURRENT` por asset.

Se um evento antigo chega tarde, ele entra na timeline e ainda pode gerar evidência, mas `IntelligenceProcessor` compara o `occurred_at` do último evento relevante antes de avançar o `DealState`; eventos anteriores não regressam o snapshot atual. A camada generativa conserva sua verificação de staleness.

## 9. Custo, métricas e retenção

`AIUsage` recebeu `audio_asset_id`, `audio_transcript_id`, duração e `usage_measurement=ACTUAL|ESTIMATED`. Pricing é environment, com custo por milhão de tokens de entrada/saída e por minuto; defaults são zero até configuração comercial confirmada.

O worker registra sem conteúdo: queue depth, retention depth, attempts, provider latency, `audio_to_transcript_ms`, IDs correlacionáveis e sucesso/falha. Timestamps persistidos de asset/job/transcript/event/decision/delivery permitem derivar `transcript_to_decision_ms` e `audio_to_intervention_ms`.

`audioRetentionDays` e `transcriptRetentionDays` são independentes. O cleanup remove objeto expirado e marca asset `EXPIRED`; ao expirar transcript, redige texto do evento promovido, registra metadata de retenção e elimina transcript/usage relacionados. Auditoria específica de deleção e legal hold são débitos antes de produção.

## 10. UI e simulador

O desktop mostra player HTML seguro com play/pause, progresso/duração nativos, status e transcript expansível. Áudio é carregado sob demanda pelo Electron main. O painel `/app/dev/conversations` oferece cinco WAVs sintéticos (`PRICE`, `TIMING`, `COMPETITOR`, `BUYING_SIGNAL`, `NEUTRAL`), ativa o gate do tenant, cria mensagem/asset/job e consulta status/transcript.

Fixtures contêm apenas texto sintético embutido em WAV gerado em memória; nenhum áudio de cliente é versionado.

## 11. Flags e configuração

- `AUDIO_INTELLIGENCE_ENABLED=false`: kill switch de API/worker.
- `GEMINI_TRANSCRIPTION_ENABLED=false`: egress Gemini; em DEV/TEST, o fixture pode operar quando o gate de áudio está ligado.
- `GEMINI_API_KEY`, `GEMINI_BASE_URL`, `GEMINI_TRANSCRIPTION_MODEL`, `GEMINI_TRANSCRIPTION_TIMEOUT_MS`.
- três preços configuráveis do provider.
- `AUDIO_STORAGE_ROOT`, `AUDIO_MAX_BYTES`, `AUDIO_RETENTION_DAYS`.
- setting tenant `audio_intelligence_enabled` e políticas de retenção/limite persistidas.

## 12. Gates externos e limites

PostgreSQL 17 continua sendo gate externo para aplicar `0007_happy_odin.sql`, validar RLS/roles, cross-tenant, concorrência/duplicate claim, retention e o fluxo completo até delivery. O ambiente desta entrega não possui PostgreSQL local.

Antes de piloto também faltam: DPA/região/zero-retention do Gemini, object storage de produção, allowlist/egress enforcement, preços reais, métricas exportadas/alertas, corpus de áudio humano autorizado e avaliação de qualidade por idioma/ruído. Fase 3B segue adiada. Meet, Zoom, Teams, captura desktop/microfone, streaming, diarização e voice coach permanecem explicitamente na Fase 8+.

## 13. Atualização da Fase 8

A Fase 8 adicionou um boundary independente para calls ao vivo. Ela não altera este pipeline batch: `RealtimeTranscriptionProvider` é separado, partial não vira evento e somente final aprovado retorna como `CALL_TRANSCRIPT`. O adapter de microfone existe, mas provider streaming real, áudio do sistema e diarização continuam pendentes. Consulte `LIVE_CALLS.md`.
