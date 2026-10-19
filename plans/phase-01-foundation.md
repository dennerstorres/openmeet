# Fase 01 — foundation

Objetivo: Monorepo e ferramentas reproduzíveis.

## Execução
Consultar as tarefas `F01-*` em `PLAN.md`, seus pré-requisitos e os quality gates. Dividir implementações em pequenos commits e evidenciar testes.

## Critério de saída
Scripts completos passam em ambiente novo; CI verde.

## Observação
Não concluir fase por implementação superficial ou mocks. Dependências externas e validações reais precisam de evidência ou status WAITING_VALIDATION.

## Execução 2026-10-18
F01-01 a F01-04 estão IMPLEMENTED. O parecer está em `docs/reviews/F01-04-review.md`. R1–R4 foram tratados no código e no CI: CSP pelo ADR 0005, `format:check`, endpoints e `permissions: contents: read`. `cargo check` permanece local. O CI ainda não rodou no GitHub. R5, os ADRs 0001–0003, segue aberto. Detalhe em `HISTORY.md`.
