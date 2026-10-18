# POC F02 — roteiro humano

Estado: código pronto, execução manual `NOT_RUN`. M01–M08 continuam `NOT_RUN` em `docs/TEST_MATRIX.md`. F02-06 não tem GO nem NO-GO.

## O que já está no repositório

- Cliente Tauri 2 / React em `apps/desktop`, tela `PocApp`, SDK `livekit-client` 2.23.0 via `@openmeet/media`.
- `POST /api/v1/poc/join` no Fastify. Só responde se `POC_JOIN=1` no ambiente local. O token dura 10 minutos, vale para uma sala e não publica dados.
- Compose local em `infra/livekit/docker-compose.yml`, imagem `livekit/livekit-server:v1.13.10`, portas só em `127.0.0.1`.

## Credenciais

`livekit-server --dev` cria o par local documentado pelo upstream (`devkey` / `secret`). Esse par não entra no Git. `.env.example` só tem placeholders. Não usar esse modo fora de localhost e não copiar o par para CI, logs ou uma VPS.

## Subir o SFU local

```text
docker compose -f infra/livekit/docker-compose.yml up
```

Conferir `http://127.0.0.1:7880`. Parar com `docker compose -f infra/livekit/docker-compose.yml down`. Isso não valida áudio, câmera, monitor, janela, TURN nem duas redes.

## Como duas pessoas testam

1. Copie `.env.example` para `.env` fora do Git. Preencha a chave e o segredo que o processo local do LiveKit mostrar. Ponha `POC_JOIN=1`.
2. Suba o compose e o servidor: `pnpm --filter @openmeet/server dev`.
3. Abra dois clientes Windows, com identidades diferentes e a mesma sala. O segundo precisa de outra máquina, ou de um build já instalado: o `tauri dev` usa a porta 1420 com `strictPort`. Nesse outro PC, deixa o token colado e a URL `wss`. O token sai só no primeiro PC. Com `POC_JOIN=1`, o servidor recusa subir se `HOST` não for loopback, e o join recusa IP ou `Host` que não sejam `127.0.0.1` ou `localhost`.
4. Ligue microfone e câmera dos dois lados. Compartilhe um monitor, pare, compartilhe uma janela e pare.
5. Derrube a rede por 5 segundos e anote se o estado vai a `reconnecting` e volta.
6. Copie o diagnóstico da tela. Confira que não há token nem segredo. Preencha `docs/TEST_MATRIX.md`.

Um navegador solto ou um teste de unidade não substitui o app empacotado nem o segundo PC.

## O que a fase 2 ainda exige

1. Dois Windows em redes diferentes.
2. Publicar e ouvir microfone nos dois sentidos.
3. Câmera nos dois clientes.
4. Selecionar monitor, transmitir e parar.
5. Selecionar uma janela, transmitir e parar.
6. Queda de rede de 5 s e reconexão.
7. Registrar WebView2, build do Windows, versão do LiveKit, RTT, jitter, perda, fps e log sem mídia nem segredo.
8. Só então preencher ADR 0004 com GO ou NO-GO.

Até esse registro, F02-02 em diante não passam de `WAITING_VALIDATION` e nenhuma feature de produto (F03+) começa.
