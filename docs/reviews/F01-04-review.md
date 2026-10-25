# F01-04 — Revisão de ADRs e documentação de ambiente

Revisor: Claude (arquitetura e segurança) · Data: 2026-10-18 · Branch: `task/F01-01-monorepo-bootstrap`

## Decisão

**F01-04 continua `IMPLEMENTED`.** Não vai para `VERIFIED`: o G1 pede CI verde e o CI nunca rodou em remoto. Há um achado alto (R1) que precisa de ADR antes do F04-01.

## Evidência executada nesta revisão

Plataforma: Windows 11 Pro 10.0.26200, Node v24.18.0, pnpm 10.30.2.

| Verificação | Resultado |
|---|---|
| `pnpm format:check` | falha: 5 arquivos fora do Prettier (`apps/desktop/index.html`, `apps/server/test/env-file.test.ts`, `eslint.config.mjs`, `packages/shared/src/poc.ts`, `packages/shared/test/poc.test.ts`) |
| Seção "Senha" do `docs/ENVIRONMENT.md` contra o código | confere: Argon2id 19456/2/1 (`auth/password.ts`), SHA-256 para refresh e bootstrap (`auth/tokens.ts`), access 15 min, refresh 30 dias (`auth/service.ts`) |
| Rotas do `docs/ARCHITECTURE.md` contra `apps/server/src` | divergem (R3) |
| CSP em `apps/desktop/src-tauri/tauri.conf.json` contra ADR 0003 | conflita (R1) |
| `.env.example` | só placeholders; nenhum segredo |

Não rodei CI remoto, `cargo check` nem a janela Tauri.

## Achados

**R1 — Alto — a CSP do desktop impede o multi-instância do ADR 0003.** O `connect-src` só aceita a API em `127.0.0.1:3000`/`localhost:3000` e um domínio fixo, `https://livekit.exemplo.com`. O ADR 0003 diz que o usuário configura vários servidores. Com essa CSP, o app distribuído não chega na API HTTPS de nenhuma instância real. Também deixa `wss:` aberto para qualquer host e embute o domínio pessoal no bundle de distribuição. Uma CSP do Tauri é fixada no build, então isso não se resolve em runtime. **Ação:** ADR antes do F04-01 escolhendo entre (a) `connect-src https: wss:` aberto, aceitando o risco, ou (b) chamadas REST pelo lado Rust (`tauri-plugin-http` com escopo por instância configurada), com o LiveKit ainda no WebView. Tirar o domínio pessoal da config versionada.

**R2 — Médio — G1 incompleto.** O CI (`.github/workflows/ci.yml`) nunca rodou no GitHub. Não roda `format:check` e o Prettier hoje falha em 5 arquivos. Também não roda `cargo check`, então o shell nativo fica fora do gate. **Ação:** formatar, incluir `pnpm format:check` no CI e decidir se `cargo check` entra no G1 ou fica registrado como fora dele.

**R3 — Médio — os endpoints do `ARCHITECTURE.md` não batem com o servidor.** Existem e não estão no doc: `POST /auth/bootstrap`, `POST /admin/users`, `DELETE /rooms/:id/invites/:inviteId`, `DELETE /rooms/:id/members/:userId`, `POST /poc/join`. Estão no doc e não existem: `GET /instance`, `DELETE /rooms/:id`, `GET /admin/users`, `PATCH /admin/users/:id`. Não há OpenAPI, embora o doc diga que `packages/shared` tem "tipos OpenAPI". **Ação:** atualizar a lista e marcar o que é proposta e o que existe. `GET /instance` faz falta ao F04-01: é ele que diz ao desktop que a URL é uma instância OpenMeet.

**R4 — Baixo — o workflow do CI não restringe permissões.** Não há `permissions: contents: read`, e as actions estão fixadas por tag, não por SHA. **Ação:** adicionar o bloco `permissions` e avaliar o pin por SHA no G7/G8.

**R5 — Baixo — ADRs magros.** Os ADRs 0001–0003 não têm data, autor nem consequências. Falta ADR para Postgres/Drizzle e para o access token HMAC próprio (`auth/tokens.ts`) em vez de uma biblioteca JWT. O código do token fica para a revisão de segurança do G3.

## Fica para depois

`packages/ui` é só `.gitkeep`, o que é coerente com a fase. A seção "Senha" está correta. O ADR 0004 segue `BLOCKED` pelo G2, como o PLAN registra.
