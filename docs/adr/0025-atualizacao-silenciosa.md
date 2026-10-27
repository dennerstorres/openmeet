# ADR 0025 — atualização baixada sem perguntar

Data: 2026-10-27. Estado: proposto, pedido pelo usuário em 2026-10-27 (F07-10). Substitui o item "Comportamento" do ADR 0018; o resto dele continua valendo.

## Contexto

Hoje o aviso pergunta se a pessoa quer instalar, e só então o app baixa o pacote e reinicia. O usuário pediu que o download aconteça sozinho e que o aviso só diga que falta reiniciar.

## Decisão

O app checa ao abrir e a cada 6 horas, como antes. Achando versão nova, o Rust baixa o pacote em segundo plano, sem perguntar. A assinatura é conferida no download, pelo próprio plugin, antes de o pacote ser guardado.

O pacote baixado fica só na memória do processo Rust, junto da versão que a checagem achou. A webview não recebe os bytes nem escolhe versão; os dois comandos continuam sendo "há atualização?" e "instalar agora".

Durante uma chamada o app não baixa nem instala, para não disputar banda com o áudio e o vídeo. Uma checagem recusada ou com falha tenta de novo em 10 minutos.

Com o pacote pronto, o aviso diz "Versão X pronta" e oferece "Reiniciar agora" ou "Depois". Reiniciar roda o NSIS em modo `passive` com o pacote já baixado, e o app reabre. "Depois" esconde o aviso até a próxima checagem; fechar o app sem reiniciar descarta o pacote, que é baixado de novo na próxima abertura.

## Riscos e limites

O pacote, do tamanho do instalador, ocupa memória até o reinício. Quem nunca reinicia baixa o pacote de novo a cada abertura.

A instalação ainda depende de um clique: no Windows o NSIS fecha o app, e fechar sozinho derrubaria o que a pessoa estiver fazendo.

## Prova exigida

Instalar a versão N, publicar N+1 numa release de teste e confirmar: o aviso aparece já como "pronta", sem pedir download; reiniciar atualiza e reabre; durante a chamada nada é baixado e o aviso aparece minutos depois de sair; pacote com assinatura trocada é recusado e não gera aviso.
