# HISTORY — registro cronológico

### 2026-10-18 — correções das revisões numa branch só — Grok
Branch `main`, a partir de `task/F01-04-review`. F03-04 voltou para `IMPLEMENTED`. O boot abre `DATABASE_URL` e fecha a conexão no shutdown. Readiness responde `ok` ou `error`. Encerrar sala e remover membro chamam o LiveKit, revogam o token anterior e devolvem 502 se o SFU falhar, sem desfazer o banco. O access token carrega a sessão e morre no logout e na rotação; a outra sessão segue válida. Convite anterior à remoção não readmite; convite posterior readmite. CORS aceita PATCH e DELETE. Login e bootstrap têm limite, e `TRUST_PROXY=1` usa só o primeiro hop. ADR 0006 registra o token. O handler da janela libera microfone, câmera, tela e autoplay só na origem do app. `format:check` e `permissions: contents: read` entraram no CI. `cargo check` continua local. A UI de reunião do F04-01 entrou no mesmo commit.
`pnpm test` exit 0: workspace 9, shared 17, media 16, server 26, desktop 2. `pnpm typecheck`, `pnpm lint` e `pnpm format:check` exit 0. `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` exit 0 em 1m29s. Windows, Node v24.18.0, pnpm 10.30.2. A janela não foi aberta. PostgreSQL externo e SFU ao vivo não rodaram. G3 não foi reaprovado. F02-06 segue `BLOCKED`. M01–M12 seguem NOT_RUN. Sem GO/NO-GO. Sem push.

### 2026-10-18 — UI de instância, salas e reunião — Grok
F04-01 ficou `IMPLEMENTED`. `GET /api/v1/instance` devolve nome, `v1` e se o bootstrap está aberto, sem segredo. A janela confirma essa origem antes do login, lista as salas e entra na reunião. Sair volta para a lista. `?poc=1` abre a prova de mídia. O ADR 0005 troca a CSP para `https:` e `wss:`, sem domínio pessoal. O refresh fica só na memória e não sobrevive ao reinício. `pnpm --filter @openmeet/shared test` 17 pass. `pnpm --filter @openmeet/server test` 18 pass, fail 0, Windows, PGlite. `pnpm --filter @openmeet/desktop typecheck` exit 0. A janela não foi aberta. A API no ar não foi reiniciada e segue sem banco. F03-04 segue `BLOCKED`. F04-02 não começou. M01–M12 seguem NOT_RUN. Sem commit. Sem GO/NO-GO.

### 2026-10-18 — revisão F01-04 — Claude
Branch `task/F01-04-review`, base `9b5bf94`, sem commit. Parecer em `docs/reviews/F01-04-review.md`. F01-04 segue `IMPLEMENTED`: o CI nunca rodou no GitHub. `pnpm format:check` falha em 5 arquivos. A seção Senha do ENVIRONMENT confere com o código. Windows 11, Node v24.18.0, pnpm 10.30.2. Não rodou `cargo check` nem a janela.
Achados: R1 alto, a CSP do desktop só conecta em `127.0.0.1:3000` e no domínio do VPS e impede o multi-instância do ADR 0003. R2 médio, CI sem `format:check` e sem `cargo check`. R3 médio, endpoints do ARCHITECTURE divergem do servidor e falta `GET /instance`. R4 baixo, CI sem `permissions`. R5 baixo, ADRs sem data e consequências, sem ADR do banco nem do token HMAC.
Próximo passo: ADR da CSP/HTTP do desktop antes do F04-01. Executor corrige R2–R4. M01–M12 seguem NOT_RUN. Sem GO/NO-GO.

### 2026-10-18 — revisão F03-04 concluída com bloqueios — Codex
Branch: `task/F03-04-auth-review`; base `d746a5eb35230b7c9806383286c45642ed20763d`, sem commit novo. Plataforma Windows/PowerShell, Node v24.18.0, pnpm 10.30.2.
Alterados: testes auth/rooms, PLAN, plano fase 03, HISTORY; criado `docs/reviews/F03-04-parecer.md`. Nenhuma alteração em código de produção.
Comandos/resultados: `pnpm --filter @openmeet/server test` exit 0, 15/15; `pnpm lint`, `pnpm typecheck`, `pnpm build` exit 0. Build avisa chunk >500 kB, não inclui instalador. `pnpm exec prettier --write apps/server/test/auth.test.ts apps/server/test/rooms.test.ts` exit 0.
Achados: A1 runtime sem banco; A2 moderação sem ação SFU; A3 access token sobrevive logout; A4 convite anterior readmite removido; M1 CORS impede PATCH/DELETE; M2 ausência de limitação de tentativas. Evidências e critérios no parecer. Caracterizações passam ao reproduzir defeitos, não aprovam segurança.
Estado final: F03-04 BLOCKED, G3 não aprovado; nenhum DONE. PGlite/inject e assinatura real, sem PostgreSQL externo, concorrência real ou mídia em dois PCs. M01–M12 não alterados; sem GO/NO-GO.
Próximo passo: executor corrige achados, atualiza expectativas dos testes e entrega para nova revisão/validação operacional.

### 2026-10-18 — início F03-04 — Codex
Branch: `task/F03-04-auth-review`. Dependência F03-03 IMPLEMENTED; F03-04 promovida de PENDING para READY antes da execução.
Escopo: revisão de auth/RBAC/convites/tokens, testes negativos e reprodução dos achados, sem alterar segurança em produção.
Arquivos previstos: `apps/server/test/auth.test.ts`, `apps/server/test/rooms.test.ts`, `docs/reviews/F03-04-parecer.md`, `PLAN.md`, `plans/phase-03-identity.md`, `HISTORY.md`.
Plano de testes: suíte server com PGlite e assinaturas reais, lint, typecheck e build; distinguir reprodução de falha de aceite. Sem validação de mídia por mocks; PostgreSQL externo e dois PCs não presumidos.

### 2026-10-18 — salas, convite e token LiveKit — Grok
F03-03 ficou `IMPLEMENTED`. Admin cria sala e conta. Convite guarda só o hash e vale uma vez. Participante entra com token de 10 minutos, sala e identidade opaca. Remoção e sala encerrada bloqueiam o join. `pnpm --filter @openmeet/server test` 15 pass, fail 0, Windows, PGlite. `/health/ready` segue `not_configured`. A API no ar não recebeu banco. F03-04 não começou. M01–M12 seguem NOT_RUN. Sem GO/NO-GO.

### 2026-10-18 — bootstrap, login e sessão — Grok
F03-02 ficou `IMPLEMENTED`. Bootstrap de um admin, login, refresh com rotação e logout. Senha em Argon2id (19456 KiB, 2 iterações, paralelismo 1). Sessão, bootstrap e senha ficam só como hash. `pnpm --filter @openmeet/server typecheck` exit 0. `pnpm --filter @openmeet/server test` 13 pass, fail 0, Windows, PGlite. `/health/ready` segue `not_configured`. A API no ar não recebeu banco. F03-03 não começou. M01–M12 seguem NOT_RUN. Sem GO/NO-GO.

### 2026-10-18 — schema de identidade — Grok
F03-01 ficou `IMPLEMENTED`. SQL `apps/server/drizzle/0001_identity.sql` e o schema Drizzle cobrem usuários, sessões, salas, memberships, convites, auditoria, settings e bootstrap. Só entram hashes. `pnpm --filter @openmeet/server typecheck` exit 0. `pnpm --filter @openmeet/server test` 11 pass, fail 0, Windows. A migration rodou duas vezes no PGlite, não no VPS. `/health/ready` segue `not_configured`. F03-02 não começou. Sem commit. M01–M12 seguem NOT_RUN. Sem GO/NO-GO.

### 2026-10-18 — teste de dois PCs vai para o fim — Grok
F03-01 ficou `READY` e depende de F02-01. F02-02–F02-06 continuam sem evidência e passaram para o fim do plano. F08 só segue com o GO. F03–F07 podem ser implementadas. M01–M12 seguem NOT_RUN. Sem GO/NO-GO.

### 2026-10-18 — o que ainda não rodou — Grok
M01–M12 continuam NOT_RUN. Não houve mídia nos dois PCs: microfone nos dois sentidos, câmera, tela e janela no segundo PC. M4, a permissão ao vivo num perfil limpo do app empacotado, não rodou. O Claude não deu GO nem NO-GO. F02-06 segue BLOCKED. F03+ segue PENDING.

### 2026-10-18 — câmera remota muda quando silencia — Grok
`TrackMuted` e `TrackUnmuted` atualizam o tile. Câmera silenciada deixa de ser quadro ao vivo e a tela mostra `vídeo pausado`. `pnpm --filter @openmeet/media test` 16 pass, build e typecheck do desktop exit 0. A janela não foi clicada. M01–M12 continuam NOT_RUN.

### 2026-10-18 — dispositivos mostram rótulo e o ativo — Grok
Depois da permissão, o rótulo aparece. Sem permissão, a lista diz `permissão pendente`. A lista atualiza no `MediaDevicesChanged` e marca o dispositivo ativo. `pnpm --filter @openmeet/media test` 15 pass, build e typecheck do desktop exit 0. A janela não foi clicada. M01–M12 continuam NOT_RUN.

### 2026-10-18 — mute do microfone continua capturando — Grok
`stopMicTrackOnMute` permanece `false`. Desligar o microfone silencia a publicação e não para a captura. M01–M12 continuam NOT_RUN.

### 2026-10-18 — G2 fecha em M01–M10 — Grok
G2 passa a ser M01–M10 mais os itens do ADR 0004. M11 fica no G4 e M12 no G3. Nenhum caso virou PASS. Sem GO/NO-GO. M01–M12 continuam NOT_RUN.

### 2026-10-18 — tauri build sem instalador — Grok
O release gerou `apps/desktop/src-tauri/target/release/openmeet-desktop.exe`. O MSI não saiu: o download do WiX parou em `timeout: global`. Não é CI PASS nem pacote instalável. M01–M12 continuam NOT_RUN.

### 2026-10-18 — CSP da POC e restos do template — Grok
A CSP de distribuição deixa a API local, `wss`, `blob:` e `mediastream:`. O comando `greet` e a permissão `opener:default` saíram. `cargo check` do shell exit 0. A janela não foi reaberta. M01–M12 continuam NOT_RUN.

### 2026-10-18 — desconexão mostra o motivo — Grok
Falha recuperável fica em `reconnecting`. Falha fatal fica em `fatal` com o `DisconnectReason`. Sair fica em `disconnected` com `CLIENT_INITIATED`. `pnpm --filter @openmeet/media test` 14 pass, build e `pnpm --filter @openmeet/desktop typecheck` exit 0. A janela não foi clicada. M01–M12 continuam NOT_RUN.

### 2026-10-18 — diagnóstico lê o relatório da faixa — Grok
O resumo mostra candidato `host`, `srflx` ou `relay`, fps e resolução de saída, `displaySurface`, `userAgent` e a versão do app. O jitter guardado é o pior. O RTT é o do par nominado com maior atraso. A sessão chama `getRTCStatsReport()` da faixa. `pnpm --filter @openmeet/media test` 13 pass, build e `pnpm --filter @openmeet/desktop typecheck` exit 0. A janela não foi clicada. M01–M12 continuam NOT_RUN.

### 2026-10-18 — erro de mídia aparece na tela — Grok
Microfone, câmera e tela mostram o erro no banner e travam o botão enquanto a ação está pendente. Cancelar o seletor de tela diz `NotAllowedError: permissão negada ou seleção cancelada`. `refreshStats` não rejeita mais a cada 5 s se o peer connection fechou. `pnpm --filter @openmeet/media test` 7 pass, build e `pnpm --filter @openmeet/desktop typecheck` exit 0. A janela não foi clicada. M01–M12 continuam NOT_RUN.

### 2026-10-18 — servidor lê o .env da raiz — Grok
`pnpm --filter @openmeet/server dev` e `start` usam `node --env-file-if-exists=../../.env`. Arquivo ausente não impede a subida. Variável já definida no terminal não é trocada. `pnpm --filter @openmeet/server test` 10 pass. O processo que aponta para o VPS não foi reiniciado. M01–M12 continuam NOT_RUN.

### 2026-10-18 — join do POC só em loopback — Grok
Com `POC_JOIN=1`, `HOST` fora de loopback impede o boot. A rota não é registrada quando o POC está desligado. Pedido com IP ou `Host` de fora responde 404 e não emite token. `pnpm --filter @openmeet/server test` 9 pass e typecheck exit 0. A API que já estava em `127.0.0.1:3000` recarregou: join local 200 para `wss://livekit.dennerstorres.dev`, `Host` estranho 404. M01–M12 continuam NOT_RUN.

### 2026-10-18 — microfone local sem retorno — Grok
Achado A2: a faixa local de áudio não gera mais `<audio>`. `shouldAttachPlayback` recusa áudio local e mantém o áudio remoto. `pnpm --filter @openmeet/media test` 6 pass. `pnpm --filter @openmeet/media build` e `pnpm --filter @openmeet/desktop typecheck` exit 0. A janela não foi clicada. M01–M12 continuam NOT_RUN.

### 2026-10-18 — win-b connected na mesma sala do VPS — Grok
Operador confirmou Estado `connected` no outro PC. Log 20:09:38Z: `win-b` (`PA_UVaVaTfk9Rxc`) entrou em `poc` (`RM_4HqoVhrthNKj`) com `numParticipants` 1. 20:09:39Z: `participant active`, `connectionType` `udp`, candidato local na porta 7882. Dois clientes. M01–M12 continuam NOT_RUN.

### 2026-10-18 — campo de token colado no POC — Grok
`PocApp` entra com token colado e URL `wss` quando o campo Token não está vazio. Vazio, segue o `POST` local. `parsePastedJoin` recusa `ws` público. `pnpm --filter @openmeet/shared test` 7 pass. `pnpm --filter @openmeet/shared build` e `pnpm --filter @openmeet/desktop typecheck` exit 0. A janela Tauri não foi clicada daqui. M01–M12 continuam NOT_RUN.

### 2026-10-18 — win-a connected no LiveKit do VPS — Grok
Operador confirmou Estado `connected`. Log 19:38:09Z: sala `poc` (`RM_4HqoVhrthNKj`), participante `win-a` (`PA_z4SCQJ8dqtUp`). 19:38:10Z: `participant active`, `connectionType` `udp`, candidato local selecionado na porta 7882. Um cliente, SDK JS 2.23.0 no Edge/WebView. M01–M12 continuam NOT_RUN.

### 2026-10-18 — API local apontada para o LiveKit do VPS — Grok
Processo em `http://127.0.0.1:3000`, `POC_JOIN=1`, `LIVEKIT_URL=wss://livekit.dennerstorres.dev`. Chave só no ambiente do processo e em `~\.openmeet-livekit.env`. `GET /health/live` 200. `POST /api/v1/poc/join` devolveu essa URL `wss` e um token de 300 caracteres, sem gravar o token. Bind `127.0.0.1`. M01–M12 continuam NOT_RUN.

### 2026-10-18 — UDP 7882 publicado no container do LiveKit — Grok
Só o container `xe28bsao91wuwub6h6wbabqo-20261018T190344` foi recriado. Os outros containers não reiniciaram. Portas no host: `7881/tcp` e `7882/udp`. A `3478` ficou intocada porque um `turnserver` do host já escuta nela. `GET https://livekit.dennerstorres.dev` respondeu 200 `OK`. O log passou a anunciar IP externo. Um novo deploy pelo Coolify regrava o compose e tira esse mapeamento. M01–M12 continuam NOT_RUN.

### 2026-10-18 — UDP do LiveKit não publicado — Grok
A aplicação `xe28bsao91wuwub6h6wbabqo` aceita mapeamento `7881:7881` e recusa qualquer sufixo `/udp` ou `/tcp`. Um serviço Compose `livekit-udp` (`zxq9dfpucnflrcyogmglirif`) gravou `7881/tcp`, `7882/udp` e `3478/udp` no compose, ficou `starting:unknown` sem container e foi apagado. `GET https://livekit.dennerstorres.dev` segue 200 `OK`. M01–M12 continuam NOT_RUN.

### 2026-10-18 — LiveKit no ar em livekit.dennerstorres.dev — Grok
O serviço Compose ficava em `starting` e não criava container. Foi removido. No lugar, aplicação Docker `livekit` (`xe28bsao91wuwub6h6wbabqo`), imagem `livekit/livekit-server:v1.13.10`, deploy `pciorvxdmj7oegfxddrmmzix` terminou às 19:03:54Z. `GET https://livekit.dennerstorres.dev` respondeu 200 `OK`. Chave continua só no Coolify e em `~\.openmeet-livekit.env`. As portas UDP do host ainda não foram publicadas: a API da aplicação recusou o formato `/udp`. M01–M12 continuam NOT_RUN.

### 2026-10-18 — LiveKit no Coolify, container ainda não sobe — Grok
Projeto OpenMeet (`ioviwvkfbtw38fdflzhuxgwf`), serviço `livekit` (`mqwgwpqjasnpgeurtyhmk5lz`), domínio `https://livekit.dennerstorres.dev`. Chave própria no Coolify e em `~\.openmeet-livekit.env`. Sem modo dev, sem chave no Git. Proxy ajustado para a porta 7880. O script chamava `livekit-server` e o binário é `/livekit-server`; isso foi corrigido. Às 18:36Z o status seguia `starting:unknown`, sem container, e o domínio respondia 526. M01–M12 continuam NOT_RUN.

### 2026-10-18 — minimizar e restaurar win-a — Grok
Operador minimizou a janela, esperou e restaurou. Confirmou Estado `connected` e a imagem da câmera de volta. Log 17:54:12Z: `win-a` ainda na sala `poc`, ping com rtt 5 ms. Nos 3 min anteriores não houve disconnect nem unpublish. Um só cliente, `tauri dev`. M10 continua NOT_RUN.

### 2026-10-18 — troca de câmera de win-a — Grok
Operador trocou o seletor Câmera e confirmou que a imagem mudou. A faixa segue `TR_VCZViSV3NBBur9`, origem CAMERA. O log do servidor não registra o id do dispositivo. Um só cliente, `tauri dev`. M09 continua NOT_RUN.

### 2026-10-18 — janela de win-a interrompida — Grok
Operador confirmou que a imagem da janela sumiu e o botão voltou. Log 17:46:42Z: faixa `TR_VSwpviyhEqCefW` unpublished, origem SCREEN_SHARE, `expectedToResume` false, perda de pacotes 0. Um só cliente, `tauri dev`. M06 continua NOT_RUN.

### 2026-10-18 — janela de win-a publicada — Grok
Operador escolheu uma janela e viu a imagem. Log 17:46:13Z: faixa nova `TR_VSwpviyhEqCefW`, tipo VIDEO, origem SCREEN_SHARE, 1920x1080, mime video/VP8. O log não separa janela de monitor. Um só cliente, `tauri dev`. Parada ainda não testada. M06 continua NOT_RUN.

### 2026-10-18 — tela de win-a interrompida — Grok
Operador confirmou que a imagem da tela sumiu e o botão voltou. Log 17:45:32Z: faixa `TR_VScmV9QoxjRddw` unpublished, origem SCREEN_SHARE, `expectedToResume` false, perda de pacotes 0 no fechamento. Um só cliente, `tauri dev`. M05 continua NOT_RUN.

### 2026-10-18 — tela de win-a publicada — Grok
Operador confirmou o compartilhamento da tela inteira. Log: faixa `TR_VScmV9QoxjRddw`, tipo VIDEO, origem SCREEN_SHARE, 1920x1080, mime video/VP8. Um só cliente, `tauri dev`. A parada ainda não foi testada. M05 continua NOT_RUN.

### 2026-10-18 — câmera de win-a publicada — Grok
Operador aceitou a permissão e viu a própria webcam. Log: faixa `TR_VCZViSV3NBBur9`, tipo VIDEO, origem CAMERA, 1280x720, mime video/VP8, simulcast. Um só cliente, `tauri dev`. M04 continua NOT_RUN.

### 2026-10-18 — F02-06 parecer provisório — Claude
Branch / commit: `task/F01-01-monorepo-bootstrap` / sem commit
Arquivos alterados: `docs/reviews/F02-06-parecer.md` (novo), `docs/adr/0004-capture.md`, `PLAN.md`, `HISTORY.md`. Nenhum código alterado.
Decisão tomada: parecer PROVISÓRIO, sem GO e sem NO-GO. F02-06 segue BLOCKED; F03+ não liberada.
Comandos executados: `pnpm typecheck`, `pnpm lint`, `pnpm test` (29/29), `pnpm build` com exit 0; `pnpm format:check` exit 1 (5 arquivos); `docker logs livekit-livekit-1`.
Resultados/artefatos: 4 achados Altos: PC B sem caminho de rede (A1), eco do microfone local (A2), LiveKit anunciando IP do container `172.19.0.2` (A3), `POC_JOIN` sem guarda de bind/Host (A4). Mais 6 Médios e 5 Baixos. Detalhes e linhas no parecer.
Testes manuais (máquina/rede): M01–M12 NOT_RUN. Nenhuma janela Tauri aberta pelo revisor.
Pendências e riscos: A1 exige decisão humana sobre VPS/TLS/TURN de teste. Grok e revisor escreveram na mesma worktree ao mesmo tempo.
Próxima tarefa: Grok corrige A2, A3, A4, B1, M3; humano decide a topologia A1. Ver "Próximos passos" no parecer.

### 2026-10-18 — microfone de win-a publicado — Grok
Operador aceitou a permissão e o botão ficou "Microfone ligado". Log: faixa `TR_AMvi3q8vCisJ6C`, tipo AUDIO, origem MICROPHONE, mime audio/red. Um só cliente, `tauri dev`. M03 continua NOT_RUN.

### 2026-10-18 — win-a connected no tauri dev — Grok
Operador confirmou Estado `connected`. Log do LiveKit: participante `win-a` ativo, ICE `connected`, par UDP `127.0.0.1:7882`, `connectTime` 32 ms, cliente Edge/WebView2 155. É `tauri dev`, não o app empacotado. M01–M12 seguem NOT_RUN.

### 2026-10-18 — ICE local do LiveKit — Grok
A janela conectou o sinal (`win-a`) e caiu em `fatal` / `could not establish pc connection`. O candidato host era o IP da rede Docker. Compose passou a `--node-ip 127.0.0.1`. Log de subida: `nodeIP` 127.0.0.1. Mídia ainda não retestada.

### 2026-10-18 — correção beforeDevCommand — Grok
`tauri dev` rodava `pnpm --dir .. dev` a partir de `apps/desktop` e caía em `apps/`, sem package.json. `beforeDevCommand` e `beforeBuildCommand` passaram a `pnpm dev` e `pnpm build`. Sem teste de mídia.

### 2026-10-18 — validação manual F02 iniciada — Grok
Branch / commit: `task/F01-01-monorepo-bootstrap` / sem commit
Comandos: `pnpm test` e `pnpm typecheck` exit 0. `docker compose -f infra/livekit/docker-compose.yml up -d`. API com `POC_JOIN=1` em `http://127.0.0.1:3000`.
Resultados: LiveKit `http://127.0.0.1:7880` HTTP 200. `GET /health/live` 200. `POST /api/v1/poc/join` 200, URL loopback, JWT com 3 partes, `cache-control: no-store`. Token não registrado.
Ambiente: Windows 11 25H2 build 26200, WebView2 155.0.4283.62, LiveKit 1.13.10. `.env` ausente; o servidor não lê esse arquivo, as variáveis foram só do processo.
Testes manuais: M01–M12 continuam NOT_RUN. Janela Tauri não aberta. Fase 3 não iniciada.
Próxima tarefa: operador abre `pnpm --filter @openmeet/desktop tauri dev` e confirma cada caso.

### 2026-10-18 — F02-02, F02-03, F02-04, F02-05, F02-06 — Grok
Branch / commit: `task/F01-01-monorepo-bootstrap` / sem commit
Arquivos alterados: `packages/shared`, `packages/media`, `apps/server/src/poc-join.ts`, `apps/server/src/app.ts`, `apps/desktop/src/poc`, `docs/POC_F02.md`, `docs/adr/0004-capture.md`, `PLAN.md`, `plans/phase-02-media-poc.md`, `.env.example`.
Decisão tomada: endpoint de token só com `POC_JOIN=1`, URL de sinal loopback `ws` ou `wss`, TTL 10m, grant de uma sala. Compartilhamento pede vídeo sem áudio de sistema. F02-06 não foi decidido.
Comandos executados: `pnpm typecheck`; `pnpm lint`; `pnpm test`; `pnpm build`.
Resultados/artefatos: typecheck, lint, teste e build com exit 0. Shared 6 testes, media 5, server 7, desktop 2, workspace 9. Vite 8.3.4 gerou o bundle do cliente (aviso de chunk > 500 kB). Nenhum cliente Windows foi aberto. LiveKit não foi religado nesta etapa.
Testes manuais (máquina/rede): M01–M12 NOT_RUN.
Pendências e riscos: F02-02 a F02-05 ficam WAITING_VALIDATION. F02-06 BLOCKED, dono Claude, sem evidência G2. F03+ congelada. CORS permite só origens locais do Tauri/Vite. Revisão externa ainda ausente.
Próxima tarefa: humano executa `docs/POC_F02.md` em dois Windows. Sem isso não há tarefa de produto elegível.

### 2026-10-18 — F01-01, F01-02, F01-03, F01-04, F02-01 — Grok
Branch / commit: `task/F01-01-monorepo-bootstrap` / sem commit
Arquivos alterados: monorepo pnpm (`package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `tsconfig.base.json`, `.npmrc`, `.prettierrc.json`, `eslint.config.mjs`), `apps/desktop` (create-tauri-app react-ts, identificador `com.openmeet.desktop`), `apps/server` (Fastify 5, health), `.github/workflows/ci.yml`, `docs/ENVIRONMENT.md`, `docs/POC_F02.md`, `infra/livekit/docker-compose.yml`, `.env.example`, `PLAN.md`, planos das fases 01 e 02.
Decisão tomada: fundação e SFU local apenas. Nenhuma feature de produto. Nenhuma tarefa marcada DONE. Credencial de dev do LiveKit não versionada; `.env.example` só tem placeholder.
Comandos executados: `pnpm install`; `pnpm lint`; `pnpm typecheck`; `pnpm test`; `pnpm build`; `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`; `docker compose -f infra/livekit/docker-compose.yml config`; `docker compose -f infra/livekit/docker-compose.yml up -d` e `down`.
Resultados/artefatos: testes do workspace, do desktop e do server passaram. Typecheck e build (Vite 8.3.4 e `tsc` do server) passaram. ESLint passou depois de corrigir `URL` no teste. `cargo check` exit 0 em 4m29s, crate `tauri` 2.12.4. LiveKit 1.13.10 respondeu HTTP 200 em `http://127.0.0.1:7880` e o container foi removido. Plataforma: Windows, Node v24.18.0, pnpm 10.30.2, rustc 1.98.1, WebView2 155.0.4283.62.
Testes manuais (máquina/rede): M01–M12 NOT_RUN. Janela Tauri não foi aberta. Sem segundo PC.
Pendências e riscos: revisão Claude (F01-04/ADR/CSP `null` do template) e Codex ausentes; CI não rodou em remoto; Node local 24.18.0, blog LTS 24.22.0; Rust fora do PATH; pnpm avisou 12.14.0 e o repo ficou em 10.30.2; G2 bloqueado.
Próxima tarefa: revisão da fundação; depois F02-02 só com dois Windows reais.

## 2026-10-18 — criação do harness
- Estado: planejamento; nenhum código funcional implementado.
- Decisão: Windows primeiro, Tauri 2/React, Fastify/Postgres, LiveKit SFU, instâncias independentes.
- Execução: Grok como agente principal; Claude arquitetura/segurança; Codex QA/revisão.
- Bloqueio principal: compatibilidade real de captura monitor/janela com WebView2; POC exige dois Windows em redes diferentes.
- Próxima tarefa: F01-01.

## Template de registro
```
### YYYY-MM-DD HH:mm — TASK-ID — Agente
Branch / commit:
Arquivos alterados:
Decisão tomada:
Comandos executados:
Resultados/artefatos:
Testes manuais (máquina/rede):
Pendências e riscos:
Próxima tarefa:
```
