# ADR 0031 — chat na sala de voz

Data: 2026-11-04. Estado: aceito pelo usuário em 2026-11-04.

## Contexto

Quem vem do Discord espera um balão de chat no canto superior direito da chamada e também ao lado do nome do canal de voz na lista. Clicando ali, abre o chat do próprio canal ao lado dos cards (ver `docs/UX_DISCORD_PARIDADE.md`, item 6). O ADR 0024 deixou "chat dentro da sala de voz" fora do escopo e pediu um ADR próprio.

Já existe tudo o que uma sala de texto precisa: `messages.room_id`, SSE (`message.*`), anexos, menções, reações, leituras e preferências de notificação. O que falta é permitir que uma sala `voice` também tenha mensagens.

## Decisão

- Toda sala `channel = voice` passa a aceitar mensagens com o mesmo modelo, as mesmas rotas e os mesmos eventos das salas de texto. Não há tabela nova nem tipo de canal novo.
- **Quem pode ler e escrever:** quem é membro do servidor, igual a uma sala de texto. Não é preciso estar na chamada, como no Discord.
- **Sala temporária:** o histórico apaga de verdade quando a sala expira (corpo e anexos), junto com a sala. Sala persistente segue a retenção do ADR 0024.
- **Servidor:** o filtro `channel = 'text'` sai das rotas de mensagem e do SSE, trocado por "sala ativa do servidor". `POST /rooms/:id/join` continua 409 só para salas de texto.
- **Notificação:** padrão `mentions` para o chat de voz (menos barulho que o `all` das DMs). A pessoa pode mudar pelo canal.
- **Cliente:**
  - ícone de balão ao lado do canal de voz na lista, visível no hover e quando há mensagem não lida;
  - na chamada, balão no canto superior direito do `call-strip` que abre ou fecha um painel lateral com `TextRoom`; os cards encolhem e não ficam cobertos;
  - "prévia de novas mensagens" (um toast sobre os cards) fica para depois.
- **Migração:** nenhuma de schema. Só muda o código das rotas e o teste de permissão.

## Consequências

- O mesmo `TextRoom` serve aos dois tipos de canal, então correções no chat valem para os dois.
- Na sala temporária, o histórico some quando ela expira. A pessoa precisa saber disso por um aviso no topo do chat.
- O SSE passa a emitir para mais salas. A carga por cliente sobe um pouco, mas o fluxo continua sendo um só.

## Fora

- Chat só para quem está na chamada.
- Fio separado por chamada (cada sessão com o próprio histórico).
- Prévia flutuante de mensagens sobre os cards.

## Testes exigidos

- Permissão: alguém de fora do servidor recebe 403 ao ler ou escrever no chat da sala de voz; um membro fora da chamada consegue ler e escrever.
- Ao expirar a sala temporária, as mensagens e os anexos dela somem do banco.
- O SSE entrega `message.created` da sala de voz só para os membros.
- Manual: abrir e fechar o painel na chamada, com os cards ajustando o espaço e o não lido aparecendo no ícone da lista.
