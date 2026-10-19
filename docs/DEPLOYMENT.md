# Deploy self-hosted

Stack de um nó em `infra/compose/docker-compose.yml`: API Fastify, PostgreSQL 17.6, LiveKit v1.13.10 e Caddy 2.10.2. O Compose em `infra/livekit/docker-compose.yml` permanece o POC local com `--dev` e portas em `127.0.0.1`.

## O que o operador preenche
Crie um ambiente privado, fora do Git, com `POSTGRES_PASSWORD`, `AUTH_SECRET` (32 caracteres ou mais), `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_URL`, `API_DOMAIN` e `LIVEKIT_DOMAIN`. A chave e o segredo do LiveKit são alfanuméricos, diferentes, de 16 a 128 caracteres. `LIVEKIT_URL` é `wss://` no domínio do signaling. Não defina `POC_JOIN`.

Gere o YAML do LiveKit e suba a stack a partir da raiz do repositório:

```
node infra/compose/render-livekit.mjs
docker compose -f infra/compose/docker-compose.yml up -d --build
```

O arquivo gerado fica em `infra/compose/generated/` e não entra no Git. A API escuta `0.0.0.0:3000` só na rede do Compose, monta `DATABASE_URL` no entrypoint e aplica as migrations antes de subir. O readiness é `GET /health/ready`.

## Portas
Caddy publica 80/tcp, 443/tcp e 443/udp. Ele termina TLS nos dois domínios e encaminha a API e o signaling `7880`. O `7880` não fica público.

A mídia publica `7881/tcp` e `7882/udp`. Esse UDP é o mux. A faixa `50000-60000` não é usada. Cloudflare Tunnel não carrega essa mídia.

TURN fica desligado até o operador escolher um modo. Com certificado próprio, gere o YAML com `TURN_DOMAIN`, `TURN_CERT_FILE` e `TURN_KEY_FILE`, e suba também `docker-compose.turn.yml` e `docker-compose.turn-certs.yml`. Com TLS terminado fora do LiveKit, use `TURN_EXTERNAL_TLS=1` e só o arquivo de portas. As portas extras são `3478/udp` e `5349/tcp`. O `5349` não toma o `443` do Caddy.

`LIVEKIT_NODE_IP` é opcional. Sem ele, o LiveKit descobre o IP público. Loopback e link-local são recusados.

## Backup
Com a stack no ar e `POSTGRES_PASSWORD` só no ambiente do processo:

```
node infra/compose/pg-copy.mjs backup
node infra/compose/pg-copy.mjs restore
```

O dump vai para `infra/compose/generated/openmeet.sql`. O comando não recebe a senha. Se o arquivo contiver a senha, ele é apagado e a operação falha. Restaurar reescreve os objetos do dump.

## O que ainda não foi provado
TLS e ICE/TURN numa VPS, NAT, rede celular e duas redes externas continuam sem evidência. Não declarar a fase pronta antes desse teste e de uma restauração no ambiente real. O instalador Windows está em `docs/RELEASE.md`.

Referências: https://docs.livekit.io/transport/self-hosting/ e https://docs.livekit.io/transport/self-hosting/ports-firewall/
