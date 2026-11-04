# ADR 0029 — ajuste fino da mídia (tela, sala e áudio)

Data: 2026-11-04. Estado: proposto, aberto por pedido do usuário em 2026-11-04. Falta o aceite.

## Contexto

Analisamos o cliente público do Salinha (salinha.live, `app.js`), que é WebRTC P2P. Ele ajusta à mão o que o openmeet deixa no padrão do LiveKit: `contentHint` e `degradationPreference` por tipo de conteúdo, preferência AV1/H264/VP9, bitrate inicial alto, prioridade de rede alta para a tela, áudio da tela Opus estéreo a 192 kbps, buffer de reprodução (jitter) baixo e RNNoise em AudioWorklet no microfone.

Hoje o openmeet cria `new Room()` sem opções e compartilha a tela sem codec, bitrate, fps nem `contentHint` definidos. Não copiamos código. Usamos só APIs do `livekit-client` 2.23 e do WebRTC.

## Decisão

Fazer em etapas pequenas, cada uma com sua tarefa F15 e prova numa chamada real:

1. **F15-01 — tela.** Dois perfis em `packages/media/src/screen-quality.ts`:
   - `detail` (padrão): 1440p a 30 fps, até 4 Mbps, `maintain-resolution`, para texto e código.
   - `motion`: 1080p a 60 fps, até 6 Mbps, `maintain-framerate`, para jogo e vídeo.

   Os dois usam VP9 com codec de reserva (`backupCodec`) para quem não decodifica VP9, prioridade `high`, e o áudio do PC em estéreo com preset de música, sem DTX nem RED.
2. **F15-02 — escolha na UI** entre "Texto nítido" e "Movimento fluido" ao compartilhar.
3. **F15-03 — sala.** `adaptiveStream` e `dynacast` no `Room`.
4. **F15-04 — latência.** Buffer de reprodução (jitter buffer) baixo no vídeo da tela, só se a medição mostrar ganho.
5. **F15-05 — ruído do microfone.** Avaliar RNNoise local (WASM, sem SaaS). Exige um ADR próprio por causa da CSP e do licenciamento.

## Consequências

- O consumo de banda e de CPU sobe para quem compartilha. A F15-01 precisa ser provada com rede ruim e em um PC fraco.
- O VP9 em WebView2, Chrome e Edge tem de ser visto no SFU real. O codec de reserva cobre Safari e Firefox antigos.
- Não há rota, tabela nem mudança na CSP até a F15-05.
