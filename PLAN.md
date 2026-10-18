# PLAN — roadmap executável (fonte de verdade)

Status: `PENDING`, `READY`, `IN_PROGRESS`, `IMPLEMENTED`, `WAITING_VALIDATION`, `VERIFIED`, `DONE`, `BLOCKED`.

> Todas as tarefas estão inicialmente não iniciadas. A Fase 2 é bloqueante para qualquer expansão de produto além da fundação.

| ID | Fase | Tarefa | Depende de | Estado | Dono inicial | Gate |
|---|---|---|---|---|---|---|
| F01-01 | Fundação | Bootstrap monorepo pnpm e diretórios apps/packages | — | IMPLEMENTED | Grok | G1 |
| F01-02 | Fundação | Scaffolds mínimos Tauri/React e Fastify | F01-01 | IMPLEMENTED | Grok | G1 |
| F01-03 | Fundação | Typecheck/lint/test/build e CI | F01-02 | IMPLEMENTED | Grok | G1 |
| F01-04 | Fundação | ADRs e documentação ambiente | F01-02 | IMPLEMENTED | Claude review | G1 |
| F02-01 | POC | LiveKit local e credenciais dev sem commit | F01-02 | IMPLEMENTED | Grok | G2 |
| F02-02 | POC | Conectar dois clientes Windows ao mesmo room | F02-01 | WAITING_VALIDATION | Grok | G2 |
| F02-03 | POC | Áudio bidirecional, mic/câmera e devices | F02-02 | WAITING_VALIDATION | Grok | G2 |
| F02-04 | POC | Captura de monitor e janela | F02-02 | WAITING_VALIDATION | Grok | G2 |
| F02-05 | POC | Redes distintas, TURN, reconexão, métricas | F02-03,F02-04 | WAITING_VALIDATION | Grok | G2 |
| F02-06 | POC | Decisão GO/NO-GO de Tauri/WebView2 | F02-05 | BLOCKED | Claude | G2 |
| F03-01 | Identidade | Schema e migrations Postgres | F02-06 GO | PENDING | Grok | G3 |
| F03-02 | Identidade | Bootstrap/admin, login e sessões seguras | F03-01 | PENDING | Grok | G3 |
| F03-03 | Identidade | Rooms, convites, RBAC e token LiveKit | F03-02 | PENDING | Grok | G3 |
| F03-04 | Identidade | Testes de abuso e auth | F03-03 | PENDING | Codex review | G3 |
| F04-01 | Reuniões | UI de instância, salas, reunião | F03-03 | PENDING | Grok | G4 |
| F04-02 | Reuniões | Controles de volume/mute/câmera | F04-01 | PENDING | Grok | G4 |
| F04-03 | Reuniões | Compartilhamento e layouts | F04-01 | PENDING | Grok | G4 |
| F04-04 | Reuniões | E2E 5 participantes e persistência | F04-02,F04-03 | PENDING | Codex review | G4 |
| F05-01 | Desktop | Bandeja, atalhos, notificações, sessão | F04-04 | PENDING | Grok | G5 |
| F06-01 | Resiliência | Stats WebRTC/logs/reconexão/export | F05-01 | PENDING | Grok | G6 |
| F07-01 | Infra | Compose/TLS/TURN/backup/restauração | F06-01 | PENDING | Grok | G7 |
| F07-02 | Distribuição | Instalador Windows + CI release | F07-01 | PENDING | Grok | G7 |
| F08-01 | OSS | Segurança/licença/docs/release candidate | F07-02 | PENDING | Claude+Codex review | G8 |

## Estado em 2026-10-18

Nenhuma tarefa está `DONE`. F01-01–F01-04 e F02-01 estão `IMPLEMENTED`. F02-02–F02-05 estão `WAITING_VALIDATION`: o cliente de POC existe, M01–M12 seguem `NOT_RUN`. F02-06 está `BLOCKED` até haver evidência real e a decisão do Claude. Parecer provisório em `docs/reviews/F02-06-parecer.md`: 4 pendências altas (A1–A4) antes de M01. F03+ continua congelada. Revisão de Claude/Codex e CI remoto ainda não ocorreram.

## Regras de promoção
- `READY`: todas as dependências DONE, exceto explicitamente marcadas GO como F02-06.
- `IMPLEMENTED`: alteração existe; ainda não implica testes ou review.
- `WAITING_VALIDATION`: teste manual exige humano/equipamento.
- `VERIFIED`: testes executados com evidências, revisões requeridas concluídas.
- `DONE`: verificado e aceito pelo gate correspondente.
- Falha crítica de POC → F02-06 `NO-GO`, congelar F03+, registrar ADR de alternativa; nunca prosseguir presumindo compatibilidade.

Leia o plano detalhado correspondente em `plans/phase-XX-*.md`.
