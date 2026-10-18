# HISTORY — registro cronológico

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
