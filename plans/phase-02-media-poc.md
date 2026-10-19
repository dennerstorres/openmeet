# Fase 02 — media-poc

Objetivo: Validar mic/câmera/screen no Tauri com LiveKit.

## Execução
Consultar as tarefas `F02-*` em `PLAN.md`, seus pré-requisitos e os quality gates. Dividir implementações em pequenos commits e evidenciar testes.

## Critério de saída
G2: M01 a M10, mais os itens do ADR 0004 (dev e build, duas versões do Windows, vários monitores, minimizar e restaurar, parar/publicar/republicar, permissão negada). O GO/NO-GO continua no ADR 0004 e ainda não foi dado.
M11 fica no G4. M12 fica no G3.

## Observação
Não concluir fase por implementação superficial ou mocks. Dependências externas e validações reais precisam de evidência ou status WAITING_VALIDATION.

## Mute do microfone
`stopMicTrackOnMute` permanece `false`. Desligar o microfone é mute de publicação: a captura continua e o indicador do Windows pode ficar aceso. A faixa não é parada de propósito.

## Execução 2026-10-18
F02-01 IMPLEMENTED: compose em `infra/livekit/docker-compose.yml` subiu `livekit/livekit-server:v1.13.10` em `127.0.0.1:7880` (HTTP 200) e o container foi removido.

F02-02 a F02-05 WAITING_VALIDATION, no fim do plano: token local, conexão LiveKit, controles de mic/câmera/dispositivos, compartilhamento e métricas estão no código. Testes unitários passaram. M01–M12 seguem NOT_RUN. F02-06 BLOCKED. F03–F07 podem seguir. Roteiro em `docs/POC_F02.md`. Sem GO/NO-GO.
