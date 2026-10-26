# Worker runtime

## Fronteiras de banco

O Worker usa duas conexões não administrativas:

- `DATABASE_URL`: role `morubi_app`, usada para claims e processamento dentro de transações com `app.current_organization_id`.
- `WORKER_COORDINATOR_DATABASE_URL`: role `morubi_worker`, usada exclusivamente para executar `public.morubi_worker_queue_snapshot()`.

`DATABASE_ADMIN_URL` não faz parte do schema de configuração do Worker. Ela é aceita somente por migrations, bootstrap administrativo e seed controlado. A função de snapshot é `SECURITY DEFINER`, fixa `search_path` e devolve somente IDs de organizações com trabalho pendente e contagens de fila. `PUBLIC` não pode executá-la e `morubi_worker` não recebe acesso direto às tabelas.

Antes de aplicar migrations em um ambiente novo, a administração do PostgreSQL deve provisionar `morubi_app`, `morubi_auth` e `morubi_worker` como roles distintas, todas `NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`. O bootstrap local está em `packages/db/docker/init/001_roles.sql`; senhas de produção devem vir do secret manager da plataforma e nunca de arquivos versionados.

## Desenvolvimento

Copie `apps/worker/.env.example` para `apps/worker/.env`. O arquivo é ignorado pelo Git e contém somente placeholders/defaults locais. Depois de subir e migrar o PostgreSQL 17:

```bash
pnpm dev:worker
```

O baseline mantém `GENERATIVE_AI_ENABLED`, `DEEPSEEK_ENABLED`, `AUDIO_INTELLIGENCE_ENABLED`, `GEMINI_TRANSCRIPTION_ENABLED`, `LIVE_CALLS_ENABLED`, `LIVE_TRANSCRIPTION_ENABLED`, `LIVE_COPILOT_ENABLED`, `LIVE_GENERATION_ENABLED` e `POST_CALL_INTELLIGENCE_ENABLED` em `false`. `POST_CALL_PROVIDER=fixture` é permitido apenas com pós-call desligado em produção.

## Produção

Injete as variáveis diretamente no processo por secret manager ou configuração do orquestrador. Não monte o `.env` de desenvolvimento e não reutilize senha ou URL entre as três roles. O processo falha no startup se uma das duas URLs necessárias estiver ausente ou se um provider habilitado não tiver a credencial correspondente.

Execute migrations como uma etapa separada de deploy usando somente `DATABASE_ADMIN_URL`; inicie o Worker depois que a migration estiver concluída. DeepSeek, Gemini e Live STT continuam desabilitados até seus gates específicos de integração real.
