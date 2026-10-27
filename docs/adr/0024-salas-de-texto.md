# ADR 0024 — salas de texto

Data: 2026-10-27. Estado: aceito pelo usuário em 2026-10-27.

## Contexto

O usuário pediu salas de texto no servidor, ao lado das de voz, com as funções de chat do Discord, menções, anexos, mensagem direta, emoji próprio e notificação no app e na aba da web. A SPEC deixa "mensagens persistentes" fora do MVP; este ADR muda o escopo: entra o item 23 em "In scope" e sai "mensagens persistentes" de "Out of scope". O item 17 muda para permitir aviso na aba da web.

Hoje `rooms.kind` (`persistent`/`temporary`) é tempo de vida, não tipo de canal. O desktop fala com a API pela ponte nativa (Rust guarda o token, ADR 0003). Imagens e sons ficam em `bytea` no Postgres (ADR 0019, 0021). `tauri-plugin-notification` já está no app.

## Decisão

### Modelo

- `rooms.channel` (`voice` | `text`, padrão `voice`), migração `0011_text_rooms.sql`. Sala de texto é sempre `persistent`; `POST /rooms/:id/join` responde 409 para ela.
- `dm_channels (id, kind dm|group, name null, created_by)` e `dm_members (dm_id, user_id, joined_at, left_at)`. DM 1:1 é única por par; grupo tem até 10 pessoas.
- `messages`: `id bigserial` (ordem e cursor), `room_id` ou `dm_id` (check: exatamente um), `author_id`, `body` até 4000 caracteres, `reply_to_id`, `pinned_at`, `pinned_by`, `edited_at`, `deleted_at`, `created_at`. Índices `(room_id, id)` e GIN de busca (`to_tsvector('simple', body)`).
- `message_mentions (message_id, user_id)` e flag `mentions_everyone`; `message_reactions (message_id, user_id, emoji)` único.
- `message_attachments`: `id`, `message_id`, `uploader_id`, `name`, `mime`, `size`, `width`, `height`, `bytes bytea`. Mesmo padrão de imagens e sons.
- `server_emojis (id, server_id, name, uploader_id, mime, animated, bytes bytea, deleted_at)`, nome único por servidor. No texto vira `<:nome:id>`.
- `user_blocks (user_id, blocked_id)`.
- `chat_reads (user_id, room_id ou dm_id, last_read_id)`; `notify_prefs (user_id, server_id null, room_id null, dm_id null, level all|mentions|none)`.
- Retenção: para sempre. Remover mensagem apaga `body` e anexos de verdade e deixa "mensagem removida"; remover sala ou servidor (ADR 0023) só esconde.

### Entrega em tempo real — SSE

- `GET /api/v1/events` (`text/event-stream`), um fluxo por cliente com tudo que a pessoa pode ver: salas de texto dos seus servidores e suas DMs. Eventos: `message.created`, `message.updated`, `message.deleted`, `reaction`, `pin`, `typing`, `read`, `mention`, `dm.created`, `emoji.updated`. Cada evento leva `id` sequencial; o cliente reconecta com `Last-Event-ID` e, se o buraco for grande, recarrega pelo `GET .../messages?after=`.
- Distribuição por emissor em memória da API (um nó, como a presença no ADR 0017). Múltiplos nós pediriam Postgres `LISTEN/NOTIFY` ou Redis; fica fora.
- Web: `EventSource` na mesma origem, cookie `HttpOnly` (ADR 0014), sem mexer na CSP.
- Desktop: comando Rust `instance_events_open/close` abre o fluxo com o token e repassa cada evento por evento Tauri. O token não vai para o JavaScript.
- Keep-alive a cada 25 s. A cada keep-alive a API confere a sessão de cada fluxo: logout, sessão revogada ou expirada e conta desativada fecham o fluxo em até 25 s. O público de cada evento é calculado na hora, então quem saiu do servidor deixa de receber no evento seguinte.
- Até 5 fluxos por conta; o sexto recebe 429. "Digitando…" é sinal sem número, não entra na reposição.

### Funções da v1

Markdown do Discord (negrito, itálico, riscado, sublinhado, código, bloco de código, citação, spoiler, link), responder, editar (autor), remover (autor, dono, moderador), reações com emoji Unicode e seletor, fixar (dono e moderador), menção `@pessoa` do servidor com autocompletar, `@everyone` e `@here` só para dono e moderador, "digitando…", não lidas e contador de menções na lista de salas e no ícone do servidor, pular para mensagem, busca na sala, colar/arrastar arquivo, prévia de imagem com visualizador.

### Mensagem direta

- Abre DM com quem divide pelo menos um servidor com você. Grupo: até 10 pessoas, criado por quem convida; qualquer membro sai, o criador adiciona e renomeia.
- Mesmas funções das salas de texto (markdown, resposta, reação, anexo, emoji próprio, busca), sem fixar por moderador: na DM qualquer membro fixa.
- Bloquear: quem foi bloqueado não abre DM nem manda mensagem para você; DM existente fica só leitura. Remover mensagem na DM é só do autor.
- Lista de DMs numa entrada própria acima dos servidores, como no Discord.

### Emoji próprio

- Por servidor, até 50 estáticos e 50 animados. Dono e moderador enviam, renomeiam e removem.
- PNG, GIF ou WebP conferidos pelos bytes, até 256 KB, redimensionados para 128×128 no cliente antes do envio.
- Usável nas mensagens e reações das salas daquele servidor e em DMs de quem é membro do servidor. Na imagem, quem pode ver a mensagem pode carregar o emoji. Emoji removido vira `:nome:` em texto.

### Anexos

Até 10 arquivos por mensagem, 10 MB cada (ajustável por `ATTACHMENT_MAX_BYTES`). Upload antes do envio, anexado ao enviar; órfão some em 24 h. Imagem (PNG, JPEG, GIF, WebP) conferida por assinatura dos bytes, com prévia; o resto é baixado com `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff` e nunca abre inline. SVG e HTML sempre como download. Desktop busca pelo comando Rust, como `instance_image`.

### Notificação

- Desktop: notificação do Windows pelo plugin já instalado quando a mensagem é menção, `@everyone` ou de sala em nível `all`, e a janela não está em foco na mesma sala. Clique abre a sala. Contador no ícone da bandeja.
- Web: contador no título (`(3) OpenMeet`) e ponto no favicon. Notificação do navegador (`Notification`) só se a pessoa ativar em Configurações. Som curto opcional nos dois.
- Nível por servidor e por sala: todas, só menções, nada. Padrão: só menções.

### Segurança

- Permissão: membro ativo do servidor lê e escreve; mesma regra de `loadRoomAccess`. DM: só `dm_members` sem `left_at`. Menção só resolve membros do servidor ou da DM.
- Dono e moderador não leem DMs; nem o admin da instância pela interface.
- Markdown vira árvore React, nunca HTML. Link só clicável se `https:`/`http:` e abre no navegador do sistema com aviso do domínio.
- Limite de taxa: 10 mensagens / 10 s, 20 MB de upload por minuto por usuário, 5 fluxos SSE por usuário.
- Corpo de mensagem e nome de anexo nunca vão para log.

## Fora desta decisão

Threads e fórum, prévia de link (a API buscaria URLs de fora: risco de SSRF), figurinhas, GIF por serviço externo (API paga/SaaS), mensagem de voz, enquete, cargos personalizados e chat dentro da sala de voz. Cada um pede ADR próprio.

## Consequências

- Mensagens e anexos passam a ser dado pessoal guardado para sempre: `docs/DEPLOYMENT.md` (backup, tamanho do banco) e `SECURITY.md` precisam citar `room_messages` e `message_attachments`.
- Anexos em `bytea` deixam o banco grande; se passar de alguns GB, mover para disco é outra decisão.
- DMs não são cifradas de ponta a ponta (E2EE segue fora); o operador da instância consegue lê-las no banco. A interface precisa dizer isso.
- Uma conexão SSE aberta por cliente; o proxy (Traefik/Coolify) precisa não bufferizar `text/event-stream`.
