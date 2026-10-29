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

## Próximos passos
1. **F14-05** (READY), envio de push no servidor:
   - Lib `web-push` (verificar a versão e fixar no lockfile), ou implementar VAPID/aes128gcm à mão.
   - Achar o ponto onde a F13-13 decide notificar (menção/DM/resposta, respeitando `notify_prefs` e bloqueios); ver `apps/server/src/rooms/unread.ts`, `messages.ts` e `events.ts`.
   - Enviar para as inscrições do destinatário com payload mínimo (tipo, autor, sala, trecho curto e id da conversa).
   - Apagar a inscrição em 404/410 e atualizar `last_used_at`.
   - Testar com um sender injetável (sem rede).
2. **F14-06**: no cliente web, opção "Ativar notificações" (permissão só por clique) usando `/api/v1/push/key`. `pushManager.subscribe` → POST; logout → DELETE antes de sair. No `sw.js`: handlers `push` (pula se houver cliente com foco) e `notificationclick` (abre ou foca na conversa).
3. **F14-07** (humano): instalar no Chrome; testar atualização com chamada aberta e push em Chrome, Firefox e Android.
4. Revisão independente de F14-02 a F14-04 e `git push` da main, quando o usuário autorizar.
