# OpenMeet — harness de desenvolvimento (nome provisório)

Projeto open source, desktop-first para reuniões de áudio, vídeo e compartilhamento de tela, instalável no Windows via Tauri 2 e hospedado em infraestrutura própria.

> **Este pacote contém documentação operacional e planejamento, não contém o aplicativo implementado.** O nome é apenas um codinome e deve ser validado antes de publicar.

## Objetivo do primeiro ciclo

Executar um POC real com **dois PCs Windows em redes diferentes**, LiveKit self-hosted e clientes Tauri 2. Validar áudio bidirecional, câmera, captura de monitor e janela, reconexão e estatísticas, antes de investir na UI completa.

## Começar

1. Instale Git, Node.js LTS, pnpm via Corepack, Rust, Microsoft C++ Build Tools, WebView2 e Docker Desktop/Engine (conforme máquina).
2. Abra o diretório com Git inicializado: `git init`.
3. Leia `AGENTS.md`, `SPEC.md`, `PLAN.md`, `docs/ARCHITECTURE.md` e `docs/TEST_MATRIX.md`.
4. Execute `grok` nesta pasta, autentique-se e cole o texto de `agents/grok/START_PROMPT.md`.
5. Execute somente tarefas `READY` do plano. Não invente evidência de testes manuais.

**Ordem obrigatória:** fundação → prova de conceito de mídia → decisão de viabilidade → demais fases.

## Agentes
- Grok 4.7: implementação principal (~75% das tarefas, meta de alocação).
- Claude: arquitetura e segurança (~15%).
- Codex: revisão de código e testes (~10%).

Os percentuais são metas de distribuição, não métrica de consumo. A aprovação é decidida pelos gates, não por um agente individual.

## Documentos-chave
- `SPEC.md`: requisitos e não-objetivos
- `PLAN.md` + `plans/`: tarefas e critérios por fase
- `AGENTS.md`: contrato universal
- `orchestration/`: workflow, estado, quality gates e handoffs
- `docs/TEST_MATRIX.md`: evidências de testes reais
- `HISTORY.md`: progresso, bloqueios, decisões
- `docs/adr/`: decisões e alternativas

## Referências oficiais
- https://v2.tauri.app/
- https://docs.livekit.io/
- https://docs.x.ai/build/overview
- https://docs.x.ai/build/cli/reference

## Status
Fundação e SFU local implementados em 2026-10-18, sem commit e sem revisão. Áudio, câmera e captura de tela continuam NOT_RUN. Ver `HISTORY.md` e `docs/POC_F02.md`.
