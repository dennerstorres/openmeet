# Segurança

Projeto em planejamento. Não há canal formal de reporte ainda. **Não publique vulnerabilidades exploráveis ou credenciais em issues públicas**. Antes do release, configurar GitHub private vulnerability reporting e contato de segurança. Não registrar mídia, tokens, senhas ou headers de autenticação em logs. Testes de segurança devem mirar apenas ambientes autorizados.

## Salas de texto e DM (ADR 0024)

- **DM sem E2EE.** Mensagens de sala e de DM ficam em claro no Postgres (`messages`, `message_attachments`). O operador da instância, e quem tiver o backup com a `BACKUP_KEY`, consegue ler. A interface avisa isso na DM. Dono, moderador e administrador não leem DM alheia pela API: quem não é membro ativo recebe 404.
- **Dado pessoal guardado para sempre.** Não há expurgo. Remover a mensagem apaga texto e anexos; remover sala ou servidor só esconde. Pedido de apagamento é feito pelo operador, no banco e no backup.
- **Acesso.** Sala de texto de servidor do qual a pessoa não é membro, DM de que não participa ou da qual saiu, e mensagens e anexos dessas conversas respondem 404, igual a id inexistente. O fluxo SSE calcula o público de cada evento na hora; quem saiu do servidor ou da DM para de receber no evento seguinte.
- **Bloqueio.** Quem foi bloqueado não abre DM 1:1 nem grupo com quem bloqueou. A DM 1:1 existente fica só leitura para os dois: sem mensagem, edição, reação, fixação nem "digitando". O bloqueio não vale dentro de grupo criado por terceiro.
- **Markdown e anexos.** O markdown vira árvore React, nunca HTML; link só `http`/`https` sem credencial. O tipo do anexo vem dos bytes e só PNG, JPEG, GIF e WebP têm prévia. Todo download sai com `Content-Disposition: attachment`, `nosniff` e CSP `sandbox`; SVG e HTML nunca abrem inline. No `.exe` o arquivo vai para Downloads com `Zone.Identifier`.
- **Logs e URLs.** Texto de mensagem, busca e nome de anexo vão só no corpo de POST, nunca na URL nem no log. Na URL vão só ids e o cursor numérico.
- **Notificações.** A notificação do Windows e a `Notification` da web mostram quem escreveu e o começo da mensagem, inclusive na tela bloqueada, conforme a configuração do sistema. O nível `none` por servidor, sala ou DM silencia.
- **Limites de taxa** estão em `docs/DEPLOYMENT.md`. São por conta e em memória: reiniciar a API zera.
