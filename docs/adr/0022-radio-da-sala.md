# ADR 0022 — rádio: uma entrada de áudio do PC transmitida na sala

Data: 2026-10-26. Estado: aceito pelo usuário em 2026-10-26.

## Contexto

O pedido inicial era um bot que tocasse playlists do YouTube, do Spotify ou de rádios por link. Spotify entrega áudio com DRM e não tem API de áudio. Tirar o áudio do YouTube para retransmitir viola os termos dele. Um bot no servidor seria uma integração externa, o que a SPEC deixa fora do MVP. O usuário trocou o pedido por transmitir um canal de áudio do próprio PC.

## Decisão

O participante escolhe uma entrada de áudio do aparelho como "Rádio" e a publica na sala como uma faixa separada do microfone. A fonte do som fica no PC dele: um cabo virtual (por exemplo, VB-Audio Cable), a "Mixagem estéreo" do Windows ou qualquer entrada que o navegador liste. O app não toca, não baixa e não controla a playlist. Quem liga o rádio comanda a música no próprio player.

Não é captura nativa do áudio do Windows, que segue fora do escopo. É `getUserMedia` com o `deviceId` escolhido, igual ao microfone.

## Faixa

- Publicada com a fonte `screen_share_audio`, que o grant (F10-06) já permite, e com o nome de faixa `openmeet-radio`. O grant do LiveKit não muda.
- O cliente separa o rádio do áudio do compartilhamento pelo nome da faixa. Rádio e "Incluir áudio do PC" (ADR 0008) não ficam ligados ao mesmo tempo; ligar um desliga o outro, com aviso.
- Captura sem cancelamento de eco, supressão de ruído nem controle automático de ganho, porque esses filtros estragam música. Estéreo quando a entrada oferecer, Opus com preset de música e sem DTX.
- O rádio não passa pelo efeito de voz, pelo ganho do microfone nem pela biblioteca de sons. Mutar o microfone não muta o rádio.
- A implementação confirma no LiveKit real que duas faixas `screen_share_audio` do mesmo participante (rádio e compartilhamento em outro momento) não se confundem. Se o SFU recusar, o ADR volta para revisão antes de mudar o grant.

## Na sala

- O rádio aparece como card próprio ("Rádio de Ana"), sem vídeo, com o nome da entrada escondido.
- Cada pessoa ajusta o volume do rádio de 0 a 100% ou muta só para si, como em RF-06. Ensurdecer (ADR 0013) também cala o rádio.
- Só quem ligou para ou troca a entrada. Moderador e dono não param o rádio de outra pessoa; o que já existe continua valendo: volume e mute locais e o kick da sala (ADR 0015).
- O rádio acaba quando quem ligou sai da sala, cai a conexão ou fecha o app. Na reconexão ele não volta sozinho.
- Um rádio por participante. Vários participantes podem ter rádio ao mesmo tempo.

## Segurança e privacidade

O nome do dispositivo não sai do aparelho e não entra no diagnóstico exportado; o evento registra só "rádio ligado" e "rádio desligado". Sem rota nova na API, sem tabela e sem mudança na CSP.

## Riscos

- Direito autoral: o que toca é responsabilidade de quem liga o rádio e do operador da instância. A UI avisa isso ao ligar.
- Escolher "Mixagem estéreo" ou o alto-falante como fonte manda também as vozes da sala de volta para ela, gerando eco. A UI recomenda o cabo virtual e avisa quando a entrada escolhida é a mesma do microfone.
- Música usa mais banda que voz: o preset de música sobe o bitrate. Exige prova com rede ruim.
- WebView2, Chrome, Edge e Firefox precisam provar que listam o cabo virtual e entregam estéreo.

## Fora do escopo

Bot no servidor, LiveKit Ingress, player de YouTube ou Spotify dentro do app, fila de músicas, mostrar o nome da música, rádio que continua sem quem o ligou e moderador parar o rádio alheio.
