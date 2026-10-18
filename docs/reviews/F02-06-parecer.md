# F02-06 — Parecer técnico da Fase 2 (POC de mídia)

Revisor: Claude (arquitetura e segurança) · Data: 2026-10-18 · Branch: `task/F01-01-monorepo-bootstrap` (sem commits; árvore não versionada)

## Decisão

**PROVISÓRIO — sem GO e sem NO-GO.** F02-06 continua `BLOCKED`. **A Fase 3 não está liberada.**

Motivo: M01–M12 estão `NOT_RUN` e não há nenhum dado real de WebView2 capturando microfone, câmera, monitor ou janela. Não há falha comprovada do WebView2, por isso também não cabe NO-GO. Além da falta de evidência, há quatro pendências altas (A1–A4): duas impedem um teste G2 válido e duas são de segurança/higiene da mídia.

Este parecer vira definitivo quando: A1–A4 estiverem corrigidos e revisados; M01–M10 e os itens do ADR 0004 tiverem evidência; o ADR 0004 for assinado com GO ou NO-GO.

## Evidência executada nesta revisão

Plataforma: Windows 11 Pro 10.0.26200, Node v24.18.0, pnpm 10.30.2, Docker 29.8.1. Dependências resolvidas: `livekit-client` 2.23.0, `livekit-server-sdk` 2.19.1, Fastify 5.12.7, `tauri-runtime-wry` 2.12.2, `wry` 0.57.0, `webview2-com` 0.39.1.

| Comando | Resultado |
|---|---|
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0 |
| `pnpm test` | exit 0 — workspace 9, shared 6, media 5, server 7, desktop 2 (29/29) |
| `pnpm build` | exit 0 — aviso de chunk de 764 kB |
| `pnpm format:check` | **exit 1** — 5 arquivos fora do Prettier (`apps/desktop/index.html`, `apps/desktop/src/poc/PocApp.tsx`, `eslint.config.mjs`, `packages/shared/src/poc.ts`, `packages/shared/test/poc.test.ts`) |
| `docker logs livekit-livekit-1` | `"nodeIP": "172.19.0.2"` em modo dev (ver A3) |

Ao começar a revisão, o container LiveKit e um servidor `tsx watch src/main.ts` (PID 41052, variáveis vindas do processo) já estavam rodando, abertos pelo Grok na "validação manual F02 iniciada" do `HISTORY.md`. O Grok estava escrevendo na mesma worktree durante a revisão (`tauri.conf.json`, `HISTORY.md`), o que contraria o `orchestration/WORKFLOW.md`. Não parei nenhum dos dois processos. Fiz um único `POST /api/v1/poc/join` (identidade `review-probe`), que respondeu 200; o token não foi usado.

Não executado: janela Tauri, `tauri build`, qualquer captura de mídia, segundo PC, TURN. Os testes automáticos cobrem parsing, máquina de estados, resumo de stats e o endpoint. **Nenhum deles exercita WebRTC, WebView2 ou dispositivos.**

## Achados

Severidade: **Crítica** (dados/segurança comprometidos já) · **Alta** (bloqueia G2 ou corrige risco real, barato) · **Média** (compromete evidência ou fases seguintes) · **Baixa** (higiene).

Nenhum achado Crítico.

### A1 — Alta — O roteiro não permite o PC B em outra rede

- `infra/livekit/docker-compose.yml:7-10` publica as portas só em `127.0.0.1`.
- `apps/server/src/main.ts:4` faz bind em `127.0.0.1` por padrão.
- `packages/shared/src/poc.ts:42-48,58-67` só aceita API `http` em loopback e sinal `ws` em loopback; para host remoto exige `https`/`wss`.
- `docs/POC_F02.md:25-27` manda abrir o cliente no segundo PC, mas esse PC não alcança API nem SFU, e não existe topologia com TLS ou TURN.

Consequência: M02, M03, M07 e M08 não podem ser executados como escrito. G2 exige redes distintas.

Correção proposta: uma topologia de teste remota mínima. LiveKit numa VPS de teste com configuração própria (não `--dev`), chave e segredo gerados fora do Git, TLS (`wss`) e TURN/TLS embutido do LiveKit. O token é emitido só na máquina do operador (CLI ou endpoint loopback) e colado no PC B por um campo de token na tela da POC, sem expor emissor na rede. Deploy público precisa de autorização humana (AGENTS.md).

### A2 — Alta — O microfone local toca no próprio alto-falante

- `packages/media/src/session.ts:116-120` cria tile também para a faixa local de microfone.
- `apps/desktop/src/poc/TrackView.tsx:19-25` renderiza `<audio autoPlay>` sem `muted`.
- `livekit-client` 2.23.0, `attachToElement`: `element.muted = mediaStream.getAudioTracks().length === 0`, ou seja, `false` para áudio.

Consequência: a pessoa ouve a própria voz com atraso; com caixa de som vira microfonia. O M03 (áudio por 10 min) sairia contaminado.

Correção: não criar elemento de áudio para faixa local; mostrar só indicador.

### A3 — Alta (PLAUSÍVEL) — O SFU local anuncia o IP do container

- `infra/livekit/docker-compose.yml:6` roda `--dev --bind 0.0.0.0` sem `--node-ip`.
- O log do container mostra `"nodeIP": "172.19.0.2"`. Os candidatos ICE apontam para esse IP, que o Docker Desktop não roteia a partir do Windows.

Consequência provável: sinalização conecta, mídia não ("could not establish pc connection"). Isso pareceria falha do WebView2 sem ser. O F02-01 só provou HTTP 200 na 7880. Falha de ICE não reproduzida nesta revisão.

Correção: acrescentar `--node-ip 127.0.0.1` e registrar um teste de mídia local antes de M01.

### A4 — Alta — `POC_JOIN` não tem guarda de rede

- `apps/server/src/poc-join.ts:9-32,44-60` emite token com publish/subscribe para qualquer sala e identidade, sem autenticação.
- A proteção é só o bind padrão (`main.ts:4`) e o CORS (`app.ts:5,15-18`), que não segura cliente fora de navegador nem DNS rebinding (o `Host` não é conferido).
- Com `HOST=0.0.0.0`, saída natural para o PC B, qualquer máquina da rede emite token. Também pode usar uma identidade já presente e derrubar quem está nela (`DUPLICATE_IDENTITY`). Com um LiveKit real em `wss` (aceito por `parseSignalUrl`), o vazamento passa a valer na VPS.
- A rota vai no build de produção e só é desligada por variável. O 404 com `{"error":"poc_disabled"}` (`poc-join.ts:11,34-36`) revela que ela existe.

Correção: registrar a rota só quando `POC_JOIN=1` **e** o bind for loopback (recusar o boot com outro `HOST`). Recusar `request.ip` fora de loopback e `Host` fora de `127.0.0.1`/`localhost`. Remover a rota antes de F03-03 (o emissor real nasce com RBAC). Testes negativos para os três casos.

### M1 — Média — O diagnóstico não coleta o que G2 exige

`docs/TEST_MATRIX.md` pede versão do WebView2/app/LiveKit, fps/resolução e rede. `packages/media/src/session.ts:52-77,214-231` e `stats.ts` só leem perda, jitter e RTT. Faltam:

- tipo do candidato selecionado (`host`/`srflx`/`relay`), sem o qual o M08 não prova TURN;
- `outbound-rtp` fps e resolução;
- `getSettings().displaySurface` da tela compartilhada, que prova monitor × janela no M05/M06;
- `navigator.userAgent` (versão Chromium do WebView2) e versão do app;
- motivo da desconexão (ver M2).

Defeitos no resumo: jitter é o do último `inbound-rtp`, não o pior; RTT vem do último par nominado entre publisher e subscriber; perda é cumulativa e aparece como número solto. `room.engine.pcManager` está marcado `@internal` em `livekit-client` (`Room.d.ts:51-52`) com faixa `^2.23.0`. Usar `track.getRTCStatsReport()` ou fixar a versão exata.

### M2 — Média — A desconexão não diz o motivo

`session.ts:101-105` ignora o `DisconnectReason`, e `phase.ts:20-21` transforma tudo em `disconnected`. Falha de reconexão, expulsão, identidade duplicada e clique em "Sair" ficam iguais. RF-10 pede distinguir recuperável de fatal, e o M07 precisa disso para ter evidência.

### M3 — Média — Erro de mídia fica só no log

- `PocApp.tsx:118,128-136` chama os toggles com `void`. A sessão relança o erro (`session.ts:233-241`), que vira rejeição sem tratamento, e o banner de erro não mostra nada.
- Cancelar o seletor de tela gera `NotAllowedError`, igual a permissão negada.
- Os botões não travam enquanto a operação está pendente.
- `refreshStats` (`PocApp.tsx:39-41`) não tem `catch`; durante reconexão completa, `getStats` em PC fechado rejeita a cada 5 s.

RF-05 pede erro visível por faixa.

### M4 — Média — Permissão fica com o prompt padrão do WebView2

`apps/desktop/src-tauri/src/lib.rs` não registra handler de permissão. O Tauri 2.12 tem um (`tauri-runtime-wry` `lib.rs:4891`); sem ele, o wry deixa o WebView2 mostrar o prompt padrão (`wry` `webview2/mod.rs:532-577`). Consequências para o teste:

- a decisão fica gravada no perfil `EBWebView` por origem;
- `tauri dev` (`http://localhost:1420`) e o build (`http://tauri.localhost`) são origens diferentes, então permissão testada no dev não vale para o build;
- uma negação fica persistente e a UI não oferece saída;
- o bloqueio da privacidade do Windows ("permitir que apps da área de trabalho acessem") só aparece como erro genérico.

Na POC: o M01 precisa incluir negar e permitir com perfil limpo, no build. Em F04/F05: handler explícito que libera só microfone/câmera da origem do app.

### M5 — Média — A POC roda sem a CSP que será distribuída

`tauri.conf.json:20-22` tem `"csp": null`. Um GO dado sem CSP valida uma configuração que não vai ao usuário. Ligar a CSP depois pode quebrar `connect-src` (API, `wss`) ou `media-src` (`blob:`/`mediastream:`). Restos do template ampliam o IPC sem uso: comando `greet` (`lib.rs:1-14`) e `opener:default` (`capabilities/default.json:6`).

Correção: definir a CSP de produção antes do M01 e tirar o que sobrou do template.

### M6 — Média — O critério de saída da fase não fecha com os ADRs

- `plans/phase-02-media-poc.md:8-9` exige M01–M08.
- ADR 0001 e ADR 0004 (`0004-capture.md:8`) também condicionam a decisão a: minimizar/restaurar (M10), troca de dispositivo (M09), duas versões do Windows, vários monitores, permissão negada, dev **e** build.
- M11 (5 PCs, 60 min) é critério de G4. M12 testa autorização, que a POC não tem; é G3.

Correção: G2 = M01–M10 + itens do ADR 0004; mover M11 para G4 e M12 para G3.

### B1 — Baixa — O `.env` não é carregado

`apps/server/package.json:7` roda `tsx watch src/main.ts` sem `--env-file`. Os passos 1–2 de `docs/POC_F02.md` resultam em 404 `poc_disabled`. O servidor que estava rodando nesta máquina recebia as variáveis pelo shell.

### B2 — Baixa — Lista de dispositivos

`session.ts:188-202` chama `getLocalDevices(kind, false)` logo depois de conectar (`PocApp.tsx:66`). Sem permissão concedida, rótulos e IDs vêm vazios. Não há listener de `MediaDevicesChanged`, e o `<select>` (`PocApp.tsx:180-209`) não mostra o dispositivo ativo. Afeta M01 e M09.

### B3 — Baixa — Mute remoto não aparece

`TrackMuted`/`TrackUnmuted` não são tratados (`session.ts:88-131`). Câmera remota desligada parece imagem congelada (RF-05).

### B4 — Baixa — Microfone "desligado" continua capturando

`setMicrophoneEnabled(false)` só silencia a publicação (`stopMicTrackOnMute` vem `false` por padrão). O indicador de privacidade do Windows continua aceso. É coerente com "mute de publicação" da SPEC, mas a decisão precisa ser registrada.

### B5 — Baixa — Build e CI

Ainda não existe build empacotado (`target/` só tem `debug` do `cargo check`). `bundle.targets: "all"` (`tauri.conf.json:26`) inclui MSI, que depende do WiX. O CI (`.github/workflows/ci.yml`) não roda `cargo`/`tauri build` nem `format:check`, que hoje falha.

## Pontos corretos

- Token com TTL de 10 min, sala única, `canPublishData: false`, `cache-control: no-store`. O SDK renova o token durante a sessão.
- Sanitização de JWT e de segredo conhecido no diagnóstico, com testes.
- Compartilhamento com `audio: false`.
- "Parar compartilhamento" do sistema despublica a faixa (`handleTrackEnded` do SDK).
- `disconnect(true)` encerra as faixas locais.
- `disconnectOnPageLeave` vem ativo.
- O autoplay é liberado pelo wry (`--autoplay-policy=no-user-gesture-required`).

## Riscos arquiteturais e de Windows (para o ADR 0004)

1. **`getDisplayMedia` no WebView2.** Nem o wry 0.57 nem o `tauri-runtime-wry` 2.12 tratam `ScreenCaptureStarting`. A captura depende do seletor padrão do runtime, sem controle de origem pelo app. Se o seletor não aparecer ou não listar janelas, vale o plano B do ADR 0004.
2. **Minimizar e janela oculta (M10).** O throttling de segundo plano do Chromium pode atrasar timers e o ping de sinalização. Contingência existente: `additionalBrowserArgs` (`tauri-runtime-wry` `lib.rs:4984`). Ela substitui os argumentos padrão do wry, então precisa repetir `--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection` e a política de autoplay.
3. **WebView2 Evergreen.** O runtime (155.x hoje) muda sem o app mudar. Cada evidência registra a versão. Se houver sensibilidade, avaliar Fixed Version.
4. **Origem `http://tauri.localhost`.** Mudar o esquema depois (`useHttpsScheme`) troca a origem e apaga permissões e armazenamento local.
5. **Rede local de desenvolvimento.** Docker Desktop no Windows não roteia para IP de container (A3).
6. **Fechar a janela.** Não está garantido que fechar a janela pelo X dispare `pagehide` no WebView2. O remoto pode ver o participante "fantasma" até o timeout do servidor. Observar nos testes.

## Próximos passos (ordem)

1. Grok corrige A2, A3, A4, B1 e M3. Revisão do Claude sobre o diff.
2. Humano decide e autoriza a topologia remota da A1 (VPS de teste, domínio, TLS, TURN). Grok implementa o campo de token e o emissor local.
3. Grok implementa M1, M2 e M5 (coleta de evidência e CSP) e gera o `tauri build`.
4. Ajustar o critério de G2 conforme M6 em `plans/phase-02-media-poc.md` e `docs/TEST_MATRIX.md`.
5. Humano executa M01–M10 em Windows 10 e 11, redes distintas e build empacotado, e preenche `docs/TEST_MATRIX.md`.
6. Claude emite o parecer definitivo e assina GO/NO-GO no ADR 0004.
