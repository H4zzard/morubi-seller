# CRM piloto — seleção pendente

**Estado em 2026-10-06:** `PILOT_CRM_PROVIDER = "<CRM_ESCOLHIDO>"` não foi substituído.

Este documento registra um blocker, não uma especificação de provider. HubSpot, Pipedrive, Kommo, Salesforce e RD Station CRM são apenas candidatos citados; nenhum foi escolhido ou implementado.

## O que não pode ser definido ainda

- modalidade de autenticação, OAuth endpoints, PKCE e revogação;
- scopes read-only e justificativa de cada scope;
- base URL, versão de API e DTOs;
- paginação, filtros incrementais e limites oficiais;
- webhooks disponíveis, assinatura, replay window e event IDs;
- acesso real a conversations/messages;
- semântica de archive/delete, owners, pipeline e stage;
- SLA, sandbox e limitações contratuais.

## Dados necessários para destravar o adapter

1. Nome exato do CRM piloto e versão de API suportada.
2. Design partner/conta sandbox e região de dados.
3. Tipo de app (public/private) e credenciais de desenvolvimento.
4. Objetos mínimos autorizados: contacts, deals, relationships, pipelines/stages e, se real, conversations/messages.
5. Política de backfill e frequência incremental.
6. Requisitos de secrets manager e ambiente de deploy.

## Critério antes de codificar

Após a escolha, revisar somente documentação oficial do provider e preencher um documento específico em `docs/integrations/<provider>.md` com auth, scopes, endpoints, paginação, limites, webhooks e limitações conhecidas. O adapter deve passar a contract suite existente e nunca adicionar tipos específicos ao core canônico.
