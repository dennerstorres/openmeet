# HANDOFF — fase 13, salas de texto (2026-10-27)

## Feito (commitado, uma branch por tarefa, empilhadas)
| Tarefa | Branch | Commit | Estado |
| --- | --- | --- | --- |
| F13-01 ADR 0024 aceito, SPEC item 23 | `task/F13-02-schema-mensagens` | 0524f0f | DONE |
| F13-02 migração 0011 e schema | `task/F13-02-schema-mensagens` | 0524f0f | IMPLEMENTED |
| F13-03 API de mensagens das salas | `task/F13-03-api-mensagens` | 3f63b24 | IMPLEMENTED |
| F13-04 SSE por conta | `task/F13-04-sse` | 92703a9 | IMPLEMENTED |
| F13-05 ponte Rust e feed JS | `task/F13-05-ponte-sse` | da9c10f | IMPLEMENTED |
| F13-06 tela da sala de texto | `task/F13-06-ui-texto` | 16572cd | WAITING_VALIDATION |
| F13-07 markdown, reações, fixadas, busca | `task/F13-07-mensagens-ricas` | a53f7f3 | WAITING_VALIDATION |
| F13-08 menções | `task/F13-08-mencoes` | ver `git log` | WAITING_VALIDATION |
| F13-09 anexos | worktree da sessão `f13-09-anexos` | em andamento | — |
| F13-11 DM na API | worktree da sessão `f13-11-dm-api` | em andamento | — |

Cada branch sai da anterior; nada foi mergeado na `main`. Se a F13-07 ainda não estiver commitada, as mudanças dela estão no working tree da `task/F13-07-mensagens-ricas`.
`.claude/launch.json` tem mudança do usuário que não entra em commit.

## Decisões que valem
- ADR 0024 (`docs/adr/0024-salas-de-texto.md`): SSE, retenção para sempre, anexos, menções, DM, emoji próprio, notificação no app e na aba.
- Quem não é membro recebe 404, não 403 (o código esconde a sala). Plano da fase já corrigido.
- Texto de mensagem nunca em URL nem em log: busca é `POST .../messages/search`.
- Cliente: flags `canEdit`/`canDelete` não vão nos eventos; o cliente calcula (`packages/shared/src/chat.ts`).
- Duas listas de rotas permitidas precisam das rotas novas: `allowed_call` em `apps/desktop/src-tauri/src/session.rs` e `instancePath` em `packages/shared/src/instance.ts`. Esquecer a segunda quebrou a web no teste da F13-06.
- Build web troca `shell/native` por `apps/desktop/src/web/native.ts`: export novo no nativo pede stub lá.
- A API lê `dist-web` na memória ao subir: depois de `vite build --mode web`, reiniciar o servidor de teste.
- No Windows dois arquivos que diferem só em maiúsculas colidem (`markdown.ts` × `Markdown.tsx`): o parser chama `chat-markdown.ts`. O `pnpm typecheck` da raiz não pega isso nem `.at()`; o `pnpm --filter ./apps/desktop build` pega.
- Reações: só emoji Unicode por enquanto; `custom:<id>` já cabe no banco e entra na F13-10. Mudança de reação sai como `message.updated`.
- `curl` do Git Bash manda corpo sem UTF-8: acentos viram "�" no teste, não é defeito do app (usar `--data-binary @arquivo` com bytes UTF-8).

## Arquivos principais
Servidor: `apps/server/drizzle/0011_text_rooms.sql`, `src/db/schema.ts`, `src/rooms/messages.ts`, `src/rooms/events.ts`, `src/rooms/routes.ts`, `test/messages.test.ts`, `test/events.test.ts`.
Rust: `apps/desktop/src-tauri/src/events.rs`, `session.rs`, `lib.rs`, `permissions/desktop.toml`, `capabilities/default.json`.
Cliente: `packages/shared/src/chat.ts`, `meeting.ts`, `instance.ts`; `apps/desktop/src/meeting/TextRoom.tsx`, `chat-events.ts`, `chat-markdown.ts`, `Markdown.tsx`, `MeetingApp.tsx`, `App.css`; Rust `google.rs` (`open_chat_link`).

## Validação feita (Windows 11, 2026-10-27)
`pnpm typecheck`, `pnpm lint`, `pnpm test` (shared 58, media 77, server 96, desktop 32, scripts 27), `cargo test` (28; cargo em `%USERPROFILE%\.cargo\bin`, sem rustfmt), builds desktop e web. Web local com API PGlite servindo `dist-web`: envio, mensagem de outra conta ao vivo, "digitando…", edição, remoção, 375 px; markdown seguro, reação ao vivo, aviso de link, fixadas, busca e pulo. Script de teste ficou no scratchpad da sessão anterior; recriar com `buildApp({ env, db, media, webRoot })` e duas contas.

## Não resolvido
- `.exe` nunca abriu o fluxo nativo; SSE não testado atrás do Traefik/Coolify; logout fecha o fluxo só no keep-alive (até 25 s).
- Migração 0011 não aplicada em implantação real.

## Próximos passos exatos (atualizado 2026-10-27, usuário autorizou implementar tudo e testar no fim)
1. `task/F13-integracao` = F13-07 + F13-08 + F13-11 (fc4db22; menção resolve em DM pelos `dm_members`, sem `@everyone` em DM). A sessão da F13-09 está juntando a `task/F13-09-anexos` nela.
2. Depois, em paralelo a partir da integração: F13-10 (emoji próprio) e F13-12 (DM na UI), cada uma na sua branch; juntar de volta na integração.
3. F13-13 (não lidas e notificação; persistir o contador de menções que hoje é só memória em `MeetingApp.tsx`), depois F13-14 (docs e revisão).
4. Para cada tarefa: rotas novas em `allowed_call` e `instancePath`, stub em `web/native.ts` se mexer no nativo, `PLAN.md`, plano da fase e `HISTORY.md`; commit sem `.claude/launch.json`. Nada na `main`, sem push.
5. No fim: o usuário testa tudo no `.exe` e na web.
