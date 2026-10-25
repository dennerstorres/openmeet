# ADR 0008 — Áudio do PC no compartilhamento
Status: Accepted. Data: 2026-10-19. Aceito para a F09. O compartilhamento ainda pede só a imagem.

## Contexto
Quem compartilha a tela quer que os outros ouçam o som do PC, como em outros apps de chamada. Hoje o compartilhamento pede só a imagem. O código passa `audio: false`. Monitor e janela já apareceram nos dois PCs. O áudio do PC não foi provado.

O ADR 0004 continua aberto para a captura nativa. Este desenho não autoriza uma captura própria do Windows.

## Decisão
O áudio do PC é opcional e sai desligado. Ao compartilhar, a pessoa marca "Incluir áudio do PC". Sem a marca, o comportamento atual permanece.

A marca pede, no mesmo gesto, a imagem e uma faixa de áudio. Parar o compartilhamento encerra as duas. Não existe compartilhar só o som.

Se a origem devolver imagem sem áudio, a imagem continua e a tela avisa que aquela origem não trouxe o áudio do PC. Isso não conta como sucesso.

Quem compartilha não escuta a própria faixa. Os outros escutam por o mesmo caminho do microfone remoto, inclusive o botão Ativar som. O microfone continua uma faixa separada. O áudio do PC não é misturado nele.

A preferência da marca pode ficar gravada neste PC, sempre visível. Não há captura escondida.

## Prova
Num build instalado, duas pessoas, fone em quem assiste:

1. Compartilhar o monitor com a marca ligada e um som tocando no PC de origem. O outro lado entende o som.
2. Repetir com uma janela.
3. Desmarcar e compartilhar de novo. O outro lado não recebe essa faixa.
4. Parar o compartilhamento. A faixa some.

Se o WebView2 não entregar a faixa, o desenho para aqui. Captura nativa do Windows só com outro desenho, cobrindo encoder, tempo e publicação da faixa.

## Fora deste desenho
Áudio de uma guia, mixagem com o microfone, captura nativa e tratar a prova como já feita.

## Consequência
Quando este ADR for aceito, a implementação pede a faixa e mostra a falha quando ela não vier. Até a prova, o compartilhamento continua só com imagem.
