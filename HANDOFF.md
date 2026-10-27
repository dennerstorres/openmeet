# HANDOFF — fase 13, salas de texto, DM e emoji (2026-10-27)

## Estado
F13-01 a F13-13 estão na `main` (16ae998). A F13-14 (docs e revisão da fase) está na `task/F13-14-docs`, sem merge e sem push: o usuário decide. Estado da fase: **WAITING_VALIDATION**. Nada foi testado no `.exe`, atrás do proxy real nem em implantação real.
`.claude/launch.json` tem mudança do usuário que não entra em commit.

## O que a F13-14 fez
- Docs: `docs/DEPLOYMENT.md` (migração 0011, SSE atrás de Traefik/Coolify, limites, armazenamento, retenção), `SECURITY.md` (DM sem E2EE, acesso, bloqueio, XSS, logs, notificações) e `docs/TROUBLESHOOTING.md` (SSE que não conecta).
- Revisão: nenhum achado alto. Dois médios corrigidos com teste (fixar em DM bloqueada; limite de taxa em fixar, mudar DM, bloquear e mudar emoji). Sete baixos anotados no `HISTORY.md`.
- Gates (Windows 11): typecheck, lint, `pnpm test` (27/74/77/115/35), `cargo test` (37) e build desktop passaram.

## Antes de testar
1. Merge da `task/F13-14-docs` na `main` (se aprovado).
2. Implantação: backup (`node infra/compose/pg-copy.mjs backup`), subir a API nova; a migração 0011 roda sozinha.
3. Proxy (Coolify/Traefik): sem middleware `buffering` na API, `text/event-stream` fora do `compress`, timeout ocioso acima de 30 s, corpo de até ~14 MB. Uma réplica só da API.
4. Disco C: estava com 0 bytes livres; foi apagado só `apps/desktop/src-tauri/target/debug/incremental`. A worktree `.claude/worktrees/f13-13-notificacao-c0c4db` (4,6 GB) já foi mergeada e pode ser removida pelo usuário.

## Roteiro do usuário (critério de saída da fase)
Duas contas no mesmo servidor: A no `.exe`, B no navegador, API atrás do proxy real.

Sala de texto:
- [ ] Criar sala do tipo texto; aparece com `#` e a sala de voz continua igual (entrar, falar, sair).
- [ ] A manda mensagem; aparece em B em até 1 s, e vice-versa. "digitando…" aparece no outro.
- [ ] Markdown: negrito, itálico, riscado, código, bloco de código, citação, spoiler, link. `<script>` e `javascript:` aparecem como texto.
- [ ] Responder, editar (só o autor), remover (autor; dono/moderador remove a de outro), reação Unicode e reação com emoji próprio, fixar e ver fixadas, busca e pular para a mensagem.
- [ ] Emoji próprio: dono envia PNG/GIF, usa no texto e na reação; participante não consegue enviar; remover vira `:nome:`.
- [ ] Anexo de imagem (prévia e visualizador) e de arquivo (download; no `.exe` vai para Downloads). HTML renomeado para `.png` vira download, não prévia.
- [ ] Menção `@B`: B recebe notificação do Windows (`.exe` fora de foco) ou contador na aba `(n) OpenMeet` e ponto no favicon (web); abrir a sala zera. `@everyone` de participante não notifica. Nível "Nada" silencia.
- [ ] Rolar para cima carrega histórico; recarregar mantém tudo (retenção).

DM:
- [ ] Abrir DM pelo card do membro; aviso "sem E2EE" visível. Mensagem, resposta, reação, emoji próprio, anexo, edição e remoção ao vivo nos dois lados.
- [ ] DM fora de foco notifica; contador na entrada de DMs.
- [ ] Grupo com 3 pessoas: adicionar, renomear, sair (quem saiu não lê mais).
- [ ] A bloqueia B: DM fica só leitura para os dois (sem enviar, reagir, fixar); B não abre DM nova com A. Desbloquear volta.

SSE e proxy:
- [ ] Deixar parado 5 min: o chat continua chegando sem recarregar (keep-alive de 25 s passa pelo proxy).
- [ ] Derrubar a rede e voltar: o chat reconecta e o que chegou no meio aparece.
- [ ] Reiniciar a API: o cliente recarrega sozinho, nada some.
- [ ] Logout em A: o fluxo fecha em até 25 s.

Se falhar: `docs/TROUBLESHOOTING.md`, seção "Chat não chega ou atrasa (SSE)".

## Não resolvido
- Achados baixos B1 a B7 da revisão (ver `HISTORY.md`, entrada F13-14); B1 (evento `read` repetido sem limite) é o primeiro candidato.
- Anexos e emojis em `bytea` no Postgres; acompanhar o tamanho do banco.

## Próximos passos exatos
1. Usuário revisa a `task/F13-14-docs` e decide o merge.
2. Usuário roda o roteiro acima no `.exe` e na web, atrás do proxy real.
3. Com o roteiro aprovado: F13-02 a F13-14 viram DONE em `PLAN.md` e no plano da fase, com data, plataforma e resultado no `HISTORY.md`. Defeito encontrado vira tarefa nova, uma branch por correção.
