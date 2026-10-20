# PLAN — roadmap executável (fonte de verdade)

Status: `PENDING`, `READY`, `IN_PROGRESS`, `IMPLEMENTED`, `WAITING_VALIDATION`, `VERIFIED`, `DONE`, `BLOCKED`.

> A evidência de dois PCs e o GO/NO-GO ficam no fim. Não bloqueiam a implementação de F03–F07, F09 nem F10. Bloqueiam o aceite final e o F08.

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
| F05-01 | Desktop | Bandeja, atalhos, notificações, sessão | F04-04 | IMPLEMENTED | Grok | G5 |
| F06-01 | Resiliência | Stats WebRTC/logs/reconexão/export | F05-01 | IMPLEMENTED | Grok | G6 |
| F07-01 | Infra | Compose/TLS/TURN/backup/restauração | F06-01 | IMPLEMENTED | Grok | G7 |
| F07-02 | Distribuição | Instalador Windows + CI release | F07-01 | IMPLEMENTED | Grok | G7 |
| F02-02 | POC | Conectar dois clientes Windows ao mesmo room | F02-01 | WAITING_VALIDATION | Grok | G2 |
| F02-03 | POC | Áudio bidirecional, mic/câmera e devices | F02-02 | WAITING_VALIDATION | Grok | G2 |
| F02-04 | POC | Captura de monitor e janela | F02-02 | WAITING_VALIDATION | Grok | G2 |
| F02-05 | POC | Redes distintas, TURN, reconexão, métricas | F02-03,F02-04 | WAITING_VALIDATION | Grok | G2 |
| F02-06 | POC | Decisão GO/NO-GO de Tauri/WebView2 | F02-05 | BLOCKED | Claude | G2 |
| F08-01 | OSS | Segurança/licença/docs/release candidate | F07-02, F02-06 GO | PENDING | Claude+Codex review | G8 |
| F09-01 | Servidores | Schema, API, migração Geral e token LiveKit pelo id da sala | F03-03 | IMPLEMENTED | Claude | G9 |
| F09-02 | Servidores | Convite do servidor por link openmeet:// | F09-01 | WAITING_VALIDATION | Claude | G9 |
| F09-03 | Sala | Três colunas, cards, destaque, grade, fixar e tela cheia | F09-01 | IMPLEMENTED | Claude | G9 |
| F09-04 | Sala | Presença na sidebar e anel de quem fala | F09-03 | WAITING_VALIDATION | Claude | G9 |
| F09-05 | Sala | Ensurdecer o áudio remoto só neste PC | F04-02 | IMPLEMENTED | Claude | G9 |
| F09-06 | Sala | Áudio do PC opcional no compartilhamento | F04-03 | WAITING_VALIDATION | Claude | G9 |
| F09-07 | Identidade | Login Google pelo navegador, chaves só no servidor | F03-02 | WAITING_VALIDATION | Claude | G9 |
| F10-01 | Segurança | Recusar controle e bidi nos nomes (S-21) | F03-03 | IMPLEMENTED | Claude | G10 |
| F10-02 | Segurança | Sala só para membro, sem username (S-01, S-10) | F03-03 | IMPLEMENTED | Claude | G10 |
| F10-03 | Segurança | Reuso de refresh revoga a família (S-03) | F03-02 | IMPLEMENTED | Claude | G10 |
| F10-04 | Segurança | Corte no SFU repetível e join na mesma trava (S-04) | F10-02 | WAITING_VALIDATION | Claude | G10 |
| F10-05 | Segurança | Desativar conta, senha, recuperação e corte no logout (S-02, S-18) | F10-03,F10-04 | WAITING_VALIDATION | Claude | G10 |
| F10-06 | Segurança | Grant só com as fontes autorizadas (S-09) | F10-04 | IMPLEMENTED | Claude | G10 |
| F10-07 | Segurança | Limite só atrás do segredo do proxy (S-11) | F07-01 | WAITING_VALIDATION | Claude | G10 |
| F10-08 | Segurança | Bootstrap sem oráculo e sem stdout (S-12) | F07-01 | WAITING_VALIDATION | Claude | G10 |
| F10-09 | Segurança | Contexto de build sem o .env da stack (S-19) | F07-01 | IMPLEMENTED | Claude | G10 |
| F10-10 | Segurança | TURN sem TLS externo e sem 5349 solto (S-20) | F07-01 | IMPLEMENTED | Claude | G10 |
| F10-11 | Segurança | Backup cifrado e contrato de firewall (S-17) | F07-01 | IMPLEMENTED | Claude | G10 |
| F10-12 | Segurança | Mídia e navegação só na origem do bundle (S-07, S-08) | F05-01 | WAITING_VALIDATION | Claude | G10 |
| F10-13 | Segurança | Capability mínima e CSP de base (S-14, S-15) | F05-01 | WAITING_VALIDATION | Claude | G10 |
| F10-14 | Segurança | Prova de mídia fora do instalador (S-13) | F05-01 | IMPLEMENTED | Claude | G10 |
| F10-15 | Segurança | Cofre de um slot, recusa outra origem (S-05) | F05-01 | WAITING_VALIDATION | Claude | G10 |
| F10-16 | Segurança | Contrato visível da bandeja (S-16) | F05-01 | WAITING_VALIDATION | Claude | G10 |
| F10-17 | Segurança | Login, refresh e logout no processo nativo (S-05, S-18) | F10-05,F10-07,F10-15 | WAITING_VALIDATION | Claude | G10 |
| F10-18 | Segurança | Salas e join no processo nativo (S-06) | F10-17 | WAITING_VALIDATION | Claude | G10 |
| F11-01 | Marca | Novo ícone do app e variantes | F07-02 | WAITING_VALIDATION | Claude | G7 |
| F12-01 | Web | Aceitar ADR 0014 e atualizar a SPEC | — | DONE | Humano | G12 |
| F12-02 | Web | Sessão por cookie HttpOnly na API | F12-01 | IMPLEMENTED | Grok | G12 |
| F12-03 | Web | Alvo web do frontend, instância na origem | F12-01 | IMPLEMENTED | Grok | G12 |
| F12-04 | Web | API serve o bundle web com CSP própria | F12-03 | IMPLEMENTED | Grok | G12 |
| F12-05 | Web | Convite e Google no navegador | F12-02,F12-03 | IMPLEMENTED | Grok | G12 |
| F12-06 | Web | Mídia conforme o navegador | F12-03 | IMPLEMENTED | Grok | G12 |
| F12-07 | Web | Prova em Chrome, Edge e Firefox em dois PCs | F12-04,F12-05,F12-06 | WAITING_VALIDATION | Humano | G12 |

## Estado em 2026-10-19

O `.exe` passou a renovar o access token de 15 min durante o uso (complemento da F10-18): um 401 faz um refresh só e repete a chamada. Falta ver no instalador uma sessão passar de 15 min.

F12-02 ficou `IMPLEMENTED` na branch `task/F12-02-cookie`: login, bootstrap, Google, refresh e senha gravam `om_access` e `om_refresh` quando o pedido traz `X-OpenMeet-Web: 1` e a origem da página; o corpo não leva token. O `.exe` segue com `Bearer`. Falta o navegador real (F12-07).

F12-01 está `DONE`: o ADR 0014 foi aceito em 2026-10-19 e a SPEC tem o item 17, o RF-19 e o RF-02 com cookie na web. F12-02 e F12-03 passaram a `READY`.

F12 entrou com o desenho do cliente web (ADR 0014, `plans/phase-12-web.md`): a instância serve o mesmo frontend em `https://{API_DOMAIN}/`, com sessão em cookie `HttpOnly`. Bandeja, atalhos e cofre não existem na web; áudio do PC depende do navegador. F12-01 espera o aceite do ADR. Nada implementado.

F10-18 ficou `WAITING_VALIDATION` na branch `task/F10-18-salas-nativas`: o access token sai da página; salas, servidores, convites, presença e join passam pelo Rust com lista fechada de rotas. Falta o instalador contra uma instância real. Com isso as 18 tarefas da F10 têm código; nenhuma está `DONE`.

F10-17 ficou `WAITING_VALIDATION` na branch `task/F10-17-auth-nativa`: login, bootstrap, Google, refresh e logout no Rust; o refresh não entra na página. Falta o instalador contra uma instância real. F10-18 passou a `READY` com essa espera.

F10-16 ficou `WAITING_VALIDATION` na branch `task/F10-16-bandeja`: "Fechar o OpenMeet" e "Sair da conta" separados na bandeja, aviso único ao fechar. Falta ver no instalador.

F10-15 ficou `WAITING_VALIDATION` na branch `task/F10-15-cofre`: um slot só no cofre, outra origem recusada. Falta o Gerenciador de Credenciais real no instalador.

F10-14 ficou `IMPLEMENTED` na branch `task/F10-14-prova`: a prova de mídia e o link só existem no `tauri dev`; o bundle de produção não tem nenhum dos dois.

F10-13 ficou `WAITING_VALIDATION` na branch `task/F10-13-capability`: sem `core:default`, devtools negado, CSP com `base-uri none` e sem estilo inline. Falta abrir o instalador.

F10-12 ficou `WAITING_VALIDATION` na branch `task/F10-12-origem`: release não dá mídia à porta 1420 e a janela recusa navegar ou abrir outra janela. Falta ver no WebView2 do instalador.

F10-11 ficou `IMPLEMENTED` na branch `task/F10-11-backup`: backup cifrado com `BACKUP_KEY`, ACL no Windows e lista de portas do firewall. Ida e volta provada com Postgres descartável.

F10-10 ficou `IMPLEMENTED` na branch `task/F10-10-turn`: TLS externo de TURN recusado e `5349` só com certificado.

F10-09 ficou `IMPLEMENTED` na branch `task/F10-09-dockerignore`: o `.env` da stack fica fora do contexto de build, provado com `docker build` local.

F10-08 ficou `WAITING_VALIDATION` na branch `task/F10-08-bootstrap`: bootstrap fechado responde 404 único e o token sai do stdout e do processo. Falta rodar o entrypoint e o `--clear-bootstrap` na stack real.

F10-07 ficou `WAITING_VALIDATION` na branch `task/F10-07-proxy`: limite só com o segredo do Caddy, teto de chaves e limite de refresh. Falta subir a stack real e ver o Caddy entregando o cabeçalho.

F10-06 ficou `IMPLEMENTED` na branch `task/F10-06-grant`: o token da sala só publica microfone, câmera, tela e áudio da tela, sem canal de dados nem admin.

F10-05 ficou `WAITING_VALIDATION` na branch `task/F10-05-desativar`: desativar, reativar, troca e recuperação de senha, e logout que corta a chamada. Falta rodar a recuperação no container e ver o corte no LiveKit real.

F10-04 ficou `WAITING_VALIDATION` na branch `task/F10-04-corte`: o código e os testes com SFU falso estão prontos; falta ver o LiveKit real recusar o token antigo depois do corte. F10-05 e F10-06 passaram a `READY` com essa espera, como a F05-01 foi liberada antes.

F10-03 ficou `IMPLEMENTED` na branch `task/F10-03-refresh`: refresh já substituído revoga a família inteira, as outras famílias seguem. Migration `0005_session_family.sql`.

F10-02 ficou `IMPLEMENTED` na branch `task/F10-02-membro`, sobre a F10-01: membro da sala não vê o login dos outros, e sem membership nem convite o join é 403 antes de dizer se a sala acabou. O ramo de admin já tinha saído na F09-01. F10-04 passou a `READY`.

F10-01 ficou `IMPLEMENTED` na branch `task/F10-01-nomes`: uma função em `packages/shared` recusa controle e bidi no nome da pessoa, da sala, do servidor e da instância. Migration `0004_display_name.sql` troca os CHECKs. Falta a revisão do G10.

F11-01 ficou `WAITING_VALIDATION`: símbolo C (anel com ponto central e ponto de ao vivo) em verde #16a34a com branco. Fontes em `apps/desktop/brand/`: verde, branco no preto, preto no branco, verde no escuro e só o símbolo. Ícones do Tauri regenerados por `tauri icon`. Falta ver o ícone instalado no Windows (atalho, barra de tarefas e bandeja).

F09-07 ficou `WAITING_VALIDATION` na branch `task/F09-07-google`, sobre a F09-06: login Google pelo navegador do sistema, chaves só no servidor. Falta um cliente OAuth real e o clique no instalador. Com isso as sete tarefas F09 têm código; nenhuma está `DONE`.

F09-06 ficou `WAITING_VALIDATION` na branch `task/F09-06-audio-pc`, sobre a F09-05: marca "Incluir áudio do PC" e aviso quando a origem não traz o som. Falta a prova do ADR 0008 em dois PCs. A F10-06 precisa liberar `screen_share_audio` no grant.

F09-05 ficou `IMPLEMENTED` na branch `task/F09-05-ensurdecer`, sobre a F09-04: botão Ensurdecer na barra, só neste PC. Não foi ouvido em chamada real.

F09-04 ficou `WAITING_VALIDATION` na branch `task/F09-04-presenca`, sobre a F09-02: nomes debaixo de cada sala e anel verde de quem fala. Falta ver o anel com áudio real em dois PCs.

F09-02 ficou `WAITING_VALIDATION` na branch `task/F09-02-convite`, sobre a F09-03: link `openmeet://`, página `/convite/:code`, código colado e aceite depois do login. Falta o clique no link com o instalador novo no Windows.

F09-03 ficou `IMPLEMENTED` na branch `task/F09-03-layout`, sobre a F09-01: três colunas, card por pessoa e por compartilhamento, destaque, grade, fixar e tela cheia. Visto no navegador com dois participantes sem câmera. Câmera e tela reais no WebView2 ainda não foram vistas. F09-04 passou a `READY`.

F09-01 ficou `IMPLEMENTED` na branch `task/F09-01-servidores`: migration `0002_servers.sql`, rotas de servidor e token LiveKit pelo id da sala. F09-02 e F09-03 passaram a `READY`. A F10 precisa renumerar as migrations do desenho a partir de `0004`. O admin já não entra em servidor de que não é membro, o que adianta parte do S-01.

F10 entrou com os 18 PRs do desenho de segurança (`plans/phase-10-seguranca.md`). Treze estão `READY`. F10-04, F10-05, F10-06, F10-17 e F10-18 esperam outra F10. Nada implementado.

Nenhuma tarefa está `DONE`. F09-01, F09-05, F09-06 e F09-07 estão `READY`. F09-02, F09-03 e F09-04 estão `PENDING`. Nenhuma tarefa F09 foi implementada. Em 2026-10-19 os dois PCs com o instalador entraram na mesma sala. Microfone, câmera e compartilhamento de tela funcionaram. M01–M12 seguem `NOT_RUN`: faltam duração, resolução, rede distinta, parar e republicar, janela, queda de 5 s, TURN, troca de dispositivo, minimizar e diagnóstico. F02-02–F02-05 seguem `WAITING_VALIDATION`. F02-06 segue `BLOCKED`, sem GO e sem NO-GO.

## Estado em 2026-10-18

Nenhuma tarefa está `DONE`. F01-01–F01-04, F02-01, F03-01–F03-04 e F04-01–F04-03 estão `IMPLEMENTED`. O ADR 0005 abre `https:` e `wss:` na CSP e tira o domínio de teste. O ADR 0006 prende o access token à sessão. F03-04 saiu de `BLOCKED`: as correções do parecer estão no código e o G3 ainda não foi reaprovado. F04-04 está `WAITING_VALIDATION`: a reunião mostra relógio, métricas e troca de dispositivo, e a sala persistente continua na lista, mas os 60 min com cinco pessoas não rodaram. F05-01 foi autorizada com essa espera e ficou `IMPLEMENTED`: bandeja, atalhos só com consentimento, notificação e refresh no cofre do Windows. A janela não foi aberta. F06-01 ficou `IMPLEMENTED`: a reunião mede a reconexão e exporta o diagnóstico só com consentimento, sem token. A queda de rede de 5 s não rodou. F07-01 ficou `IMPLEMENTED`: Compose de um nó, LiveKit sem `--dev`, proxy TLS, TURN opcional e backup. O restore local devolveu a linha e a API ficou ready. A VPS não foi usada. F07-02 ficou `IMPLEMENTED`: o NSIS local saiu e o workflow de release só publica numa tag. O CI não rodou no GitHub e o instalador não foi aberto numa máquina sem toolchain. F08 segue `PENDING`. F02-02–F02-05 seguem `WAITING_VALIDATION`. M01–M12 continuam `NOT_RUN`. F02-06 segue `BLOCKED`, sem GO e sem NO-GO. O aceite final e o F08 continuam dependendo da evidência de dois PCs. Se esse teste falhar, para e registra alternativa. Não marcar GO.

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
- Falha crítica no teste de dois PCs, quando ele rodar → F02-06 `NO-GO`, parar F08 e registrar ADR de alternativa. Até lá a implementação de F03–F07 e F09 segue. Não marcar essas tarefas `DONE` nem escrever GO.

Leia o plano detalhado correspondente em `plans/phase-XX-*.md`.
