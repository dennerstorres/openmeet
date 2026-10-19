# Deploy self-hosted

Stack de um nó em `infra/compose/docker-compose.yml`: API Fastify, PostgreSQL 17.6, LiveKit v1.13.10 e Caddy 2.10.2. O Compose em `infra/livekit/docker-compose.yml` permanece o POC local com `--dev` e portas em `127.0.0.1`.

## O que o operador preenche
Na raiz do repositório, com Docker no PATH:

```
node infra/compose/host.mjs --api-domain api.exemplo.com --livekit-domain livekit.exemplo.com --up
```

O script cria `infra/compose/.env` com senha, `AUTH_SECRET`, chave do LiveKit e `BOOTSTRAP_TOKEN`. Também gera o YAML em `infra/compose/generated/`. Os dois ficam fora do Git. Um arquivo já existente conserva os segredos. `LIVEKIT_URL` fica `wss://` no domínio do signaling. `POC_JOIN` não pode ser `1`.

O script não imprime segredo (S-12). O `BOOTSTRAP_TOKEN` fica só em `infra/compose/.env`, de onde o operador o copia para a tela do aplicativo e cria o administrador. A API recebe esse token pelo Compose. Sem `--up` os arquivos são gravados e a stack não sobe.

Depois de criar o administrador, a rota de bootstrap responde sempre 404, com qualquer token, e o processo da API já não guarda o token. Para tirá-lo também do `.env` e do `docker inspect`:

```bash
node infra/compose/host.mjs --clear-bootstrap
```

```bash
docker compose --env-file infra/compose/.env -f infra/compose/docker-compose.yml up -d --force-recreate api
```

O primeiro comando lê o estado dentro do container do Postgres (`docker compose exec -T postgres psql`), sem abrir porta, e só apaga a chave quando o banco responde que o bootstrap fechou. Rodar `host.mjs` de novo não recria o token.

A API escuta `0.0.0.0:3000` só na rede do Compose, monta `DATABASE_URL` no entrypoint e aplica as migrations antes de subir. O readiness é `GET /health/ready`.

## Portas
Caddy publica 80/tcp, 443/tcp e 443/udp. Ele termina TLS nos dois domínios e encaminha a API e o signaling `7880`. O `7880` não fica público.

A mídia publica `7881/tcp` e `7882/udp`. Esse UDP é o mux. A faixa `50000-60000` não é usada. Cloudflare Tunnel não carrega essa mídia.

TURN fica desligado até o operador escolher um modo. Com certificado próprio, gere o YAML com `TURN_DOMAIN`, `TURN_CERT_FILE` e `TURN_KEY_FILE`, e suba também `docker-compose.turn.yml` e `docker-compose.turn-certs.yml`. O modo `TURN_EXTERNAL_TLS=1` foi retirado (S-20): nenhum serviço desta stack termina TLS de TURN, e o gerador recusa esse valor. Usuário e senha fixos de TURN também são recusados; o LiveKit emite credencial efêmera. `docker-compose.turn.yml` publica só `3478/udp`; o `5349/tcp` só aparece com `docker-compose.turn-certs.yml`, que monta o certificado. O `5349` não toma o `443` do Caddy.

`LIVEKIT_NODE_IP` é opcional. Sem ele, o LiveKit descobre o IP público. Loopback e link-local são recusados.

A API não pode ganhar `ports` no Compose nem ser publicada fora do Caddy (S-11). O Caddy entrega `X-OpenMeet-Proxy` com o `PROXY_AUTH` do `.env` e reescreve `X-Forwarded-For`; um teste do repositório falha se `api` ou `postgres` publicarem porta. Uma `.env` antiga ganha `PROXY_AUTH` ao rodar `host.mjs` de novo; sem ele a API não sobe.

## Backup
Com a stack no ar:

```
node infra/compose/pg-copy.mjs backup
node infra/compose/pg-copy.mjs restore
```

O dump vai cifrado para `infra/compose/generated/openmeet.sql.enc` (S-17): AES-256-GCM com chave derivada de `BACKUP_KEY`, que o `host.mjs` gera, não imprime e não é a senha do Postgres. O comando lê `POSTGRES_PASSWORD` e `BACKUP_KEY` do ambiente ou de `infra/compose/.env` e não passa a senha ao Docker. Nenhum SQL em claro toca o disco. Se o dump contiver a senha do banco, o arquivo parcial é apagado e a operação falha. Restaurar confere a chave e a integridade antes de mandar qualquer linha ao `psql`. Um `.sql.enc` só restaura com a `BACKUP_KEY` da época em que foi gravado: guarde a chave junto do backup, em outro lugar. Um `openmeet.sql` antigo, de antes da cifra, ainda restaura sem chave com `restore infra/compose/generated/openmeet.sql`. No Windows, o `.env` e o backup ficam só com leitura e escrita do usuário atual (`icacls`); no Linux, modo `0600`.

## Firewall do host

O repositório não configura o firewall da VPS; o operador abre só: `80/tcp`, `443/tcp`, `443/udp`, `7881/tcp` e `7882/udp`, e mais `3478/udp` e `5349/tcp` apenas com o TURN de certificado ligado. `3000` (API) e `5432` (Postgres) nunca. O compose de `infra/livekit` é de POC, usa `--dev` e loopback: não use numa VPS.

## Contas (S-02)

O administrador desativa, reativa e troca a senha de outra conta pela API: `GET /api/v1/admin/users`, `POST /api/v1/admin/users/:id/disable`, `/enable` e `/password`. Desativar revoga todas as sessões e tira a pessoa das salas abertas; se o LiveKit falhar, a resposta é 502, a conta continua desativada e repetir o POST tenta de novo. Reativar responde 502 enquanto esse corte não confirmou. A própria pessoa troca a senha em `POST /api/v1/auth/password`, com a senha atual; as outras sessões dela caem.

A conta de administrador não é alvo dessas rotas. Se a senha dele se perdeu, recuperar no host, com a senha nova num arquivo de uma linha que só o operador lê:

```bash
docker compose exec -T api node dist/db/recover-admin.js < senha-nova.txt
```

A senha entra pelo stdin, nunca por argumento nem variável. O comando monta a conexão com as `POSTGRES_*` do Compose, troca a senha, revoga as sessões do administrador e grava `admin_password_recover` na auditoria. Não imprime senha, hash nem URL, e não reabre o bootstrap. Apagar o arquivo depois.

## O que ainda não foi provado
TLS e ICE/TURN numa VPS, NAT, rede celular e duas redes externas continuam sem evidência. Não declarar a fase pronta antes desse teste e de uma restauração no ambiente real. O instalador Windows está em `docs/RELEASE.md`.

Referências: https://docs.livekit.io/transport/self-hosting/ e https://docs.livekit.io/transport/self-hosting/ports-firewall/

## Login com Google (opcional, ADR 0010)

1. No Google Cloud, crie um cliente OAuth do tipo **aplicativo da Web**.
2. URI de redirecionamento autorizada: `https://<API_DOMAIN>/api/v1/auth/google/callback`.
3. Grave no `infra/compose/.env`, fora do Git: `GOOGLE_CLIENT_ID=...` e `GOOGLE_CLIENT_SECRET=...`.
4. Recrie o serviço `api`. `GET /api/v1/instance` passa a responder `googleLogin: true` e o botão aparece no aplicativo.

Sem as duas chaves o botão some e as rotas do Google respondem 404. A URI de retorno vem de `API_DOMAIN`, ou de `GOOGLE_REDIRECT_URI` quando definida; nunca do cabeçalho Host. A primeira entrada com Google cria um participante sem servidor; o convite continua obrigatório. O primeiro administrador continua nascendo pelo token de instalação.
