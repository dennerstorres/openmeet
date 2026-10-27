# Fase 13 — salas de texto, DM e emoji próprio (ADR 0024)

Pedida pelo usuário em 2026-10-27, decisões revisadas no mesmo dia: SSE, retenção para sempre, anexos, menções, DM, emoji próprio e notificação já na v1. ADR 0024 aceito e SPEC atualizada em 2026-10-27.

## Tarefas

| ID | Tarefa | Dep. | Estado | Gates |
| --- | --- | --- | --- | --- |
| F13-01 | Aceite do ADR 0024; SPEC (item 23, out of scope, item 17) | — | DONE | — |
| F13-02 | Migração 0011 e schema: `channel`, mensagens, DMs, menções, reações, anexos, emojis, bloqueios, leituras, preferências | F13-01 | IMPLEMENTED | G10 |
| F13-03 | API de mensagens das salas: listar com cursor, enviar, responder, editar, remover, fixar, busca, limite de taxa | F13-02 | IMPLEMENTED | G4,G10 |
| F13-04 | API SSE: emissor em memória, `/events` por usuário, `Last-Event-ID`, keep-alive, fecha no logout/saída | F13-03 | IMPLEMENTED | G4,G10 |
| F13-05 | Ponte Rust do SSE: `instance_events_open/close` repassando eventos Tauri | F13-04 | IMPLEMENTED | G4,G10 |
| F13-06 | UI base: tipo ao criar sala, `#` na lista, painel de mensagens, envio, histórico ao rolar, SSE na web e no desktop | F13-04,F13-05 | WAITING_VALIDATION | G4 |
| F13-07 | Markdown seguro, responder, editar, remover, reações, fixar, "digitando…", pular para mensagem, busca | F13-06 | WAITING_VALIDATION | G4,G10 |
| F13-08 | Menções: autocompletar `@`, `@everyone`/`@here` com permissão, destaque, contador | F13-06 | WAITING_VALIDATION | G4,G10 |
| F13-09 | Anexos: upload, validação por bytes, prévia de imagem, download seguro, limpeza de órfãos, comando Rust | F13-06 | WAITING_VALIDATION | G4,G10 |
| F13-10 | Emoji próprio: API de envio/renomear/remover, limites, seletor com abas por servidor, uso em mensagem e reação | F13-07 | WAITING_VALIDATION | G4,G10 |
| F13-11 | DM na API: abrir 1:1, grupo até 10, adicionar/sair/renomear, bloqueio, mensagens reaproveitando F13-03 | F13-03 | IMPLEMENTED | G4,G10 |
| F13-12 | DM na UI: entrada acima dos servidores, lista de conversas, abrir DM pelo membro, grupo, bloquear, aviso "sem E2EE" | F13-06,F13-11 | WAITING_VALIDATION | G4 |
| F13-13 | Não lidas e notificação: leituras, níveis, Windows + bandeja, título/favicon e `Notification` opcional na web | F13-08,F13-12 | WAITING_VALIDATION | G4,G12 |
| F13-14 | Docs (DEPLOYMENT, SECURITY, TROUBLESHOOTING, proxy SSE) e revisão independente | F13-09,F13-10,F13-13 | WAITING_VALIDATION | G10,G12 |

Uma branch por tarefa (`task/F13-XX-...`). Depois da F13-06, as F13-07, F13-08, F13-09 e F13-11 podem correr em paralelo, em sessões separadas.

## Testes por tarefa

- **F13-02:** migração sobe no PGlite; salas existentes ficam `voice`; check `room_id` xor `dm_id`.
- **F13-03:** não membro 404, membro removido 404 (o código esconde a sala de quem não é membro), sala/servidor removido 404, só o autor edita, moderador remove de outro, corpo vazio/acima de 4000 recusado, 429 no limite, cursor sem buraco nem duplicata, `join` em sala de texto 409, corpo fora dos logs.
- **F13-04:** evento chega só a quem pode ver (membro do servidor ou da DM), `Last-Event-ID` repõe o que faltou, fluxo fecha no logout e na remoção do membro, limite de 5 fluxos.
- **F13-05:** `cargo test` do parser SSE; token nunca sai do Rust.
- **F13-07:** markdown com `<script>`, `javascript:` e `onerror` aparece literal; spoiler e bloco de código corretos.
- **F13-08:** `@everyone` de participante não notifica; menção a quem não é membro não resolve.
- **F13-09:** PNG falso (HTML com extensão .png) vira download; SVG nunca inline; acima de 10 MB 413; órfão some.
- **F13-10:** participante não envia emoji 403; acima de 256 KB ou do limite de 50 recusado; nome repetido 409; emoji de outro servidor não resolve na sala; removido vira `:nome:`.
- **F13-11:** DM só com quem divide servidor; segunda DM 1:1 com o mesmo par devolve a existente; grupo acima de 10 recusado; bloqueado não manda 403; quem saiu não lê; dono/moderador/admin não leem DM alheia.
- **F13-12:** abrir DM pelo card do membro; bloqueio deixa só leitura.
- **F13-13:** menção e DM notificam fora de foco, não notificam na conversa aberta, nível `none` silencia; contador do título zera ao ler.
- **F13-14:** DM bloqueada não deixa fixar; fixar, mudar DM, bloquear e mudar emoji têm limite de 20 por 10 s por conta.

## Critério de saída

Duas contas, um `.exe` e um navegador: numa sala de texto e numa DM, a mensagem aparece no outro em até 1 s, com markdown, resposta, reação com emoji próprio, edição, remoção, anexo de imagem e de arquivo, menção que gera notificação do Windows e contador na aba; bloqueio impede nova mensagem. Sala de voz continua igual. Typecheck, lint, testes TS e Rust passam; SSE testado atrás do proxy real. Sem validação manual, fica `WAITING_VALIDATION`.
