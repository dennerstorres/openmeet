# ADR 0019 — imagem do servidor, avatar e perfil por servidor

Data: 2026-10-25. Estado: aceito pelo usuário em 2026-10-25, implementação na F09-10.

## Contexto

O servidor aparece só pelas iniciais e a pessoa só pelo nome. O pedido é ter ícone do servidor, avatar da conta e, em cada servidor, um apelido e um avatar próprios. Sem perfil no servidor, vale o global.

O `.exe` não tem token na página: as chamadas autenticadas passam pelo Rust numa lista fechada de rotas JSON (ADR 0006, F10-18). A web autentica por cookie só com `Origin` e `X-OpenMeet-Web: 1` (ADR 0014), então um `<img src>` direto não autentica. As duas CSPs já têm `img-src 'self' blob: data:`.

## Decisão

### Onde a imagem fica

No Postgres, numa tabela `images` (`bytea`). Cada imagem tem id UUID, tipo, tamanho, largura, altura, SHA-256, autor e data. `users.avatar_image_id`, `servers.icon_image_id` e `server_members.avatar_image_id` apontam para ela; `server_members.nickname` guarda o apelido.

Motivo: a implantação é de um nó, o backup cifrado (F10-11) já cobre o banco e não surge volume novo para montar, migrar e restaurar. Com o teto abaixo, mil imagens ocupam no máximo 256 MB.

Trocar ou remover a imagem apaga a anterior na mesma transação. Sair ou ser removido do servidor apaga o apelido e o avatar daquele servidor.

### Tipo, tamanho e validação

O cliente corta em quadrado e reduz para 256×256 num `canvas`, exportando WebP (PNG quando o navegador não exporta WebP). Isso também tira EXIF e GPS da foto original.

A API não confia nisso. Aceita só PNG, JPEG e WebP pelos magic bytes, lê largura e altura do cabeçalho e recusa: outro tipo (SVG, GIF, HTML incluídos), mais de 256 KB, lado acima de 512 px, cabeçalho inconsistente ou arquivo truncado. O tipo gravado é o detectado, nunca o declarado. Sem re-encode no servidor: evita dependência nativa (sharp/libvips) na API.

O envio é JSON: `{ "image": "<base64>" }`, ou `null` para remover. Cabe no limite de corpo atual e passa pela ponte Rust sem mudar o transporte. Envio tem limite de 10 por minuto por conta.

### Como o cliente busca

Uma rota só: `GET /api/v1/images/:id`. Responde os bytes com o tipo detectado, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox` e `Cache-Control: private, max-age=31536000, immutable`. O id muda a cada troca, então o cache nunca serve imagem velha.

Quem pode ler: o dono da imagem, e quem divide um servidor ativo com a conta ou o servidor a que ela pertence. Fora disso, 404, sem dizer se existe.

No `.exe`, um comando Rust novo `instance_image(origin, id)` aceita só esse caminho com id UUID, usa o token guardado, confere que a resposta é PNG, JPEG ou WebP até 256 KB e devolve os bytes. A página monta um `blob:`. Na web, `fetch` com o cabeçalho web e o mesmo `blob:`. A CSP não muda nos dois.

### Quem altera o quê

| Rota | Quem |
|---|---|
| `POST /api/v1/profile/avatar` | a própria conta, avatar global |
| `POST /api/v1/servers/:id/icon` | só o dono do servidor |
| `POST /api/v1/servers/:id/profile` `{ nickname?, avatar? }` | cada membro ativo, só o próprio |

Moderador não troca o ícone. Ninguém altera apelido ou avatar de outro membro; não há rota para isso. O apelido passa pela mesma validação de nome da F10-01 (sem controle nem bidi) e tem o mesmo limite do nome de exibição. Troca do ícone vai para a auditoria, sem os bytes.

As três rotas e `instance_image` entram na lista fechada do Rust com teste de rota aceita e recusada.

### Onde aparece

A API resolve o perfil efetivo: apelido do servidor ou nome global; avatar do servidor ou avatar global ou nenhum (fica a inicial).

- Lista de membros e presença do servidor (ADR 0017): nome e avatar efetivos.
- Ocupação das salas (ADR 0011): nome efetivo do servidor dono da sala.
- LiveKit: o token da sala leva o nome efetivo em `name`; avatar não vai para o LiveKit. O card busca o avatar pela lista de membros, pela identidade do participante. Mudar o apelido durante a chamada aparece no card na próxima atualização da lista; o nome dentro do LiveKit só muda ao reentrar.
- Barra de servidores: ícone, ou iniciais quando não houver.

## Fora deste desenho

GIF ou imagem animada, banner, recorte manual, moderador alterando perfil de outro membro, imagem de sala e CDN externa.

## Riscos

A imagem vem de outro usuário e é decodificada pelo WebView2 e pelo navegador. A defesa é tipo fechado, magic bytes, teto de tamanho, `nosniff` e nunca SVG. Um decodificador com falha continuaria sendo risco do navegador, como em qualquer site.

Apelido permite se passar por outro membro dentro do servidor. O card e a lista mostram o nome global ao passar o mouse.

## Prova exigida

Testes da API: tipo falso recusado (SVG renomeado, HTML com cabeçalho PNG truncado), teto de tamanho e de lado, participante e moderador recebendo 403 no ícone, membro sem poder alterar outro, não membro recebendo 404 na imagem, saída do servidor apagando o perfil. Prova humana: ver ícone e avatar no `.exe` e na web contra a instância real.
