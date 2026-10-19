# ADR 0013 — Ensurdecer
Status: Accepted. Data: 2026-10-19. Aceito para a F09. O silêncio ainda é por card.

## Contexto
O silêncio de hoje é por pessoa e só no microfone remoto. Falta um gesto único para cortar o som de todo mundo neste PC, sem desligar o próprio microfone.

## Decisão
A barra da chamada ganha "Ensurdecer". Ligado, corta neste PC o áudio remoto de todas as pessoas e o áudio de compartilhamento. O microfone local continua como estava. Nada é avisado ao servidor nem às outras pessoas.

O volume e o silêncio de cada card permanecem guardados. Ao desensurdecer, cada card volta ao que era.

O botão vale durante a chamada e nasce desligado. Sair da sala zera. Não grava em disco.

Se o som remoto ainda estiver bloqueado, ensurdecer fica armado. Quando a pessoa ativar o som, ele continua cortado até ela desensurdecer.

## Fora deste desenho
Atalho global, ensurdecer uma sala inteira para os outros e misturar com o mute do microfone.

## Consequência
Quando este ADR for aceito, a barra tem o botão. Até lá, o silêncio continua por card.
