# ADR 0023 — remover salas e servidores

Data: 2026-10-27. Estado: proposto; implementado a pedido do usuário em 2026-10-27, aguarda aceite.

## Contexto

O usuário pediu a opção de remover salas e servidores. Até aqui só existia encerrar sala (`PATCH /rooms/:id`), que deixa a sala na lista com o selo "encerrada" e prende o identificador.

## Decisão

Remoção lógica: `deleted_at` em `servers` e `rooms` (migração `0010_soft_delete.sql`). A linha fica, então eventos de auditoria, convites e vínculos continuam apontando para algo que existe. Nada é apagado de verdade.

- Sala: dono ou moderador remove (`POST /api/v1/rooms/:id/delete`). A sala é encerrada, some das listas, os convites dela são revogados e a chamada é fechada no SFU. O identificador fica livre para uma sala nova no mesmo servidor (índice único parcial `where deleted_at is null`).
- Servidor: só o dono remove (`POST /api/v1/servers/:id/delete`). Todas as salas são removidas e encerradas, os convites do servidor e das salas são revogados e o servidor some para todos os membros.
- Rota em `POST .../delete`, como os sons (ADR 0021), porque o cliente desktop só envia GET e POST.
- S-04 vale igual a encerrar: a marca é gravada antes de chamar o SFU e fica. Se o SFU falhar, a resposta é 502 e repetir o pedido só fecha a mídia que ficou aberta.
- O desktop pede confirmação antes de remover. Não há restauração pela interface; voltar uma sala ou servidor é `deleted_at = null` direto no banco.

## Consequências

- Imagens, sons e linhas de membros de um servidor removido continuam no banco. Uma limpeza física fica para outra tarefa, se for pedida.
- Toda consulta nova de sala ou servidor precisa filtrar `deleted_at is null`; `loadServerAccess` e `loadRoomAccess` já filtram.
