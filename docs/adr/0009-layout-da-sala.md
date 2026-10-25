# ADR 0009 — Layout da sala com servidores, salas e membros
Status: Accepted. Data: 2026-10-19. Aceito para a F09. A tela ainda é a faixa única.

## Contexto
A sala hoje é uma faixa grande, uma fileira de vídeos e os nomes em pílula. O card só existe quando há vídeo. Não há escolha de layout, fixar um card nem tela cheia.

O ADR 0007 coloca vários servidores na mesma API. Este desenho é a tela dessa decisão.

## Decisão
A janela tem três colunas.

1. Barra estreita de servidores, na extrema esquerda. Cada servidor é a inicial do nome. O selecionado fica marcado em verde. Só aparecem servidores de que a pessoa é membro. O administrador da instância vê, no fim da barra, o botão de criar servidor. Com um servidor só, a barra tem uma marca.

2. Sidebar de salas do servidor selecionado. Só salas de voz. Sem canal de texto e sem categorias. Entrar numa sala é clique na sala. Dono e moderador criam sala por aqui.

3. O resto da janela é a área dos cards. Embaixo dela fica a barra de microfone, câmera, compartilhamento e sair.

Dá para olhar outro servidor sem sair da chamada. A sidebar troca. Os cards e o som continuam da sala atual. Uma faixa mostra o nome dessa sala e o clique nela volta ao servidor dela. Sair da chamada continua explícito.

## Cards
Cada pessoa na sala tem um card, com ou sem câmera. Sem câmera, o card mostra a inicial e o nome. Com câmera, o card mostra o vídeo e o nome.

Cada compartilhamento é um card próprio, separado da pessoa. Dois compartilhamentos são dois cards.

O volume e o silêncio do microfone, só neste PC, ficam no card da pessoa. A faixa solta de áudio sai.

## Layouts
Dois modos, escolhidos na área dos cards:

- Destaque. Um card ocupa o centro. Os outros ficam numa faixa horizontal acima da barra de controles. Sem fixação, o centro é o compartilhamento de outra pessoa. Sem isso, a câmera de outra pessoa. Sem isso, o primeiro card.
- Grade. Todos os cards no mesmo tamanho. Compartilhamentos vêm primeiro, pessoas depois.

Fixar escolhe qual card fica no centro do destaque. A fixação vale até soltar ou até o card sumir. Na grade, fixar não muda o tamanho.

Tela cheia faz o card do centro cobrir a janela, escondendo a barra de servidores, a sidebar e a faixa. A barra de controles vira uma faixa fina sobre a imagem. Esc ou o botão desfaz.

## O que a sidebar não mostra
Quem está em cada sala e o anel de quem fala ficam no ADR 0011. Este desenho não os inclui sozinho.

## Fora deste desenho
Mensagens, amigos, categorias, sala privada, áudio do PC e captura nativa. O áudio do PC continua no ADR 0008.

## Consequência
Quando este ADR for aceito, a tela da reunião segue estas três colunas. Até lá, a faixa única permanece.
