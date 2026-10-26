# Transcrição ao vivo — Fase 9.6

## Estado honesto

O caminho de captura, normalização, transporte, autorização, provider e UI está implementado. Os testes automatizados usam sockets controlados e não constituem validação do serviço Gemini. Neste ambiente não existe `GEMINI_API_KEY`; por isso a capability retorna `PROVIDER_UNAVAILABLE`, o Desktop continua permitindo captura local sem egress e o teste humano de STT permanece bloqueado.

## Fluxo

```text
LOCAL_MIC ─┐
           ├─ PCM s16le / 16 kHz / mono / 100 ms
SYSTEM_AUDIO ┘
  -> buffer limitado por fonte
  -> Electron main (IPC validado)
  -> WebSocket binário autenticado
  -> Fastify /v1/live-calls/:sessionId/audio
  -> um stream Gemini por fonte
  -> INTERIM somente na UI
  -> FINAL em live_transcript_turns
```

O cookie e o tenant ficam no main process. A chave Gemini existe somente na API. Em produção, o Desktop rejeita `ws://`; apenas `wss://` é permitido. `ws://localhost` é aceito exclusivamente para desenvolvimento.

## Consentimento e autorização

A captura e a transcrição são consentimentos distintos. O start em `REALTIME` exige:

- sessão e membership autenticados no mesmo tenant;
- seller autenticado igual ao owner da sessão;
- sessão `ACTIVE` e flags de ambiente/organização habilitadas;
- consentimento `live-transcription-consent-v1` e as fontes `LOCAL_MIC` e `SYSTEM_AUDIO`;
- provider configurado no backend.

Detecção de reunião não concede nenhuma dessas autorizações. Ausência de STT não bloqueia captura consentida e não expõe detalhes técnicos na UI.

## Transporte e backpressure

O protocolo `MRBA` possui header fixo de 32 bytes com versão, fonte, formato, sequência, timestamp, duração, tamanho, sample rate e canais. O payload é binário, nunca JSON/base64 entre Desktop e API. O ACK `MRBK` é emitido somente após aceitação pelo stream do provider.

Sequências antigas são reconhecidas sem reprocessamento; gaps são contabilizados. Há limites para tamanho de pacote, timestamp, duração, bytes em fila, bytes no socket, conexões por organização e duração total. O cliente mantém filas separadas e limitadas, faz retry com backoff e interrompe a tentativa após cinco reconexões. Perda permanente é exibida como lacuna; áudio não cresce sem limite.

## Formato e fontes

O formato canônico é PCM signed 16-bit little-endian, 16 kHz, mono, em chunks de 100 ms (3.200 bytes). Microfone e adapters MediaStream são normalizados pelo Web Audio. O helper ScreenCaptureKit continua produzindo float32 estéreo 48 kHz; o renderer faz downmix e downsample antes do transporte, sem modificar a saída que o vendedor escuta.

As fontes nunca são misturadas:

- `LOCAL_MIC`: `SELLER`, confiança de origem 1;
- `SYSTEM_AUDIO`: `UNKNOWN`, exibido como participante remoto, sem inventar nome ou indivíduo.

O provider não oferece diarização no streaming. Portanto, múltiplas pessoas no canal remoto continuam sendo “Participante”; não há promessa de `Participante 1/2` sem evidência.

## Provider escolhido

O adapter escolhido é Gemini Live Transcription, modelo configurável com default `gemini-3.5-transcribe-live`. A escolha preserva o provider Gemini já existente e oferece interim/final de entrada em uma sessão bidirecional. A documentação oficial exige PCM 16-bit a 16 kHz mono e recomenda chunks de aproximadamente 100 ms. Ela também informa limite de sessão de dez minutos e ausência de diarização.

O adapter renova a conexão aos nove minutos. A linha do tempo e os IDs permanecem no Morubi; uma fonte não é enviada simultaneamente às conexões antiga e nova. Falha na renovação degrada somente a transcrição.

Referências oficiais:

- https://ai.google.dev/gemini-api/docs/live-api/live-transcribe
- https://ai.google.dev/gemini-api/docs/live-api/session-management
- https://ai.google.dev/gemini-api/docs/pricing

## Persistência, finalidade e retenção

Interims vivem somente na memória/UI. Apenas finais consentidos são persistidos em `live_transcript_turns`, para recuperar a timeline da call e permitir fases posteriores explicitamente autorizadas. Nesta fase os finais entram com `emitCommercialEvent=false`: não criam `CommercialEvent`, job de inteligência, coaching, DeepSeek ou relatório.

Áudio bruto não é persistido. `raw_live_audio_retention_days=0` permanece obrigatório para este caminho. A política `live_transcript_retention_days` existe por organização, mas a purga de `live_transcript_turns` e uma operação de exclusão autorizada completa ainda não estão conectadas. Isso é gate de produção; não se deve habilitar retenção de transcript real até o lifecycle de deleção e derivados ser validado.

## Usage e custo

`call_usage` registra segundos processados, tokens de entrada/saída informados pelo provider, modelo, provider, custo em micros e se a medição é `ACTUAL` ou `ESTIMATED`. Quando o provider ainda não enviou usage, a API usa a estimativa configurável por minuto; não recebe preço do cliente.

Pelos preços oficiais consultados para Live Transcribe, a referência configurada é US$ 3,50 por milhão de tokens de entrada e US$ 21 por milhão de tokens de saída, aproximadamente US$ 0,009 por minuto combinado. Isso é referência de configuração, não custo observado neste ambiente. O custo real precisa ser medido em uma call autorizada e conciliado com billing do provider.

## Configuração

Todos os gates começam desligados. Para uma validação controlada são necessários na API:

```dotenv
LIVE_CALLS_ENABLED=true
LIVE_TRANSCRIPTION_ENABLED=true
GEMINI_TRANSCRIPTION_ENABLED=true
GEMINI_API_KEY=<secret no servidor>
GEMINI_LIVE_TRANSCRIPTION_MODEL=gemini-3.5-transcribe-live
```

Também é necessário habilitar `liveTranscriptionEnabled` nas settings do tenant. Nunca copiar a chave para o Desktop, renderer, banco ou bundle.

## Pendências de validação

- reunião Meet com duas pessoas e consentimento real;
- latência interim/final p50/p95, WER e estabilidade em português brasileiro;
- renovação real acima de dez minutos sem duplicação/lacuna;
- conciliação de usage/custo com o provider;
- política contratual de região, retenção e uso de dados do Gemini;
- purga e exclusão autorizada end-to-end, incluindo derivados;
- hardware Windows 10+ real.
