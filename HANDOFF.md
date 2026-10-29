# HANDOFF — F14 (PWA e push no cliente web)

Data: 2026-10-29. Branch: `main` local (ee6d2a3), **sem push para o remoto**.

## Feito
- ADR 0027 aceita (`docs/adr/0027-pwa-e-push.md`), SPEC item 24 e fase F14 no `PLAN.md`.
- **F14-02** (WAITING_VALIDATION): plugin `openmeet-web-manifest` em `apps/desktop/vite.config.ts`, só no modo `web`. Emite o manifest, os ícones `apps/desktop/pwa/icon-*.png` e o `sw.js`. A CSP web ganhou `manifest-src`/`worker-src 'self'`.
- **F14-03** (WAITING_VALIDATION): `apps/desktop/pwa/sw.js`, com o id do build injetado no lugar de `__OPENMEET_BUILD__`. O HTML vem sempre da rede (offline mostra "Sem conexão"); só `/assets/*` com hash vai para o cache, um cache por build, e os antigos são apagados no activate. O SW novo espera em `waiting` até o clique em "Recarregar" (`src/web/WebUpdateNotice.tsx`, canto superior direito). Durante chamada o aviso fica oculto (`setInCall` em `MeetingApp`). O registro está em `src/main.tsx` e só roda com `__WEB__ && PROD`.
- **F14-04** (IMPLEMENTED): migração `0013_push_subscriptions.sql`; `apps/server/src/rooms/push.ts`; rotas em `rooms/routes.ts`:
  - `GET /api/v1/push/key` devolve a chave pública VAPID, ou 404 `push_unconfigured`.
  - `POST /api/v1/push/subscriptions` com `{endpoint, keys:{p256dh,auth}}` → 204.
  - `DELETE /api/v1/push/subscriptions` com `{endpoint}` → 204, e só apaga a inscrição do próprio usuário.
  - Endpoints aceitos só de FCM/Mozilla/WNS/Apple (anti-SSRF), até 20 por conta, 10 escritas/min.
  - `VAPID_*` estão no compose e no `docs/DEPLOYMENT.md`.

## Validação feita (Windows 11, 2026-10-29)
- Servidor 122/122; desktop 42/43; `pnpm typecheck` e `pnpm lint` ok.
- Navegador interno com o `dist-web` servido pela API: SW ativo, cache dos assets funcionando. Num deploy simulado o aviso apareceu, o clique recarregou e o cache antigo foi apagado.
- A falha 1/43 (`test/web.test.mjs`, texto "atalhos globais" no bundle web) **já existia na main**, antes da F14. Não foi tratada.

## Decisões
- Sem `vite-plugin-pwa`/Workbox: SW próprio, sem precache de HTML.
- Push só para menção, DM e resposta (ADR 0024). Não enviar se a pessoa tem aba com foco (o SW confere).
- O mesmo navegador entrando em outra conta move a inscrição para a conta nova.

## F14-05 (IMPLEMENTED, 2026-10-29)
- `web-push` 3.6.7; `pushMessage` em `apps/server/src/rooms/push.ts`, disparado após responder em `POST /rooms/:id/messages` e `POST /dms/:id/messages`.
- Regra: sala só menção/resposta; DM qualquer mensagem em "all"; respeita "none" e bloqueio. 404/410 apaga, 2xx marca `last_used_at`.
- Payload JSON: `{type, authorName, chat:{kind,id}, serverId, roomName, excerpt, messageId}` — é o contrato do `sw.js` na F14-06.
- Servidor 125/125, typecheck e lint ok.

## F14-06 (WAITING_VALIDATION, 2026-10-29)
- Push ligado à caixa "Mostrar notificações do navegador"; `webPush.sync/stop` em `apps/desktop/src/web/native.ts`, stub no `shell/native.ts`.
- `sw.js` com `push` e `notificationclick`; aba nova abre em `/?chat=kind:id`.
- Servidor ganhou `POST /api/v1/push/unsubscribe`. Testes ok; push real não testado.

## Próximos passos
1. **F14-07** (humano): gerar VAPID no `.env`, instalar no Chrome, ligar notificações, mandar menção/DM de outra conta com a aba em segundo plano e clicar na notificação. Repetir no Firefox e no Android. Testar atualização com chamada aberta.
2. Revisão independente de F14-02 a F14-06 e `git push` da main, quando o usuário autorizar.
