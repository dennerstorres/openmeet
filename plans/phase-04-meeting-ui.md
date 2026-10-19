# Fase 04 — meeting-ui

Objetivo: UI de reunião e controles.

## Execução
Consultar as tarefas `F04-*` em `PLAN.md`, seus pré-requisitos e os quality gates. Dividir implementações em pequenos commits e evidenciar testes.

## Critério de saída
M09, A05-A07 e 60 min com cinco pessoas.

## F04-01
A janela padrão confirma `GET /api/v1/instance` antes de enviar senha. Login, bootstrap, salas e entrada usam só essa origem. Sair da sala volta à lista. A prova de mídia fica em `?poc=1`. O ADR 0005 libera `https:` e `wss:` na CSP. O refresh fica na memória do processo, separado por origem, e some ao reiniciar: o cofre nativo ainda não foi avaliado. Controles de mídia ficam na F04-02. A fase não fecha aqui.

## Observação
Não concluir fase por implementação superficial ou mocks. Dependências externas e validações reais precisam de evidência ou status WAITING_VALIDATION.
