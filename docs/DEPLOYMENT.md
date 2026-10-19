# Deploy self-hosted

Stack de um nó em `infra/compose/docker-compose.yml`: API Fastify, PostgreSQL 17.6, LiveKit v1.13.10 e Caddy 2.10.2. O Compose em `infra/livekit/docker-compose.yml` permanece o POC local com `--dev` e portas em `127.0.0.1`.

## O que o operador preenche
Na raiz do repositório, com Docker no PATH:

```
node infra/compose/host.mjs --api-domain api.exemplo.com --livekit-domain livekit.exemplo.com --up
```

O script cria `infra/compose/.env` com senha, `AUTH_SECRET`, chave do LiveKit e `BOOTSTRAP_TOKEN`. Também gera o YAML em `infra/compose/generated/`. Os dois ficam fora do Git. Um arquivo já existente conserva os segredos. `LIVEKIT_URL` fica `wss://` no domínio do signaling. `POC_JOIN` não pode ser `1`.

Na primeira execução o script imprime só o `BOOTSTRAP_TOKEN`. Ele entra na tela do aplicativo para criar o administrador. A API recebe esse token pelo Compose. Sem `--up` os arquivos são gravados e a stack não sobe.

A API escuta `0.0.0.0:3000` só na rede do Compose, monta `DATABASE_URL` no entrypoint e aplica as migrations antes de subir. O readiness é `GET /health/ready`.

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
