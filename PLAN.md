# PLAN — roadmap executável (fonte de verdade)

Status: `PENDING`, `READY`, `IN_PROGRESS`, `IMPLEMENTED`, `WAITING_VALIDATION`, `VERIFIED`, `DONE`, `BLOCKED`.

> A evidência de dois PCs e o GO/NO-GO ficam no fim. Não bloqueiam a implementação de F03–F07. Bloqueiam o aceite final e o F08.

| ID | Fase | Tarefa | Depende de | Estado | Dono inicial | Gate |
|---|---|---|---|---|---|---|
| F01-01 | Fundação | Bootstrap monorepo pnpm e diretórios apps/packages | — | IMPLEMENTED | Grok | G1 |
| F01-02 | Fundação | Scaffolds mínimos Tauri/React e Fastify | F01-01 | IMPLEMENTED | Grok | G1 |
| F01-03 | Fundação | Typecheck/lint/test/build e CI | F01-02 | IMPLEMENTED | Grok | G1 |
| F01-04 | Fundação | ADRs e documentação ambiente | F01-02 | IMPLEMENTED | Claude review | G1 |
| F02-01 | POC | LiveKit local e credenciais dev sem commit | F01-02 | IMPLEMENTED | Grok | G2 |
| F03-01 | Identidade | Schema e migrations Postgres | F02-01 | IMPLEMENTED | Grok | G3 |
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
| F02-02 | POC | Conectar dois clientes Windows ao mesmo room | F02-01 | WAITING_VALIDATION | Grok | G2 |
| F02-03 | POC | Áudio bidirecional, mic/câmera e devices | F02-02 | WAITING_VALIDATION | Grok | G2 |
| F02-04 | POC | Captura de monitor e janela | F02-02 | WAITING_VALIDATION | Grok | G2 |
| F02-05 | POC | Redes distintas, TURN, reconexão, métricas | F02-03,F02-04 | WAITING_VALIDATION | Grok | G2 |
| F02-06 | POC | Decisão GO/NO-GO de Tauri/WebView2 | F02-05 | BLOCKED | Claude | G2 |
| F08-01 | OSS | Segurança/licença/docs/release candidate | F07-02, F02-06 GO | PENDING | Claude+Codex review | G8 |

## Estado em 2026-10-18

Nenhuma tarefa está `DONE`. F01-01–F01-04, F02-01 e F03-01 estão `IMPLEMENTED`. F03-02 segue `PENDING`. F02-02–F02-05 seguem `WAITING_VALIDATION` e foram para o fim do plano: M01–M12 continuam `NOT_RUN`. F02-06 segue `BLOCKED`, sem GO e sem NO-GO. O schema rodou no PGlite embutido; a API não conecta no boot. O aceite final e o F08 continuam dependendo da evidência de dois PCs. Se esse teste falhar, para e registra alternativa. Não marcar GO.

## Regras de promoção
- `READY`: dependências `IMPLEMENTED` ou `DONE`. O GO de F02-06 só é exigido no F08.
- `IMPLEMENTED`: alteração existe; ainda não implica testes ou review.
- `WAITING_VALIDATION`: teste manual exige humano/equipamento.
- `VERIFIED`: testes executados com evidências, revisões requeridas concluídas.
- `DONE`: verificado e aceito pelo gate correspondente.
- Falha crítica no teste de dois PCs, quando ele rodar → F02-06 `NO-GO`, parar F08 e registrar ADR de alternativa. Até lá a implementação de F03–F07 segue. Não marcar essas tarefas `DONE` nem escrever GO.

Leia o plano detalhado correspondente em `plans/phase-XX-*.md`.
