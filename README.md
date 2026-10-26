# Morubi

Fundação técnica e núcleo comercial desktop-first do Morubi, um System of Intelligence para operações comerciais.

## Arquitetura desta fase

- `apps/desktop`: Electron + React/Vite; cliente principal do seller.
- `apps/web`: Next.js App Router; interface de manager/admin/owner.
- `apps/api`: Fastify; boundary central de domínio, auth, autorização e tenancy.
- `packages/db`: Drizzle/PostgreSQL, migrations, repositories tenant-scoped e RLS.
- `packages/auth`: Better Auth compartilhado pelo backend.
- `packages/permissions`: matriz RBAC centralizada.
- `packages/contracts`: DTOs e cliente HTTP compartilhado.
- `packages/integrations`: contrato CRM read-only, retry/redaction e connector fixture.
- `packages/intelligence`: contratos de decisão, contexto limitado, policy, reducers, fixture e evals.
- `packages/validation`: schemas Zod de fronteira.
- `packages/ui`: primitives e tokens visuais Morubi.

Contacts, deals, conversations, messages e eventos comerciais são projeções canônicas read-only. O framework provider-agnostic de CRM, conexões e tracking de sync está implementado, mas nenhum provider real foi escolhido. O Intelligence Engine v1 opera somente com fixture determinística e shadow mode; JEV real continua desligado. Não há OAuth, webhook, outbound, áudio, call live, provider externo de IA, Redis ou worker de fila durável.

## Requisitos

- Node.js 22.12+ (Node 24 recomendado)
- pnpm 12.9.1 via Corepack
- Docker com Docker Compose

No Windows com PowerShell restrito, use os executáveis `.cmd` (`corepack.cmd`, `npm.cmd`).

## Instalação

```bash
corepack enable
pnpm install
cp .env.example .env
cp apps/worker/.env.example apps/worker/.env
docker compose up -d postgres postgres-test
pnpm db:migrate
```

O PostgreSQL local cria três identidades restritas além da role administrativa:

- `postgres`: somente migrations/administração;
- `morubi_app`: runtime sem ownership e sem `BYPASSRLS`.
- `morubi_auth`: runtime exclusivo do Better Auth, sem privilégios elevados e limitado às quatro tabelas de autenticação.
- `morubi_worker`: coordenador sem acesso direto a tabelas; executa apenas o snapshot mínimo de filas.

## Desenvolvimento

Todos os processos:

```bash
pnpm dev
```

Separadamente:

```bash
pnpm dev:api
pnpm dev:web
pnpm dev:desktop
pnpm dev:worker
```

- Web: `http://localhost:3000`
- API/health: `http://localhost:4000/health`
- Electron: abre a janela local com hot reload do renderer e reinício do main process.

## Banco e migrations

```bash
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm db:studio
```

`DATABASE_ADMIN_URL` é aceita somente pelos comandos de migration/administração. `DATABASE_URL` usa `morubi_app` no domínio; `AUTH_DATABASE_URL` usa `morubi_auth` exclusivamente no Better Auth; `WORKER_COORDINATOR_DATABASE_URL` usa `morubi_worker` somente para descobrir filas. O contexto tenant é aplicado com `set_config(..., true)` dentro de transações, compatível com pooling. A configuração completa está em [WORKER_RUNTIME.md](./docs/WORKER_RUNTIME.md).

`db:seed` cria a organização sintética ACME, Marina como seller, Carlos, Fernanda, Projeto X/Y e duas conversas com mensagens. O seed não cria credenciais de login e não deve ser usado como identidade de produção.

## Qualidade

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:connectors
pnpm test:intelligence
pnpm test:integration
pnpm build:web
pnpm build:api
pnpm build:desktop
pnpm exec playwright install chromium
pnpm --filter @morubi/web test:e2e
```

Os testes de integração requerem PostgreSQL migrado e:

```bash
TEST_DATABASE_ADMIN_URL=postgresql://postgres:postgres@localhost:5433/morubi_test
TEST_DATABASE_URL=postgresql://morubi_app:morubi_app@localhost:5433/morubi_test
TEST_AUTH_DATABASE_URL=postgresql://morubi_auth:morubi_auth@localhost:5433/morubi_test
TEST_WORKER_COORDINATOR_DATABASE_URL=postgresql://morubi_worker:morubi_worker@localhost:5433/morubi_test
```

Os testes críticos criam Organização A/B e provam isolamento em repository, RLS e API, audit append-only, invariância de owner, identidade externa por tenant, idempotência, provenance, sync inicial/incremental, retry de rate limit, partial replay e RLS forçado. A suíte de intelligence também cobre state/memory deltas, baixa confiança, contradição, override organizacional e um corpus de 55 cenários/110 eventos. O E2E web percorre auth, organização, membership, navegação por role, listas comerciais e a pendência explícita do CRM piloto.

## Autenticação

- Web: Better Auth com cookie `HttpOnly` emitido pelo Fastify.
- Desktop: o renderer envia credenciais somente por IPC validado ao processo main.
- O main mantém o cookie de sessão cifrado por `Electron.safeStorage` no diretório `userData`.
- Cookie/token nunca é entregue ao renderer nem guardado em `localStorage`.
- O ID da organização ativa não concede acesso: a API sempre valida a membership.

## Build desktop

```bash
pnpm build:desktop
```

O build local gera um diretório não assinado em `apps/desktop/release`. Distribuição pública exigirá:

- Windows: certificado de code signing;
- macOS: Developer ID, hardened runtime e notarization;
- canal de updates assinado (não implementado nesta fase).

## Documentação

Os documentos em [`docs/`](./docs) são a fonte de verdade. Novas decisões devem ser registradas em `docs/DECISIONS.md` antes de ampliar o escopo.

- [Guia do usuário do Desktop](./docs/DESKTOP_USER_GUIDE.md): instalação, permissões, calls, privacidade e solução de problemas em linguagem de cliente.
- [Compatibilidade do Desktop](./docs/DESKTOP_COMPATIBILITY.md): matriz real por sistema e hardware ainda pendente.
- [Distribuição do Desktop](./docs/DESKTOP_DISTRIBUTION.md): assinatura, dependência de áudio no macOS, licença e critérios de liberação comercial.
