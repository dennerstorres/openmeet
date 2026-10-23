# ADR 0015 — Desconectar da sala e volume de entrada

Data: 2026-10-23. Decisão de implementação para o pedido do usuário; revisão de segurança pendente.

POST /api/v1/rooms/:id/participants/:userId/kick desconecta somente da sala indicada. Não remove membership nem impede um novo ingresso explícito. Exige membro ativo e administrador da instância, dono ou moderador do servidor; não permite remover a si mesmo ou o dono. Moderador só remove participante. Nenhuma visibilidade adicional entre servidores.

A operação trava a sala e o membership do alvo na ordem usada pelo join, revoga o token anterior no SFU e registra auditoria. Mantém as travas até o SFU responder, para não emitir token durante o corte. Erro do SFU retorna 502 e permite repetir. Não altera a rota antiga de remoção do servidor. A validade da revogação exige prova real no LiveKit.

Volume de entrada usa o processor de áudio do LiveKit com GainNode de 0 a 200%, padrão 100%, antes da publicação. O grafo não toca som localmente. O SDK reinicia o processor na troca de dispositivo e o destrói ao parar a track. Preferência dura nesta janela; mute continua independente. Ganho acima de 100% pode distorcer. Validação em dois PCs permanece obrigatória.
