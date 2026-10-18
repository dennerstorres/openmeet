# Fase 02 — media-poc

Objetivo: Validar mic/câmera/screen no Tauri com LiveKit.

## Execução
Consultar as tarefas `F02-*` em `PLAN.md`, seus pré-requisitos e os quality gates. Dividir implementações em pequenos commits e evidenciar testes.

## Critério de saída
M01 a M08, GO/NO-GO registrado no ADR 0004.

## Observação
Não concluir fase por implementação superficial ou mocks. Dependências externas e validações reais precisam de evidência ou status WAITING_VALIDATION.

## Execução 2026-10-18
F02-01 IMPLEMENTED: compose em `infra/livekit/docker-compose.yml` subiu `livekit/livekit-server:v1.13.10` em `127.0.0.1:7880` (HTTP 200) e o container foi removido.

F02-02 a F02-05 WAITING_VALIDATION: token local, conexão LiveKit, controles de mic/câmera/dispositivos, compartilhamento e métricas estão no código. Testes unitários passaram. M01–M08 seguem NOT_RUN. F02-06 BLOCKED. Roteiro em `docs/POC_F02.md`. Sem GO/NO-GO.
