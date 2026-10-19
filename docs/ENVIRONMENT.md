# Ambiente verificado — 2026-10-18

Versões lidas nesta máquina. Nada aqui é uma meta de release futura.

| Ferramenta | Como foi lida | Valor |
|---|---|---|
| Git | `git --version` | 2.55.0.windows.5 |
| Node.js | `node -v` | v24.18.0 |
| Node.js 24 LTS no blog | https://nodejs.org/en/blog em 2026-10-14 | 24.22.0 (Active LTS; esta máquina está 4 patches atrás) |
| Corepack | `corepack --version` | 0.35.0 |
| pnpm em uso | `pnpm -v` | 10.30.2 (`packageManager` do repositório) |
| pnpm anunciado pelo próprio CLI | aviso no `pnpm install` | 12.14.0 disponível; não atualizado nesta sessão |
| npm | `npm -v` | 11.16.0 |
| Rust | `%USERPROFILE%\.cargo\bin\rustc.exe -V` | rustc 1.98.1 (48a229cea 2026-09-01) |
| Cargo | `%USERPROFILE%\.cargo\bin\cargo.exe -V` | cargo 1.98.1 (797e8a9bc 2026-08-05) |
| rustup | `rustup show` | stable-x86_64-pc-windows-msvc, alvo x86_64-pc-windows-msvc |
| MSVC | vswhere + pasta `VC\Tools\MSVC` | BuildTools VS 18, tools 14.51.36231 |
| WebView2 | registro EdgeUpdate | 155.0.4283.62 |
| Docker | `docker version` / `docker info` | client/server 29.8.1, engine Linux via Docker Desktop |
| create-tauri-app | `pnpm create tauri-app --version` | pacote npm 4.7.5; binário impresso 4.8.0 |
| Tauri (Cargo.lock) | `cargo check` | tauri 2.12.4, tauri-build 2.7.3 |
| Fastify | `pnpm add` | ^5.12.7 |
| TypeScript | template + lock | ~6.0.3 |
| Vite | saída do `vite build` | 8.3.4 |
| LiveKit server | GitHub releases/latest em 2026-10-14 | v1.13.10 |

Rust e Cargo não estão no `PATH` desta sessão. Os comandos usam `C:\Users\Administrador\.cargo\bin`.

## Comandos da fundação

```text
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

O build do desktop neste gate é o frontend Vite. O shell nativo é `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` com o Cargo no `PATH`. `pnpm tauri dev` abre janela e não foi usado como prova de câmera, microfone ou tela.

## Senha
Argon2id, memória 19456 KiB, 2 iterações, paralelismo 1. O resultado vai para `users.password_hash`. Refresh e bootstrap guardam SHA-256, nunca o segredo. `AUTH_SECRET` assina o access token por 15 minutos e o token carrega o id da sessão. Logout e rotação invalidam esse access token. O refresh dura 30 dias e gira a cada uso.

Login aceita 8 tentativas por usuário e IP em 15 minutos, e 30 por IP. Bootstrap aceita 5 por IP. Refresh aceita 60 por IP e 12 pelo mesmo token. O mapa de tentativas guarda no máximo 4096 chaves; cheio, endereço novo é recusado até alguma chave expirar. Com `TRUST_PROXY=1` a API exige `PROXY_AUTH` (32 caracteres ou mais, gerado por `host.mjs`) e só aceita login, bootstrap, refresh e Google com o cabeçalho `X-OpenMeet-Proxy` igual a ele; então usa o único hop de `X-Forwarded-For` que o Caddy escreveu. Sem o cabeçalho certo a resposta é 503 `proxy_rejected`. Sem `TRUST_PROXY`, o limite olha o IP do socket. A API e o Postgres não publicam porta: só o Caddy fala com a API, e não há segundo proxy suportado na frente dele.
