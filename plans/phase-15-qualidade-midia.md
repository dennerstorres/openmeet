# Fase 15 — qualidade e desempenho da mídia (ADR 0029)

| ID | Tarefa | Estado | Depende |
|---|---|---|---|
| F15-01 | Perfis de compartilhamento de tela (`detail`/`motion`), VP9 + reserva, prioridade alta, áudio do PC estéreo | IMPLEMENTED | ADR 0029 (aceito) |
| F15-02 | Escolha do perfil na UI ao compartilhar | WAITING_VALIDATION | F15-01 |
| F15-03 | `adaptiveStream` + `dynacast` no Room | IMPLEMENTED | ADR 0029 |
| F15-04 | Jitter buffer baixo no vídeo da tela, com medição | IMPLEMENTED | F15-01 |
| F15-05 | RNNoise local no microfone | IMPLEMENTED | ADR 0030 (aceito) |
| F15-06 | Telemetria da rampa inicial do compartilhamento | WAITING_VALIDATION | F15-01 |

## F15-01

Escopo: `packages/media/src/screen-quality.ts`, `session.ts` (`setScreenShare` ganha `mode`, com padrão `detail`), testes.

Testes automáticos: `pnpm --filter @openmeet/media test` (2026-11-04, Windows 11): 80/80 passando, typecheck ok.

Falta validar numa chamada real com o SFU: codec negociado (VP9 ou reserva) em `getStats`, fps e resolução nos dois perfis, rede ruim, PC fraco e áudio do PC em estéreo. Também falta a revisão independente.

## F15-02

Seletor "Texto nítido" / "Movimento fluido" ao lado de "Incluir áudio do PC" (`MeetingApp.tsx`), salvo em `openmeet.screenMode` neste aparelho e travado enquanto compartilha. Typecheck e lint ok. `apps/desktop` test: 44 passando, 1 falha que já existia (`web.test.mjs`, "atalhos globais"), também sem esta mudança. Falta ver na tela e numa chamada real.

## F15-03

`packages/media/src/room-options.ts`: `new Room({ adaptiveStream: true, dynacast: true })`. Os cards já usam `track.attach`, então o SDK vê o tamanho e a visibilidade de cada vídeo. Teste da mídia 81/81, typecheck e lint ok (2026-11-04, Windows 11). Falta uma chamada real com 3 ou mais pessoas para medir a banda (`getStats`) e confirmar que card escondido ou em tela cheia não congela o vídeo ao voltar.

## F15-04

`lowerScreenLatency` em `screen-quality.ts`: no `TrackSubscribed`, o vídeo de tela remoto recebe `jitterBufferTarget = 0`, ou `playoutDelayHint = 0` em navegador antigo. Câmera e áudio não mudam. Mídia 82/82 (2026-11-04). Falta medir na chamada real o atraso e as travadas com rede ruim, e ver se o áudio do PC continua sincronizado com a imagem. Se piorar, a chamada sai sem mexer no resto.

## F15-05

ADR 0030. `InputGain.setDenoise` e `session.setNoiseSuppression`, com o switch "Reduzir ruído do microfone" nos ajustes (`openmeet.noiseSuppression`). Os assets ficam em `public/media/rnnoise/` e os avisos de licença em `THIRD_PARTY_NOTICES.txt`. A biblioteca é importada sob demanda. Mídia 83/83 e lint ok. Desktop 44 passando, 1 falha preexistente. Falta ouvir numa chamada real, medir a CPU e testar com fone Bluetooth.

## F15-06

Escopo: durante os primeiros 15 s de uma publicação local de tela, coletar uma amostra por segundo exclusivamente da faixa `screen_share`. Cada amostra registra tempo relativo, bitrate calculado por delta de `bytesSent`, resolução/FPS, codec, `qualityLimitationReason`, `targetBitrate` e `availableOutgoingBitrate` quando o WebRTC os fornecer. O resultado entra apenas no diagnóstico consentido, sem conteúdo audiovisual, nomes, SDP, IP, SSRC ou IDs persistentes.

Testes: parser de stats, cálculo por delta, descarte de contador reiniciado e limite temporal; exportação preserva somente campos permitidos. Validação real no `.exe` e navegador continua obrigatória para atribuir a causa e fica `WAITING_VALIDATION` depois da implementação.

Implementado em 2026-11-07 na branch `task/F15-06-telemetria-rampa`. A coleta fica somente em memória, recomeça a cada compartilhamento e para ao fim da janela, ao parar a tela ou ao desconectar. O JSON só recebe `screenRamp` depois do consentimento já exigido para exportar. Windows 11: mídia 87/87, typecheck, build e ESLint PASS; typecheck do desktop, Prettier e `git diff --check` PASS. Chamada real não executada.
