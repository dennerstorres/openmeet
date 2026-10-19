# Fase 03 — identity

Objetivo: Autenticação e rooms seguras.

## Execução
Consultar as tarefas `F03-*` em `PLAN.md`, seus pré-requisitos e os quality gates. Dividir implementações em pequenos commits e evidenciar testes.

## Critério de saída
Testes API auth RBAC, token escopado, sessões rotativas.

## F03-01
Schema e a migration `0001_identity.sql` estão no servidor. O teste aplica esse SQL num Postgres embutido (PGlite). A API não abre conexão no boot. Login, RBAC e token LiveKit ficam em F03-02 e F03-03. A fase não fecha aqui.

## Observação
Não concluir fase por implementação superficial ou mocks. Dependências externas e validações reais precisam de evidência ou status WAITING_VALIDATION.
