# ADR 0011 — Presença nas salas
Status: Accepted. Data: 2026-10-19. Aceito para a F09. A sidebar ainda não lista ocupantes.

## Contexto
A sidebar do ADR 0009 lista as salas e não mostra quem está nelas. O card também não mostra quem está falando. O cliente só conhece as pessoas da sala em que entrou.

## Decisão
A API consulta o LiveKit pelas pessoas de cada sala do servidor selecionado. A sidebar mostra o nome debaixo da sala. A consulta não é gravada no Postgres. O cliente repete a consulta a cada poucos segundos enquanto a sidebar está aberta.

Se a consulta falhar, as salas continuam na lista e os nomes somem. A tela não inventa ocupantes.

O anel verde fica no card da pessoa, na sala atual. A fonte é o alto-falante ativo do LiveKit nesta chamada. O anel também aparece no nome dessa pessoa na sidebar. As outras salas não ganham anel, porque o cliente não ouve o áudio delas.

Nome vazio ou só com o id vira "Participante". A pessoa não aparece duas vezes.

## Fora deste desenho
Status online fora de uma sala, última vez visto e anel nas salas em que a pessoa não entrou.

## Consequência
Quando este ADR for aceito, a sidebar deixa de ser uma lista muda. Até lá, ela só mostra as salas.
