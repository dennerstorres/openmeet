# Segurança

## Como reportar

Use **Report a vulnerability** na aba *Security* do repositório (<https://github.com/dennerstorres/openmeet/security/advisories/new>). O relato fica privado entre você e os mantenedores. **Não abra issue pública** com vulnerabilidade explorável, token, senha ou dado de alguém.

Informe a versão (app e servidor), os passos para reproduzir e o impacto. A resposta inicial sai em até 7 dias. A correção e a divulgação são combinadas no próprio advisory.

## Escopo

Entram: a API (`apps/server`), o app desktop e o cliente web (`apps/desktop`), o pacote compartilhado e a stack de `infra/compose`. Não entram: instâncias de terceiros e o próprio LiveKit, PostgreSQL ou Caddy (reporte direto ao projeto de cada um). Teste só em instância sua ou autorizada.

## Regras do projeto

Mídia, tokens, senhas, cabeçalhos de autenticação e texto de mensagem não vão para log. Segredos de instância ficam no `.env`, fora do Git. O instalador não tem assinatura de código do Windows, mas as atualizações são assinadas (ADR 0018).

## Salas de texto e DM (ADR 0024)

- **DM sem E2EE.** Mensagens de sala e de DM ficam em claro no Postgres (`messages`, `message_attachments`). O operador da instância, e quem tiver o backup com a `BACKUP_KEY`, consegue ler. A interface avisa isso na DM. Dono, moderador e administrador não leem DM alheia pela API: quem não é membro ativo recebe 404.
- **Dado pessoal guardado para sempre.** Não há expurgo. Remover a mensagem apaga texto e anexos; remover sala ou servidor só esconde. Pedido de apagamento é feito pelo operador, no banco e no backup.
- **Acesso.** Sala de texto de servidor do qual a pessoa não é membro, DM de que não participa ou da qual saiu, e mensagens e anexos dessas conversas respondem 404, igual a id inexistente. O fluxo SSE calcula o público de cada evento na hora; quem saiu do servidor ou da DM para de receber no evento seguinte.
- **Bloqueio.** Quem foi bloqueado não abre DM 1:1 nem grupo com quem bloqueou. A DM 1:1 existente fica só leitura para os dois: sem mensagem, edição, reação, fixação nem "digitando". O bloqueio não vale dentro de grupo criado por terceiro.
- **Markdown e anexos.** O markdown vira árvore React, nunca HTML; link só `http`/`https` sem credencial. O tipo do anexo vem dos bytes e só PNG, JPEG, GIF e WebP têm prévia. Todo download sai com `Content-Disposition: attachment`, `nosniff` e CSP `sandbox`; SVG e HTML nunca abrem inline. No `.exe` o arquivo vai para Downloads com `Zone.Identifier`.
- **Logs e URLs.** Texto de mensagem, busca e nome de anexo vão só no corpo de POST, nunca na URL nem no log. Na URL vão só ids e o cursor numérico.
- **Notificações.** A notificação do Windows e a `Notification` da web mostram quem escreveu e o começo da mensagem, inclusive na tela bloqueada, conforme a configuração do sistema. O nível `none` por servidor, sala ou DM silencia.
- **Limites de taxa** estão em `docs/DEPLOYMENT.md`. São por conta e em memória: reiniciar a API zera.

## Push na web (ADR 0027)

- O aviso vai pelo serviço de push do navegador (Google, Mozilla, Microsoft ou Apple). O conteúdo é criptografado de ponta a ponta até o navegador (RFC 8291): o serviço vê só o tamanho, a hora e o endereço da inscrição. O aviso leva o nome de quem escreveu, o nome da sala e até 120 caracteres da mensagem.
- O servidor só envia para hosts desses serviços, em HTTPS e sem porta (anti-SSRF). Cada pessoa apaga só a própria inscrição. Sair da conta apaga a inscrição deste navegador.
- A chave privada VAPID fica no `.env` e nunca vai para log nem para o cliente.

