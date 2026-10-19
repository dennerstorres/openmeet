# Fase 09 — servidores e sala

Objetivo: implementar os ADR 0007 a 0013. Nenhum deles está no código. Não marcar `DONE` nem PASS sem a prova pedida.

## Execução
Consultar as tarefas `F09-*` em `PLAN.md`. O desenho de cada uma está no ADR citado. A evidência de dois PCs e o GO de F02-06 não bloqueiam esta fase.

## Critério de saída
G9. Link, anel de fala e áudio do PC em build instalado ficam `WAITING_VALIDATION` até um humano provar.

## F09-01
ADR 0007. Migration nova. Servidor, membros e sala com `server_id`. A migração cria `Geral`, move as salas e revoga os convites de sala. O token LiveKit usa o id da sala. O administrador cria o servidor e vira dono. Quem não é membro não vê. A fase não fecha aqui.

## F09-02
ADR 0012. Depende de F09-01. O convite copiado é `openmeet://`, preso ao host da API. A página HTTPS não mostra sessão e o log não grava o código. Colar o código continua válido. Aceitar entra no servidor e não entra sozinho numa sala.

## F09-03
ADR 0009. Depende de F09-01. Barra de servidores, sidebar de salas e área de cards. Card de pessoa com ou sem câmera. Card próprio por compartilhamento. Destaque, grade, fixar e tela cheia. Dá para ver outro servidor sem sair da chamada.

## F09-04
ADR 0011. Depende de F09-03. A API lê o LiveKit e a sidebar mostra os nomes. A ocupação não vai para o Postgres. Falha na consulta esconde os nomes e mantém as salas. O anel verde usa o alto-falante ativo da sala atual.

## F09-05
ADR 0013. Ensurdecer corta o áudio remoto neste PC, inclusive o de compartilhamento quando existir. O microfone não muda. O volume de cada card volta ao soltar. Sair da sala zera. Não avisa o servidor.

## F09-06
ADR 0008. A marca "Incluir áudio do PC" nasce desligada. Sem a marca, o pedido continua `audio: false`. Sem faixa de áudio, a imagem continua e a tela avisa. Captura nativa do Windows não entra. Ouvir o som nos dois PCs é prova humana.

## F09-07
ADR 0010. `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` só no ambiente do servidor. Sem as duas, o botão não aparece. O navegador é o do sistema. A página de volta não mostra token. O primeiro administrador continua no token de instalação. Conta Google nova não vira admin e não entra sozinha num servidor.

## Observação
Não concluir fase por implementação superficial ou mocks. Dependências externas e validações reais precisam de evidência ou status WAITING_VALIDATION.
