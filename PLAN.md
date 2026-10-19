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
| F03-02 | Identidade | Bootstrap/admin, login e sessões seguras | F03-01 | IMPLEMENTED | Grok | G3 |
| F03-03 | Identidade | Rooms, convites, RBAC e token LiveKit | F03-02 | IMPLEMENTED | Grok | G3 |
| F03-04 | Identidade | Testes de abuso e auth | F03-03 | IMPLEMENTED | Codex review | G3 |
| F04-01 | Reuniões | UI de instância, salas, reunião | F03-03 | IMPLEMENTED | Grok | G4 |
| F04-02 | Reuniões | Controles de volume/mute/câmera | F04-01 | IMPLEMENTED | Grok | G4 |
| F04-03 | Reuniões | Compartilhamento e layouts | F04-01 | IMPLEMENTED | Grok | G4 |
| F04-04 | Reuniões | E2E 5 participantes e persistência | F04-02,F04-03 | WAITING_VALIDATION | Codex review | G4 |
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

Nenhuma tarefa está `DONE`. F01-01–F01-04, F02-01, F03-01–F03-04 e F04-01–F04-03 estão `IMPLEMENTED`. O ADR 0005 abre `https:` e `wss:` na CSP e tira o domínio de teste. O ADR 0006 prende o access token à sessão. F03-04 saiu de `BLOCKED`: as correções do parecer estão no código e o G3 ainda não foi reaprovado. F04-04 está `WAITING_VALIDATION`: a reunião mostra relógio, métricas e troca de dispositivo, e a sala persistente continua na lista, mas os 60 min com cinco pessoas não rodaram. F05-01 segue `PENDING`. F02-02–F02-05 seguem `WAITING_VALIDATION`. M01–M12 continuam `NOT_RUN`. F02-06 segue `BLOCKED`, sem GO e sem NO-GO. O aceite final e o F08 continuam dependendo da evidência de dois PCs. Se esse teste falhar, para e registra alternativa. Não marcar GO.

### Revisões — correções em 2026-10-18

F03-04: o boot usa `DATABASE_URL` e o readiness deixa de mentir; encerrar sala e remover membro chamam o SFU e um 502 não desfaz a revogação; logout e rotação matam o access token daquela sessão; convite anterior não readmite; CORS libera PATCH e DELETE; login e bootstrap têm limite por usuário e por IP, com `TRUST_PROXY=1` para o primeiro hop. PostgreSQL externo e um SFU ao vivo não foram provados. O parecer original continua em `docs/reviews/F03-04-parecer.md`.

F01-04: R1 fechado pelo ADR 0005. R2: `pnpm format:check` entrou no CI. `cargo check` fica fora do CI e continua como passo local, porque o runner não tem o Rust fixado. R3: a lista de endpoints e `GET /api/v1/instance` batem com o servidor. R4: o workflow declara `permissions: contents: read`. O pin das actions por SHA fica para o G7. R5 segue aberto nos ADRs 0001–0003.

F02-06: A2, A3, A4, M1–M3, M5, M6 e B1–B4 já estavam no histórico. O handler de permissão do desktop libera microfone, câmera, tela e autoplay só na origem do app. A1, a topologia remota, continua sem autorização de deploy. M01–M12 seguem `NOT_RUN`. Sem GO.

## Regras de promoção
- `READY`: dependências `IMPLEMENTED` ou `DONE`. O GO de F02-06 só é exigido no F08.
- `IMPLEMENTED`: alteração existe; ainda não implica testes ou review.
- `WAITING_VALIDATION`: teste manual exige humano/equipamento.
- `VERIFIED`: testes executados com evidências, revisões requeridas concluídas.
- `DONE`: verificado e aceito pelo gate correspondente.
- Falha crítica no teste de dois PCs, quando ele rodar → F02-06 `NO-GO`, parar F08 e registrar ADR de alternativa. Até lá a implementação de F03–F07 segue. Não marcar essas tarefas `DONE` nem escrever GO.

Leia o plano detalhado correspondente em `plans/phase-XX-*.md`.
