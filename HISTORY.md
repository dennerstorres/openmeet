# HISTORY — registro cronológico

### 2026-10-19 — instância da VPS atualizada para o main — Claude
Coolify, app `openmeet-api`. O app tinha a branch `main`, mas o commit fixado em `ee43028`, de antes da F09; todo redeploy refazia o código antigo. Mudanças: `git_commit_sha` para `HEAD`; variável `PROXY_AUTH` (48 caracteres aleatórios, não impressa); "Label management" passou de automático para manual, pela tela, porque a API do Coolify não aceita esse campo; middleware do Traefik `openmeet-proxy` que injeta `X-OpenMeet-Proxy` no roteador HTTPS. O Traefik reescreve `X-Forwarded-For` com o IP de quem conecta, que atrás do Cloudflare é a borda do Cloudflare: o limite de login fica por borda, não por pessoa. O script com o User-Agent padrão do Python foi barrado pelo Cloudflare do Coolify (1010); o operador rodou os scripts. Deploy `4o4yfbmtyr22h2wtjbcrdwwm` terminou no commit `1876229`. Depois dele: cartão com `googleLogin`, `/api/v1/servers` 401 sem sessão, login com senha errada 401 `invalid_credentials` (não 503), bootstrap fechado 404 `bootstrap_closed`, `/health/ready` com banco ok. Login real pelo instalador ainda não foi refeito. Labels manuais não acompanham mudança de domínio: trocar o domínio do app exige ajustar as labels à mão.

### 2026-10-19 — "A instância não respondeu" depois do login — Claude
`main`. Relato: instalador novo, login de admin em `https://openmeet-api.dennerstorres.dev`, erro "A instância não respondeu". Causa: a API dessa instância é anterior à F09. O cartão não traz `googleLogin`, `GET /api/v1/servers` responde 404 de rota inexistente do Fastify e `GET /api/v1/rooms` responde 401. O app chama `/servers` logo depois do login, e esse 404 caía em `request_failed`. O cliente nativo não é a causa: uma sonda Rust temporária (removida) recebeu 401 `invalid_credentials` da mesma instância. Correção no app: rota inexistente vira `instance_outdated`, com a mensagem de pedir ao operador para atualizar a API. A correção de fato é atualizar a VPS para o `main`. A instância está atrás do Cloudflare e a raiz do domínio responde nginx; se o proxy da VPS não for o Caddy deste repositório, a API nova com `TRUST_PROXY=1` responde 503 `proxy_rejected` no login até o proxy mandar `X-OpenMeet-Proxy` e um `X-Forwarded-For` de um hop só, com o IP real (`CF-Connecting-IP`).
Comandos, Windows 11: `pnpm typecheck`, `pnpm lint`, `prettier --check` e `pnpm test` ok (shared 41). Instalador não regerado.

### 2026-10-19 — F12-01 ADR 0014 aceito — Claude
`main`. Aceite humano no chat. ADR 0014 em `Accepted`. SPEC: visão com cliente web, item 17 do escopo, RF-02 com cofre no `.exe` e cookie `HttpOnly` na web, RF-19 do cliente web e navegadores suportados. Sem código. F12-01 `DONE`; F12-02 e F12-03 `READY`.

### 2026-10-19 — instalador com a F10 — Claude
`main` (ba5a36b, código; o commit seguinte só tem o desenho da F12). `pnpm --filter @openmeet/desktop exec tauri build --bundles nsis` gerou `OpenMeet_0.1.0_x64-setup.exe`, 2,20 MiB, SHA256 `39a5d6df7cbfbb1ec0e9df4024f791497b9d51b640fe3a722c61705299be69fd`, copiado para a Área de Trabalho. Antes do build o disco tinha 0,5 GB livres; apaguei `src-tauri/target/debug` (cache). O app agora fala com a instância pelo processo nativo (F10-17 e F10-18): a API do teste precisa estar no `main` com as migrations até `0006` e, atrás do Caddy, com `PROXY_AUTH`. O instalador não foi aberto.

### 2026-10-19 — desenho do cliente web (F12) — Claude
`main`. ADR 0014 em `Proposed`: a instância serve o mesmo frontend em `https://{API_DOMAIN}/`, mesma origem da API; sessão em cookies `HttpOnly` (`om_access` e `om_refresh`) com `SameSite=Strict`, `Origin` e `X-OpenMeet-Web` contra CSRF; CSP própria só com o domínio do LiveKit. Fica igual: salas, servidores, convite, presença, cards, ensurdecer, mídia e diagnóstico. Muda: áudio do PC só em Chrome e Edge, saída de som só com `setSinkId`, Google em janela nova. Não existe na web: bandeja, atalhos globais, notificação nativa e cofre. Plano em `plans/phase-12-web.md`, sete tarefas F12, gate G12. Sem código, sem teste.

### 2026-10-19 — F10-18 salas e join no processo nativo (S-06) — Claude
Branch `task/F10-18-salas-nativas`, sobre `task/F10-17-auth-nativa`. O access token passou a viver só no Rust (`NativeSession`, memória, preso à origem). Os comandos `session_*` trocam o `accessToken` do corpo por um marcador (`held-by-native`) antes de devolver à página; logout e 401 esquecem o token. `instance_call(origin, method, path, body)` chama a instância com o bearer guardado, sem redirect, 10 s, e só aceita as rotas de sala e servidor que o app usa: listar e criar salas e servidores, salas e convites de um servidor, presença, aceitar convite e join. Auth, admin, senha e remoção de membro ficam de fora. O join devolve à página o URL do signaling e o JWT da sala, que a mídia precisa. O desenho pedia `room_create`, `room_list` e `room_join`; depois da F09 o app chama também rotas de servidor, convite e presença, então entrou um comando só com lista fechada no lugar de três. Na página, `createDesktopApi` manda pelo nativo toda chamada com sessão; instância e início do Google seguem no fetch. `MeetingModel` não mudou: no desktop o campo guarda o marcador. No navegador de dev, sem Tauri, o token real continua na página. `connect-src` não mudou.
Comandos, Windows 11: `cargo test` 18 pass (marcador no lugar do token; token preso à instância; lista de rotas aceita e recusada, inclusive `admin`, `auth/password`, `DELETE` de membro, id inválido, query e `//host`). `pnpm typecheck`, `pnpm lint`, `prettier --check` e `pnpm test` ok. Não feito: uso real pelo instalador (entrar, criar sala, convite, presença, join). `WAITING_VALIDATION`.

### 2026-10-19 — F10-17 login, refresh e logout no processo nativo (S-05 parte 2, S-18) — Claude
Branch `task/F10-17-auth-nativa`, sobre `task/F10-16-bandeja`. `src-tauri/src/session.rs`: `session_login`, `session_bootstrap`, `session_google`, `session_refresh` e `session_logout`, com `reqwest` 0.13.5 (TLS do Windows, sem redirect, 10 s). Sucesso grava o refresh no slot da F10-15 e devolve à página `{ status, body }` sem `refreshToken`; erro e espera do Google passam sem refresh. `session_refresh` usa só o slot da origem pedida. `session_logout` lê o refresh do slot, nunca da página, e só limpa o slot com resposta abaixo de 500 e se o slot ainda guarda aquele token; 5xx mantém o slot e falha de rede vira `media_disconnect_failed`. `session_load`, `session_save` e `session_clear` saíram dos comandos, das permissões e da capability. Bootstrap e Google entraram no nativo além do desenho, porque também devolviam refresh à página. No `packages/shared`, `SessionBroker` com `vaultSessionBroker` para navegador e testes; `MeetingModel` não tem mais campo de refresh e aceita cofre ou broker. A repetição do logout ficou no `MeetingModel` (o desenho pedia no comando Rust): a janela esconde em vez de fechar, e uma sessão nova para as repetições da anterior. `connect-src` não mudou. Residual nomeado: o access token ainda fica no `MeetingModel` para salas e join até a F10-18.
Comandos, Windows 11: `cargo test` 15 pass (sessão chega sem refresh; sucesso sem refresh é recusado; erro e 202 nunca levam refresh). `pnpm typecheck`, `pnpm lint`, `prettier --check` e `pnpm test` ok (shared 40). Não feito: login, renovação e saída pelo instalador contra uma instância real. `WAITING_VALIDATION`.

### 2026-10-19 — F10-16 contrato visível da bandeja (S-16) — Claude
Branch `task/F10-16-bandeja`, sobre `task/F10-15-cofre`. Implementada a recomendação do desenho: fechar continua escondendo. Os dois menus da bandeja nascem de `tray_menu`: "Sair" virou "Fechar o OpenMeet" (sai do processo, conta continua) e entrou "Sair da conta", que mostra a janela e emite `shell-action` `sign-out`; a tela chama o mesmo `model.signOut()` do botão. `Preferences` ganhou `close_notice_shown` e `#[serde(default)]` nos dois campos; consentimento e aviso leem o arquivo inteiro e gravam os dois. Na primeira vez que fechar esconde, `notify` avisa que a conta continua conectada neste PC; não repete. `close_hides` não marca `quitting`.
Comandos, Windows 11: `cargo test` 12 pass (preferências com default e os dois campos; fechar esconde sem sair). `pnpm typecheck`, `pnpm lint`, `prettier --check` e `pnpm test` ok. O disco encheu durante o build: apaguei `target/debug/incremental`, o cache de `target/release` (o instalador em `release/bundle` ficou) e a imagem `busybox` do teste da F10-09. Não feito: bandeja e aviso no Windows com o instalador. `WAITING_VALIDATION`.

### 2026-10-19 — F10-15 cofre de um slot, recusa outra origem (S-05, parte 1) — Claude
Branch `task/F10-15-cofre`, sobre `task/F10-14-prova`. `shell.rs` guarda um único item do keyring, conta `active`, com `{ origin, refresh }`. `session_load` só devolve o refresh se a origem pedida é a gravada; outra origem é `invalid_origin`, sem o token no erro. `session_clear` de outra origem não apaga o slot. `session_save` substitui o slot: trocar de instância perde o refresh da anterior e a pessoa entra de novo. Salvar ou limpar uma origem também apaga o item antigo por origem, de antes desta mudança; os itens antigos de outras origens ficam no Gerenciador de Credenciais sem ninguém que os leia. A decisão está em `load_slot`/`save_slot`/`clear_slot` sobre um `SlotStore`, testada com cofre falso. No JS, `invalid_origin` no `load` vira "sem sessão", para a tela poder confirmar outra instância. O refresh ainda atravessa o IPC; isso sai na F10-17.
Comandos, Windows 11: `cargo test` 11 pass (novo: o slot responde só à própria origem, troca apaga a anterior, erro sem token). `pnpm typecheck`, `pnpm lint`, `prettier --check` e `pnpm test` ok. Não feito: o cofre real do Windows no instalador. `WAITING_VALIDATION`.

### 2026-10-19 — F10-14 prova de mídia fora do instalador (S-13) — Claude
Branch `task/F10-14-prova`, sobre `task/F10-13-capability`. `App.tsx` carrega `PocApp` por `lazy(import())` dentro de `import.meta.env.DEV`; o link "Prova de mídia" do formulário de instância também só existe nesse ramo. O build de produção derruba o ramo, o import e o módulo. Nenhuma webview nova, nenhum comando copiado.
Comandos, Windows 11: `pnpm --filter @openmeet/desktop build` e o teste novo `apps/desktop/test/bundle.test.mjs` (build do Vite em pasta temporária; `PocApp`, `?poc=1`, "Prova de mídia" e `poc_unconfigured` ausentes). No `pnpm dev` (porta 1420), o link aparece e `?poc=1` abre "OpenMeet POC" sem erro no console. `pnpm typecheck`, `pnpm lint`, `prettier --check` e `pnpm test` ok (desktop 6). `IMPLEMENTED`.

### 2026-10-19 — F10-13 capability mínima e CSP de base (S-14, S-15) — Claude
Branch `task/F10-13-capability`, sobre `task/F10-12-origem`. `capabilities/default.json` trocou `core:default` por `core:event:allow-listen`, `core:event:allow-unlisten` e `core:webview:deny-internal-toggle-devtools`, mais os comandos próprios que já existiam; sem `allow-emit`, sem `remote`. A CSP ganhou `base-uri 'none'` e `style-src 'self'`, sem `unsafe-inline`. Como o Tauri 2 usa a `csp` também no `tauri dev` quando não há `devCsp`, entrou um `devCsp` igual com `'unsafe-inline'` só no estilo, porque o Vite serve CSS em `<style>` no dev; o release não usa esse campo.
Comandos, Windows 11: `pnpm --filter @openmeet/desktop build` ok; `dist/index.html` sem `<style>` nem `style=`, CSS em arquivo. `cargo build` e `cargo test` (10 pass) com a capability nova. `pnpm typecheck`, `pnpm lint`, `prettier --check` e `pnpm test` ok (desktop 4). Não feito: abrir o instalador e ver o estilo aplicado e o `shell-action` chegando com a capability nova. `WAITING_VALIDATION`.

### 2026-10-19 — F10-12 mídia e navegação só na origem do bundle (S-07, S-08) — Claude
Branch `task/F10-12-origem`, sobre `task/F10-11-backup`. `lib.rs` separou `is_bundle_origin` (`tauri://localhost` e `http://tauri.localhost`) de `is_dev_server` (porta 1420 só com `debug`, alimentado por `cfg!(debug_assertions)`). `media_permission` tem um braço para microfone, câmera e autoplay e outro para captura de tela; o resto é Deny. `app.windows` saiu do `tauri.conf.json`; a única `main` nasce no `setup` com `WebviewWindowBuilder` 800×600, `on_navigation` só para a página do app e `on_new_window` Deny, antes de `shell::install`. A capability não ganhou `remote`.
Comandos, Windows 11: `cargo test` 10 pass, três novos (release recusa `127.0.0.1:1420`, `localhost:1420`, `https://meet.example` e `https://tauri.localhost`; o bundle recebe mídia e tela nos dois perfis; o servidor de dev só no debug). `cargo build` e o binário debug abriu a janela "OpenMeet" e ficou vivo 8 s. `rustfmt` e `clippy` não estão instalados nesta toolchain. Não feito: pedido de câmera e tela no WebView2 do instalador, e tentativa de navegar para fora. `WAITING_VALIDATION`.

### 2026-10-19 — F10-11 backup cifrado e contrato de firewall (S-17) — Claude
Branch `task/F10-11-backup`, sobre `task/F10-10-turn`. `pg-copy.mjs` grava só `generated/*.sql.enc`: byte de versão `1`, IV de 12 bytes, AES-256-GCM com chave SHA-256 de `BACKUP_KEY`, tag de 16 bytes no fim. A busca pela senha do Postgres corre no pipe antes da cifra, inclusive na borda entre pedaços; achou, apaga o parcial e falha. Restaurar decifra em memória e confere a tag antes de mandar qualquer linha ao `psql`; `.sql` antigo dentro de `generated` restaura sem chave por um caminho separado. `BACKUP_KEY` e `POSTGRES_PASSWORD` vêm do ambiente ou de `infra/compose/.env`. `host.mjs` gera `BACKUP_KEY` sem imprimir. `acl.mjs` aplica `icacls /inheritance:r /grant:r usuário:(R,W)` no `.env` e no backup no Windows; leitura e escrita, não só leitura, porque o `.env` é regravado e o backup é substituído. `docs/DEPLOYMENT.md` ganhou a seção de firewall (80, 443/tcp e udp, 7881, 7882/udp; 3478/udp e 5349 só com TURN de certificado; nunca 3000 e 5432) e diz para não usar o compose de POC numa VPS.
Comandos, Windows 11, Docker 29.8.1: `pnpm lint` e `prettier --check` ok. `pnpm test`: scripts 24, todos pass. Prova real com o Postgres do Compose num projeto descartável: tabela `canary`, `backup` gerou `.sql.enc` de 1098 bytes começando por `01` e sem o texto da linha; `drop table`; `restore` devolveu `canary-row-visible`; restore com outra `BACKUP_KEY` falhou com "could not be decrypted"; `down -v` e arquivo apagado. `icacls` provado num arquivo de rascunho: só o usuário atual com `(R,W)`. `IMPLEMENTED`.

### 2026-10-19 — F10-10 TURN sem TLS externo e sem 5349 solto (S-20) — Claude
Branch `task/F10-10-turn`, sobre `task/F10-09-dockerignore`. `renderLiveKitYaml` recusa `TURN_EXTERNAL_TLS=1` (nenhum terminador roda nesta stack) e recusa `TURN_USERNAME`/`TURN_PASSWORD`; o YAML nunca grava `external_tls` nem credencial fixa. TURN só liga com `TURN_DOMAIN` e certificado. `docker-compose.turn.yml` publica só `3478/udp`; `5349` está só em `docker-compose.turn-certs.yml`, que monta o certificado. `docs/DEPLOYMENT.md` deixou de ensinar o modo externo.
Comandos, Windows 11: `pnpm lint` e `prettier --check` ok. `pnpm test`: scripts 21, todos pass. `docker compose config` com os três arquivos publica `3478` e `5349` só com o overlay de certificado. Não feito: TURN numa VPS real. `IMPLEMENTED`.

### 2026-10-19 — F10-09 contexto de build sem o .env da stack (S-19) — Claude
Branch `task/F10-09-dockerignore`, sobre `task/F10-08-bootstrap`. `.dockerignore` ganhou `infra/compose/.env`, `infra/compose/.env.*`, `**/.env` e `**/.env.*`. Dockerfile sem mudança; sem allowlist e sem `--filter`, como o desenho manda. `scripts/dockerignore.test.mjs` exige os quatro padrões e nenhuma reinclusão com `!`.
Comandos, Windows 11, Docker 29.8.1: com `infra/compose/.env`, `infra/compose/.env.local` e `apps/server/sub/.env` de mentira criados, `docker build --no-cache` com contexto na raiz e `COPY . /ctx` rodou `test ! -e` nos três e imprimiu `CONTEXT_CLEAN`; os arquivos foram apagados depois. `pnpm typecheck`, `pnpm lint` e `prettier --check` ok. `pnpm test`: scripts 21, todos pass. `IMPLEMENTED`.

### 2026-10-19 — F10-08 bootstrap sem oráculo e sem stdout (S-12) — Claude
Branch `task/F10-08-bootstrap`, sobre `task/F10-07-proxy`. Com `bootstrap_completed`, a rota responde 404 `bootstrap_closed` antes de ler token ou corpo; token certo, errado ou corpo vazio dão a mesma resposta. O app usa o código do erro, não o status. `host.mjs` não imprime mais o token ("BOOTSTRAP_TOKEN written to infra/compose/.env"). `--clear-bootstrap` pergunta ao Postgres por `docker compose exec -T postgres psql`, sem porta e sem senha no argumento, e só apaga a chave com saída 0 e `t`; marca `BOOTSTRAP_DONE=1` para uma nova rodada não recriar o token. O Compose aceita token vazio. O entrypoint tirou a checagem de tamanho de antes da migration; depois dela, `dist/db/bootstrap-state.js` diz `open` ou `closed`; fechado faz `unset BOOTSTRAP_TOKEN` antes do `exec node`; aberto com token curto só avisa e a rota responde 503. `docs/DEPLOYMENT.md` explica o clear e a recriação do serviço.
Comandos, Windows 11: `pnpm typecheck`, `pnpm lint` e `prettier --check` ok; `sh -n` no entrypoint ok. `pnpm test`: scripts 20, shared 38, media 44, server 58, desktop 2, todos pass. O teste do clear injeta o resultado do exec (`t`/0 apaga; `f`, vazio ou saída 1 não mudam). Não feito: entrypoint e `--clear-bootstrap` na stack real. `WAITING_VALIDATION`.

### 2026-10-19 — F10-07 limite só atrás do segredo do proxy (S-11) — Claude
Branch `task/F10-07-proxy`, sobre `task/F10-06-grant`. `host.mjs` gera `PROXY_AUTH` (mesmo critério do `AUTH_SECRET`) e não o imprime; o Compose o entrega ao `api` e ao `caddy`. O Caddy reescreve `X-Forwarded-For` com `{remote_host}` e manda `X-OpenMeet-Proxy`; o site do LiveKit não recebe o segredo. O entrypoint recusa subir com `TRUST_PROXY=1` e `PROXY_AUTH` abaixo de 32 caracteres, inclusive ausente sob `set -u`. Com `TRUST_PROXY=1`, login, bootstrap, refresh, troca de senha e início do Google exigem o segredo e um hop único; senão 503 `proxy_rejected`, sem cair no IP do socket. Health não passa por isso. O mapa de tentativas para em 4096 chaves e recusa chave nova sem apagar chave viva. Refresh ganhou limite: 60 por IP e 12 por hash do token, injetáveis. `docs/ENVIRONMENT.md` e `docs/DEPLOYMENT.md` dizem que a API não é publicada fora do Caddy.
Comandos, Windows 11: `pnpm typecheck`, `pnpm lint` e `prettier --check` ok. `pnpm test`: scripts 19, shared 38, media 44, server 58, desktop 2, todos pass. `docker compose config -q` ok; `caddy validate` na imagem `caddy:2.10.2` deu "Valid configuration". Teste de host lê o Compose e falha se `api` ou `postgres` publicarem porta. Não feito: a stack real com Caddy entregando o cabeçalho e a API healthy. `WAITING_VALIDATION`.

### 2026-10-19 — F10-06 grant só com as fontes autorizadas (S-09) — Claude
Branch `task/F10-06-grant`, sobre `task/F10-05-desativar`. `apps/server/src/rooms/grant.ts` monta o único grant do join e do POC: `roomJoin`, a sala, `canSubscribe`, `canPublish` com `canPublishSources` = microfone, câmera, tela e áudio da tela (`TrackSource` do `livekit-server-sdk`, sem número solto), `canPublishData: false`, sem `roomAdmin`, `roomCreate`, `hidden` ou parecidos. O desenho dizia "sem áudio do PC"; a F09-06 implementou o ADR 0008, então `screen_share_audio` entra, como o plano da fase pede. O body do join é ignorado: o teste manda `canPublishSources`, `canPublishData` e `roomAdmin` e o token sai igual. `POC_JOIN` segue 0 no Compose.
Comandos, Windows 11: `pnpm typecheck`, `pnpm lint` e `prettier --check` ok. `pnpm test`: scripts 18, shared 38, media 44, server 55, desktop 2, todos pass. `TokenVerifier` confere as quatro fontes no token da sala e no do POC. Não feito: LiveKit real recusando uma fonte fora da lista. Falta a revisão do G10. `IMPLEMENTED`.

### 2026-10-19 — F10-05 desativar conta, senha, recuperação e corte no logout (S-02, S-18) — Claude
Branch `task/F10-05-desativar`, sobre `task/F10-04-corte`. Rotas novas: `POST /api/v1/auth/password` (senha atual, revoga todas as famílias, devolve só uma sessão nova, limite por IP), `GET /api/v1/admin/users`, `POST /api/v1/admin/users/:id/password`, `/disable` e `/enable`, todas `no-store`. O admin não é alvo das rotas de admin; ele é o único admin pela trava do banco. Desativar grava `disabled_at`, revoga todas as sessões, liga `livekit_hold` e corta a conta das salas abertas de todos os servidores em que é membro; 502 não desfaz nada e repetir corta de novo. Reativar responde 502 enquanto o hold estiver ligado e não cria sessão. Logout revoga só a família apresentada, liga o hold, corta e baixa o hold quando todas as salas confirmam; sem sala aberta baixa no mesmo commit, sem rede. Refresh já revogado repete o corte só com o hold ligado. A outra família recebe 200 em `/auth/me` e 403 no join durante o hold. `media-hold.ts` concentra `revokeAfter`, a lista de salas e a baixa do hold. `db/recover-admin.ts`: senha pelo stdin, URL montada com `POSTGRES_*`, revoga as sessões do admin, audita `admin_password_recover`, não imprime segredo nem reabre o bootstrap; procedimento em `docs/DEPLOYMENT.md`. No app, `MeetingModel` só limpa o cofre em 204 (e só se o cofre ainda guarda aquele token), repete em segundo plano com espera de 1 s dobrando até 60 s, e na abertura seguinte um refresh 401 chama logout antes de esquecer o token.
Comandos, Windows 11: `pnpm typecheck`, `pnpm lint` e `prettier --check` ok. `pnpm test`: scripts 18, shared 38, media 44, server 55, desktop 2, todos pass. Testes novos em `apps/server/test/accounts.test.ts` e `packages/shared/test/meeting.test.ts`. Não feito: o comando de recuperação dentro do container real, e o corte com LiveKit real. `WAITING_VALIDATION`.

### 2026-10-19 — F10-04 corte no SFU repetível e join na mesma trava (S-04) — Claude
Branch `task/F10-04-corte`, sobre `task/F10-03-refresh`. O desenho é de antes da F09 e falava de `memberships` por sala; o acesso hoje é `server_members`, então o corte de pessoa vive lá. Migration `0006_media_cut.sql`: `rooms.media_closed_at`, `rooms.last_join_nbf`, `server_members.media_cut_at`, `server_members.last_join_nbf`, `users.livekit_hold`. O nome `last_join_nbf` evita a palavra `token`, que o teste de schema reserva para segredo. Remoções e encerramentos antigos contam como cortados. `joinRoom` é uma transação: trava usuário, a refresh session do access token, sala e membership, nessa ordem; convite, assinatura e o `nbf` do JWT assinado ficam na mesma trava. `livekit_hold` responde `forbidden`; sessão revogada ou conta desativada, 401. Remover e encerrar gravam a decisão, commitam e só depois chamam o SFU com `revokeAt = maior nbf + 1` lido sob `for update`; sucesso grava a confirmação, falha é 502 e a repetição chama de novo. Até confirmar, o removido não recebe token nem volta por convite (também em `/invites/accept`). `RoomMedia` recebe o `revokeAt` em vez de usar o relógio.
Comandos, Windows 11: `pnpm typecheck`, `pnpm lint` e `prettier --check` ok. `pnpm test`: scripts 18, shared 36, media 44, server 50, desktop 2, todos pass. Teste novo `apps/server/test/media-cut.test.ts`: 502 mantém a remoção; join sem e com convite novo dá 403 sem credencial até a repetição; `revokeAt` maior que o `nbf` do JWT emitido; terceira chamada não vai ao SFU; o mesmo para encerrar; `livekit_hold` e sessão revogada não assinam. Não feito: `revokeTokenTs` contra o LiveKit real derrubando quem tem token válido. `WAITING_VALIDATION`.

### 2026-10-19 — F10-03 reuso de refresh revoga a família (S-03) — Claude
Branch `task/F10-03-refresh`, sobre `task/F10-02-membro`. Migration `0005_session_family.sql` (o desenho dizia `0002`; a F09 ocupou até `0003` e a F10-01 a `0004`): `refresh_sessions.family_id not null`, preenchido pela raiz da cadeia `replaced_by`, com índice. Login, bootstrap e Google abrem família com o id da linha nova; refresh herda a família. `refreshSession` trava a família inteira em ordem de id (`for update`, sem advisory lock, por causa do PGlite). Token já substituído revoga toda a família ainda viva, audita `refresh_reuse` e responde `invalid_session`; a revogação é confirmada antes do erro sair, senão o rollback a desfaria. Revogado sem substituto, expirado ou conta desativada: `invalid_session` sem mexer em nada. Outra família da mesma conta continua.
Comandos, Windows 11: `pnpm typecheck`, `pnpm lint` e `prettier --check` ok. `pnpm test`: scripts 18, shared 36, media 44, server 47, desktop 2, todos pass. Testes: o substituto morre (refresh e `/auth/me` 401) quando o anterior volta; o outro aparelho segue 200; expirar e sair não revogam irmã; a migration nomeia a cadeia pela raiz e recusa linha sem família. Rollback de imagem depois da `0005` é restaurar o backup. Falta a revisão do G10. `IMPLEMENTED`.

### 2026-10-19 — F10-02 sala só para membro, sem username (S-01, S-10) — Claude
Branch `task/F10-02-membro`, sobre `task/F10-01-nomes`. A F09-01 já tinha tirado o ramo de admin de `listRooms`, `loadAccess`, `joinRoom` e `canManage`; o código atual só confere `server_members` ativo. Sobrou um vazamento: `joinRoom` respondia `room_ended` (409) antes de conferir membership, e quem não é membro nem tem convite descobria que a sala existe e acabou. Agora é 403 `forbidden` primeiro. `getRoom` devolve `{ id, displayName, role }` pela mesma função dos membros do servidor, ordenado por nome e id, sem `username`. `/api/v1/auth/me` e `POST /api/v1/admin/users` seguem com o login.
Comandos, Windows 11: `pnpm typecheck` e `pnpm lint` ok. `pnpm test`: scripts 18, shared 36, media 44, server 45, desktop 2, todos pass. Teste novo `apps/server/test/membership.test.ts`: admin fora do servidor não lista, lê 404, join 403 sem `url`, `token` nem `eyJ`, mesmo com a sala encerrada; com convite entra como participante; o que ele cria continua dele; membro não vê `username` de ninguém. Falta a revisão do G10. `IMPLEMENTED`.

### 2026-10-19 — F10-01 nomes sem controle e bidi (S-21) — Claude
Branch `task/F10-01-nomes`, sobre `main` (0b845a5). `parseLabel` e `isHiddenCharacter` em `packages/shared` recusam C0, DEL, C1, `U+2028`, `U+2029`, `U+061C`, `U+200E`, `U+200F`, `U+202A`–`U+202E` e `U+2066`–`U+2069`, antes do trim: quebra de linha no fim é recusada, não cortada. Bootstrap e criação de conta respondem `invalid_display_name`; sala e servidor respondem `invalid_body`. `issueRoomToken` não assina nome gravado antes da `0004`. `INSTANCE_NAME` inválido cai em "OpenMeet". O Google usa a mesma lista ao limpar o nome do perfil, que antes deixava passar `U+061C`, `U+200E` e `U+200F`. O app recusa sala com nome escondido. Migration `0004_display_name.sql`: `openmeet_without_controls` e `openmeet_is_label` com faixas em `chr`, sem `[[:cntrl:]]`; troca `users_display_name_length`, `rooms_name_length` e `servers_name_length`. Fora do desenho: `servers.name` entrou, porque a F09 criou o mesmo rótulo depois do desenho. Linha antiga que violar faz a migration falhar; o operador corrige. Fazer backup antes.
Comandos, Windows 11: `pnpm typecheck` e `pnpm lint` ok. `pnpm test`: scripts 18, shared 36, media 44, server 43, desktop 2, todos pass. `prettier --check .` só reclama de `apps/desktop/.impeccable/hook.cache.json`, ignorado no git local e fora do repositório. Teste novo `apps/server/test/labels.test.ts`: 400 sem JWT em bootstrap, conta, sala e servidor; CHECK recusa `U+0085` e bidi no PGlite. Falta a revisão do G10. `IMPLEMENTED`.

### 2026-10-19 — F11-01 ícone novo — Claude
`main`, sem branch. Símbolo C aprovado no Claude Design. SVGs em `apps/desktop/brand/` (`icon`, `icon-white-on-black`, `icon-black-on-white`, `icon-green-on-dark` e `symbol` em `currentColor`). `pnpm exec tauri icon brand/icon.svg` regenerou `src-tauri/icons`. As saídas Android e iOS foram descartadas. Favicon trocado e `vite.svg`/`tauri.svg` removidos. O logo do login usa o mesmo símbolo. A bandeja herda o ícone da janela.
Comandos, Windows 11: `prettier`, `typecheck` e `eslint` ok, login visto no navegador. `tauri build --bundles nsis` gerou `OpenMeet_0.1.0_x64-setup.exe`, 2,02 MiB, SHA256 `6c68297f5e90bf400616f47b938dea69e70b342190a27eb31c16b83ba9403cc5`, copiado para a Área de Trabalho. O instalador não foi aberto. `WAITING_VALIDATION`.

### 2026-10-19 — instalador com o visual verde — Claude
`main` (9e228da), branch `task/visual-verde` integrada e apagada. `pnpm --filter @openmeet/desktop exec tauri build --bundles nsis` gerou `OpenMeet_0.1.0_x64-setup.exe`, 2,02 MiB, SHA256 `299443a4a051a5128c7bebcc1d89c271d302d48107816bebf9feb1c456066285`, copiado para a Área de Trabalho. O instalador não foi aberto.

### 2026-10-19 — visual escuro com verde — Claude
Sem branch ainda, sobre `main` (b5f6adc). Protótipo aprovado no Claude Design. `App.css` reescrito com tokens (`--bg-*`, `--accent` #15803d, `--glow` #3ddc84). Login virou um cartão com marca ao lado. Sidebar ganhou painel "Voz conectada" com Câmera/Tela e sair, e o rodapé da conta tem microfone, ensurdecer e menu de conta. A barra de controles usa botões redondos com ícones SVG (`meeting/Icons.tsx`) e `aria-label`. Fonte do sistema (Segoe UI): a CSP não deixa carregar fonte externa. Nenhuma regra de mídia mudou.
Comandos, Windows 11: `prettier --write`, `pnpm typecheck`, `eslint apps/desktop/src`, `pnpm --filter @openmeet/desktop build` e `test` ok. Conferido no navegador (Vite :1420) contra API local, Postgres descartável e LiveKit `--dev`: login, sidebar com salas e ocupantes, painel "Voz conectada", controles redondos, Destaque/Grade e menu da conta. Não feito: janela Tauri, câmera e compartilhamento com outra pessoa. `WAITING_VALIDATION`.

### 2026-10-19 — instalador da F09 — Claude
Branch `task/F09-07-google` (b228275). `pnpm --filter @openmeet/desktop exec tauri build --bundles nsis` gerou `OpenMeet_0.1.0_x64-setup.exe`, 2,02 MiB, SHA256 `c7cfae2962052c7ac990c1c6e94fbd3a6b1622f1841026fad17c0a2a20f8fe18`, copiado para a Área de Trabalho. A API usada no teste precisa estar nesta branch, com as migrations `0002` e `0003`. O instalador não foi aberto. Sem GO/NO-GO.

### 2026-10-19 — F09-07 login com Google — Claude
Branch `task/F09-07-google`, sobre `task/F09-06-audio-pc`. Migration `0003_google_login.sql`: `user_identities` (Google `sub` → usuário) e `oauth_logins` (estado e segredo de espera em hash, PKCE e nonce só no servidor, 10 min). `POST /api/v1/auth/google/start` devolve a URL do Google e um segredo de espera; `GET /callback` confere estado, troca o código com PKCE, valida emissor, audiência, validade, nonce e e-mail verificado, e mostra só "Pode voltar ao OpenMeet"; `POST /poll` entrega a sessão uma vez. A primeira entrada cria participante sem servidor; conta desativada não entra; nome passa por filtro de controle e bidi. A URI de retorno vem de `API_DOMAIN` ou `GOOGLE_REDIRECT_URI`, nunca do Host. O log troca a query do callback por `[redacted]`. O app só abre `https://accounts.google.com/o/oauth2/v2/auth`, conferido no TypeScript e de novo no Rust, pelo `tauri-plugin-opener` 2.7.2 sem permissão de opener para o webview. O id_token não tem assinatura conferida: chega direto do endpoint de token do Google por TLS (OIDC Core 3.1.3.7).
Comandos, Windows 11: `pnpm typecheck`, `pnpm lint`, `prettier --write .` e `pnpm --filter @openmeet/desktop build` ok. `pnpm test`: shared 35, media 44, server 38, desktop 2, todos pass. `cargo test`: 7 pass. Não feito: cliente OAuth real no Google Cloud, entrada pelo navegador de verdade e o instalador. Por isso `WAITING_VALIDATION`. Sem GO/NO-GO.

### 2026-10-19 — F09-06 áudio do PC no compartilhamento — Claude
Branch `task/F09-06-audio-pc`, sobre `task/F09-05-ensurdecer`. Ao lado de Compartilhar tela há a marca "Incluir áudio do PC", desligada por padrão e lembrada neste PC. Sem a marca o pedido continua `audio: false`. Com ela, o mesmo seletor pede imagem e som (`audio: true`, `systemAudio: include`); parar encerra os dois. Se a origem não entregar a faixa, a imagem continua, a tela avisa e o diagnóstico registra `screen audio missing`. Quem compartilha não ouve a própria faixa; os outros ouvem pelo card do compartilhamento, sob o mesmo Ativar som e o Ensurdecer. Não há captura nativa do Windows.
Comandos, Windows 11: `pnpm typecheck`, `pnpm lint` e `pnpm --filter @openmeet/desktop build` ok. `pnpm -r test`: shared 32, media 44, server 34, desktop 2, todos pass. Não feito: os quatro passos de prova do ADR 0008 com build instalado e dois PCs. Risco: a F10-06 (S-09) precisa incluir `screen_share_audio` no grant. Sem GO/NO-GO.

### 2026-10-19 — F09-05 ensurdecer — Claude
Branch `task/F09-05-ensurdecer`, sobre `task/F09-04-presenca`. A barra da chamada ganhou Ensurdecer. Ligado, todo áudio remoto deste PC fica mudo, inclusive o de compartilhamento, sem mexer no microfone e sem avisar o servidor. O volume e o silêncio de cada card ficam guardados e voltam ao desligar. Nasce desligado, zera ao sair da sala e não grava em disco. Se o som ainda estiver bloqueado, o corte já vale quando a pessoa clicar em Ativar som, porque o elemento de áudio nasce mudo.
Comandos, Windows 11: `pnpm typecheck`, `pnpm lint` e `pnpm --filter @openmeet/desktop build` ok. `pnpm -r test`: shared 32, media 43, server 34, desktop 2, todos pass. Não ouvido em chamada real. Sem GO/NO-GO.

### 2026-10-19 — F09-04 presença e anel de fala — Claude
Branch `task/F09-04-presenca`, sobre `task/F09-02-convite`. `GET /api/v1/servers/:id/presence` pergunta ao LiveKit quem está em cada sala aberta do servidor, só para membros. O nome vem do banco pelo id; identidade desconhecida vira "Participante"; ninguém aparece duas vezes; sala que o SFU não conhece fica vazia. Nada vai para o Postgres. Se o SFU falha, a rota responde 503 e o app esconde os nomes e mantém as salas. O app pergunta a cada 5 s, fora da fila de ações, sem travar botões. A sessão de mídia guarda o alto-falante ativo do LiveKit; o card de quem fala e o nome dessa pessoa na sidebar ganham o anel verde, só na sala atual.
Comandos, Windows 11: `pnpm typecheck`, `pnpm lint`, `prettier --write .` e `pnpm --filter @openmeet/desktop build` ok. `pnpm test`: shared 32, media 42, server 34, desktop 2, todos pass. No navegador, com API em memória e o LiveKit `--dev` local, duas contas na mesma sala apareceram debaixo dela na sidebar. Não visto: o anel com áudio real, porque o navegador de teste não tinha microfone. Por isso `WAITING_VALIDATION`. Sem GO/NO-GO.

### 2026-10-19 — F09-02 convite por link — Claude
Branch `task/F09-02-convite`, sobre `task/F09-03-layout`. O dono ou moderador copia `openmeet://convite?host=<host da API>&code=<código>`, que vale 24 h e 10 usos. O link leva só host e código; `POST /api/v1/invites/accept` acha o servidor pelo hash do código e não abre sala. Colar o link, a URL `https://<host>/convite/<código>` ou só o código continua valendo. O app sempre pede confirmação; um link de outra instância avisa o host, sai da conta atual só depois do clique e aceita o convite logo após o login. `GET /convite/:code` devolve HTML sem script, `no-store`, `no-referrer` e CSP `default-src 'none'`, e não consulta o banco. O log de requisição troca o código por `[redacted]`. O Tauri ganhou `tauri-plugin-deep-link` 2.6.2 e `tauri-plugin-single-instance` 2.5.4; o Rust só repassa `openmeet://convite` e o webview pega o link uma vez por `invite_take`.
Comandos, Windows 11: `pnpm typecheck`, `pnpm lint`, `prettier --write .` e `pnpm --filter @openmeet/desktop build` ok. `pnpm test`: shared 31, media 41, server 32, desktop 2, todos pass. `cargo test` no `src-tauri`: 6 pass. No navegador, com API em memória: o dono gerou o link, a outra conta colou, viu a confirmação, aceitou e passou a ver o servidor como participante, sem sala aberta. Não executado: instalador novo, registro do protocolo no Windows e clique no link com o app aberto e fechado. Por isso `WAITING_VALIDATION`. Sem GO/NO-GO.

### 2026-10-19 — F09-03 layout da sala — Claude
Branch `task/F09-03-layout`, sobre `task/F09-01-servidores`. O app passou a usar `/api/v1/servers`: barra de servidores com a inicial, sidebar de salas do servidor escolhido e área de cards. O admin cria servidor pelo +; dono e moderador criam sala. Dá para olhar outro servidor sem sair da chamada, e a faixa com o nome da sala volta ao servidor dela. Cada pessoa tem card, com inicial quando não há câmera; cada compartilhamento tem card próprio. Volume e silêncio neste PC ficam no card. Destaque com faixa, grade, fixar e tela cheia com Esc. Sem fixação, o centro é a tela de outra pessoa, depois a câmera de outra pessoa, depois a própria tela, depois outra pessoa. O cliente só aceita os caminhos novos `/api/v1/servers` e `/api/v1/servers/:id/rooms`. O código de convite saiu da tela; volta na F09-02.
Comandos, Windows 11: `pnpm typecheck` ok, `pnpm lint` ok, `prettier --check .` ok, `pnpm --filter @openmeet/desktop build` ok, `pnpm test` com shared 22, media 41, server 29 e desktop 2, todos pass. Prévia no navegador com API em memória e o LiveKit `--dev` local: login, três servidores, entrar na sala, trocar de servidor durante a chamada, segunda pessoa na faixa, fixar, grade, tela cheia e Esc. Não visto: câmera, compartilhamento de tela e áudio reais, nem o WebView2 instalado.
Correção do registro da F09-01: o `pnpm -s typecheck` daquela entrada escondia uma falha que já existia no commit anterior, fixture de `poc-logic.test.ts` sem `label`. O fixture foi corrigido aqui. Sem GO/NO-GO.

### 2026-10-19 — F09-01 servidores — Claude
Branch `task/F09-01-servidores`. Migration `0002_servers.sql`: `servers`, `server_members` (um dono por servidor), `server_invites`, `rooms.server_id` obrigatório e slug único por servidor. A migração cria `Geral` quando há sala, põe o admin como dono, quem tinha sala ativa como participante, e revoga os convites de sala. Rotas `/api/v1/servers`. As rotas de sala agem no servidor da sala, então o app atual continua funcionando. O token e o corte do LiveKit usam o id da sala. O admin não vê nem entra em servidor de que não é membro. `pnpm typecheck` e `pnpm lint` ok. `pnpm -r test`: server 29, shared 19, media 34, desktop 2, todos pass, Windows 11. `prettier --check` acusa só `PocApp.tsx` e `TrackView.tsx`, que vieram de antes. Sem stack real e sem SFU vivo. Riscos: as migrations do desenho F10 precisam começar em `0003`; `GET /api/v1/rooms/:id` ainda mostra username (S-10, F10-02). Sem GO/NO-GO.

### 2026-10-19 — F10 no PLAN — Claude
Os 18 PRs do desenho de segurança entraram como F10-01 a F10-18, com as dependências do desenho e o gate G10. Detalhe em `plans/phase-10-seguranca.md`. Nada implementado. Sem GO/NO-GO.

### 2026-10-19 — desenho das correções de segurança — Grok e Claude
O desenho de S-01 a S-21 está em `docs/reviews/security-fixes-design-2026-10-19.md`, com 18 PRs e a ordem mínima entre eles. Grok escreveu e passou por três revisões. A última caiu no limite do Grok; Claude fechou os dois pontos menores abertos: restore de `.sql` antigo fora do guard do backup, e teste do `PROXY_AUTH` separado entre API e Caddy. Sem código. Sem commit. Sem GO/NO-GO.

### 2026-10-19 — auditoria de segurança — Grok
Leitura estática, sem teste de invasão e sem mudança de comportamento. O registro está em `docs/reviews/security-audit-2026-10-19.md`. Não achei invasão sem credencial. Cinco pontos altos: admin entra em qualquer sala, não há corte de conta, refresh reapresentado não mata a sessão nova, o SFU pode deixar a pessoa na chamada, e o cofre entrega refresh de outra origem ao JavaScript. Sem commit. Sem GO/NO-GO.

### 2026-10-19 — F09 no SPEC e no PLAN — Grok
Os ADR 0007–0013 entraram no SPEC como RF-11 a RF-18 e no PLAN como F09-01 a F09-07. O detalhe está em `plans/phase-09-servidores.md`. Nada foi implementado. Sem commit. Sem GO/NO-GO.

### 2026-10-19 — presença, link e ensurdecer — Grok
O ADR 0011 mostra quem está na sala e o anel de quem fala. O ADR 0012 troca o código colado por um link `openmeet://`. O ADR 0013 corta o som remoto neste PC sem mexer no microfone. Sem código. Sem commit. Sem GO/NO-GO.

### 2026-10-19 — desenho do login Google — Grok
O ADR 0010 propõe entrar com Google pelo navegador do sistema. As chaves ficam no servidor. Sem elas, o botão não aparece. O primeiro administrador continua no token de instalação. Sem código. Sem commit. Sem GO/NO-GO.

### 2026-10-19 — desenho do layout da sala — Grok
O ADR 0009 propõe três colunas: servidores, salas e cards. Cada pessoa tem card, cada compartilhamento tem o seu. Há destaque, grade, fixar e tela cheia. Dá para ver outro servidor sem sair da chamada. Sem código. Sem commit. Sem GO/NO-GO.

### 2026-10-19 — desenho do áudio do PC — Grok
O ADR 0008 propõe a marca "Incluir áudio do PC", desligada por padrão. Se a origem não entregar a faixa, a imagem continua e a tela avisa. Sem faixa, não há captura nativa. Sem código. Sem commit. Sem GO/NO-GO.

### 2026-10-19 — desenho dos servidores — Grok
O ADR 0007 propõe vários servidores dentro de uma API, com salas dentro de cada um. O convite é do servidor. A chamada passa a usar o id da sala. O áudio do PC ficou de fora. Sem código. Sem commit. Sem GO/NO-GO.

### 2026-10-19 — script de self-host — Grok
`node infra/compose/host.mjs` gera `infra/compose/.env` e o YAML do LiveKit fora do Git. Na primeira vez imprime só o `BOOTSTRAP_TOKEN`. O Compose passa esse token para a API. `--up` sobe a stack. Sem essa flag, nada sobe. `node --test scripts/host.test.mjs` 2 pass. A stack não foi iniciada. Sem commit. Sem GO/NO-GO.

### 2026-10-19 — README do self-host — Grok
O README deixou de dizer que o aplicativo não existe. O repositório segue privado. O Compose ainda não recebe `BOOTSTRAP_TOKEN`. Sem commit. Sem GO/NO-GO.

### 2026-10-19 — sessão expirada volta ao login — Grok
Um pedido recusado com `unauthorized` encerra a sessão, apaga o acesso guardado e volta para o login com "A sessão expirou." `pnpm --filter @openmeet/shared test` 19 pass. O instalador foi gerado de novo, SHA256 `534b35446d55291c101989408205962ec4c456846cb144da7439f6d3052f1118`, e copiado para a Área de Trabalho. Sem commit. Sem GO/NO-GO.

### 2026-10-19 — instalador com a tela nova — Grok
`pnpm --filter @openmeet/desktop exec tauri build --bundles nsis` gerou de novo `OpenMeet_0.1.0_x64-setup.exe`, 1,94 MiB, SHA256 `7b6099f428d4c3269e9e5299f5dfa006a287b2e10a7d881319e64fbf35508e3d`. A cópia foi para a Área de Trabalho. A tela de instância, o login, a sala e a barra com Ativar som foram vistos no navegador. O exe já instalado nos PCs não muda sozinho. Sem commit. Sem GO/NO-GO.

### 2026-10-19 — visual da reunião — Grok
A reunião passou a usar fundo escuro, destaque verde, lista à esquerda e controles embaixo. O nome do participante vai no token da sala. Um id cru aparece como Você ou Participante. Sem GO/NO-GO.

### 2026-10-19 — som remoto sem ligar o microfone — Grok
O outro PC só ouvia depois de ligar o próprio microfone. A reunião agora mostra **Ativar som**, que chama `startAudio` no clique. O instalador já aberto não tem esse botão. Sem GO/NO-GO.

### 2026-10-19 — áudio de um lado não chega — Grok
No teste de 10 minutos, o microfone deste PC não saiu no outro. Câmera e tela já tinham passado. M03 segue aberto. Sem GO/NO-GO.

### 2026-10-19 — janela compartilhada nos dois PCs — Grok
M06 ficou `PASS`. Os dois lados compartilharam uma janela, a imagem apareceu no outro PC e sumiu ao parar. M03 em diante segue aberto. Sem GO/NO-GO.

### 2026-10-19 — monitor compartilhado nos dois PCs — Grok
M05 ficou `PASS`. Os dois lados compartilharam o monitor inteiro, a imagem apareceu no outro PC e sumiu ao parar. M06 em diante segue `NOT_RUN`. Sem GO/NO-GO.

### 2026-10-19 — dois PCs com mídia — Grok
O instalador abriu nos dois PCs e os dois entraram na mesma sala. Microfone, câmera e compartilhamento de tela funcionaram. Não houve medida de duração, resolução, rede distinta, parar e republicar, janela contra monitor, queda de 5 s, TURN, troca de dispositivo, minimizar nem diagnóstico. M01–M12 seguem `NOT_RUN`. F02-06 segue `BLOCKED`. Sem GO/NO-GO.

### 2026-10-18 — F05 a F07-02 no remoto — Grok
O shell, o diagnóstico, o compose e o instalador entraram nesta branch. Nada passou a `DONE`. Sem GO/NO-GO. O teste nos dois PCs ainda não rodou.

### 2026-10-18 — instalador Windows e CI de release — Grok
F07-02 ficou `IMPLEMENTED` na branch `task/F07-02-installer`. O bundle é NSIS por usuário, sem assinatura. `pnpm --filter @openmeet/desktop exec tauri build --bundles nsis` gerou `OpenMeet_0.1.0_x64-setup.exe`, 1,94 MiB. SHA256 `96762deb4217ae39e38131f70e3979d014b4b1de92e8a642da82786a415950ce`. `node --test scripts/installer-checksum.test.mjs` 3 pass. O workflow publica só numa tag `v*` e as actions estão presas por SHA. O GitHub Actions não rodou. O instalador não foi aberto. A01 segue sem PASS. Windows, Node v24.18.0, rustc 1.98.1. F08 segue `PENDING`. Sem commit. Sem GO/NO-GO.

### 2026-10-18 — Compose, TLS, TURN e backup — Grok
F07-01 ficou `IMPLEMENTED` na branch `task/F07-01-compose`. A stack de um nó está em `infra/compose`: Postgres 17.6, API, LiveKit v1.13.10 sem `--dev` e Caddy 2.10.2. O POC em `infra/livekit` não mudou. O YAML do LiveKit sai fora do Git. TURN só liga com domínio e certificados, ou com TLS externo. `node --test scripts/livekit-config.test.mjs scripts/pg-copy.test.mjs` 4 pass. O restore local apagou a linha 7 e a restauração devolveu 7. A imagem da API subiu, aplicou migration e `/health/ready` respondeu `database ok`. Windows, Node v24.18.0, Docker 29.8.1. A VPS, o certificado público e as duas redes não rodaram. F07-02 ficou `READY`. Sem commit. Sem GO/NO-GO.

### 2026-10-18 — diagnóstico e medição da reconexão — Grok
F06-01 ficou `IMPLEMENTED` na branch `task/F06-01-resilience`. A reunião mostra a última reconexão e exporta `openmeet-diagnostico.json` só com consentimento. O arquivo não leva token, JWT, Bearer nem e-mail. Sair durante a reconexão não vira falha. `pnpm --filter @openmeet/media test` 32 pass. `pnpm --filter @openmeet/media build` e `pnpm --filter @openmeet/desktop typecheck` exit 0. Windows, Node v24.18.0. A janela não foi aberta. A queda de 5 s não rodou. M01–M12 seguem NOT_RUN. F07-01 ficou READY. Sem commit. Sem GO/NO-GO.

### 2026-10-18 — bandeja, atalhos e sessão nativa — Grok
F05-01 ficou `IMPLEMENTED` na branch `task/F05-01-shell`, com a F04-04 ainda em espera. Fechar a janela esconde o app. A bandeja mostra, alterna microfone e câmera, e sai. Os atalhos globais só registram com consentimento; conflito não entra. O refresh vai para o cofre do Windows, uma entrada por origem, e o access token não é gravado. A preferência fica em JSON local. `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib shell::tests` 5 pass. `pnpm --filter @openmeet/desktop typecheck` exit 0. Windows, Node v24.18.0, rustc 1.98.1. A janela não foi aberta. O instalador não rodou. M01–M12 seguem NOT_RUN. F06-01 ficou READY. Sem commit. Sem GO/NO-GO.

### 2026-10-18 — duração, métricas e dispositivos na reunião — Grok
F04-04 ficou `WAITING_VALIDATION` na `main`. A reunião troca entrada, saída e câmera sem novo join. O relógio continua na reconexão e some ao sair ou numa falha fatal. As métricas saem a cada 5 s. Sair de uma sala persistente deixa a sala na lista. Cinco câmeras cabem na grade. Áudio de sistema segue desligado. O refresh continua só na memória. `pnpm --filter @openmeet/media test` 28 pass. `pnpm --filter @openmeet/shared test` 18 pass. `pnpm --filter @openmeet/media build` e `pnpm --filter @openmeet/desktop typecheck` exit 0. Windows, Node v24.18.0. A janela não foi aberta. Os 60 min com cinco pessoas não rodaram. M01–M12 seguem NOT_RUN. F05-01 não começou. Sem GO/NO-GO.

### 2026-10-18 — compartilhamento e layout da reunião — Grok
F04-03 ficou `IMPLEMENTED` na `main`. O botão abre o seletor ou para a publicação. A tela remota fica em destaque; a local só ocupa o destaque se ninguém mais compartilha. O aviso nomeia monitor, janela ou guia, e some ao parar. Troca silenciosa da origem entra no diagnóstico. Áudio de sistema segue desligado. `pnpm --filter @openmeet/media test` 25 pass. `pnpm --filter @openmeet/desktop typecheck` exit 0. Windows, Node v24.18.0. A janela não foi aberta. F04-04 não começou. M01–M12 seguem NOT_RUN. Sem GO/NO-GO.

### 2026-10-18 — controles de volume, mute e câmera — Grok
F04-02 ficou `IMPLEMENTED` na `main`. O microfone e a câmera usam a publicação já existente da sessão. O volume e o silêncio de cada áudio remoto ficam no elemento local, sem pedido à API. `pnpm --filter @openmeet/media test` 19 pass. `pnpm --filter @openmeet/desktop typecheck` exit 0. Windows, Node v24.18.0. A janela não foi aberta. F04-03 não começou. M01–M12 seguem NOT_RUN. Sem GO/NO-GO.

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
