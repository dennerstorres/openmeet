# Fase 03 — identity

Objetivo: Autenticação e rooms seguras.

## Execução
Consultar as tarefas `F03-*` em `PLAN.md`, seus pré-requisitos e os quality gates. Dividir implementações em pequenos commits e evidenciar testes.

## Critério de saída
Testes API auth RBAC, token escopado, sessões rotativas.

## F03-01
Schema e a migration `0001_identity.sql` estão no servidor. O teste aplica esse SQL num Postgres embutido (PGlite). A API não abre conexão no boot. Login, RBAC e token LiveKit ficam em F03-02 e F03-03. A fase não fecha aqui.

## F03-02
Bootstrap único em `POST /api/v1/auth/bootstrap`, depois login, refresh e logout. O refresh antigo é revogado e aponta para o novo. Argon2id com memória 19456 KiB, 2 iterações e paralelismo 1. Não há página aberta de cadastro. Recuperação de conta ainda não tem endpoint: o operador troca o hash fora da API. A fase não fecha aqui.

## F03-03
Salas, convite de uso limitado, remoção de participante e encerramento. O token LiveKit sai só depois da autorização, com TTL de 10 minutos, sala única e identidade igual ao id do usuário. O código do convite não fica no banco. RBAC de abuso e a revisão do Codex continuam em F03-04. A fase não fecha aqui.

## Observação
F03-04 voltou para `IMPLEMENTED` em 2026-10-18, depois das correções do parecer. O boot abre `DATABASE_URL`, a moderação chama o SFU, o access token morre com a sessão, convite anterior não readmite, o CORS aceita PATCH/DELETE e login/bootstrap têm limite. G3 não foi reaprovado. PostgreSQL externo e desconexão num SFU ao vivo seguem sem prova. Parecer em `docs/reviews/F03-04-parecer.md`.

Não concluir fase por implementação superficial ou mocks. Dependências externas e validações reais precisam de evidência ou status WAITING_VALIDATION.
