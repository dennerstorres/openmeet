# Fase 15 — qualidade e desempenho da mídia (ADR 0029)

| ID | Tarefa | Estado | Depende |
|---|---|---|---|
| F15-01 | Perfis de compartilhamento de tela (`detail`/`motion`), VP9 + reserva, prioridade alta, áudio do PC estéreo | IMPLEMENTED | ADR 0029 (aceito) |
| F15-02 | Escolha do perfil na UI ao compartilhar | WAITING_VALIDATION | F15-01 |
| F15-03 | `adaptiveStream` + `dynacast` no Room | PENDING | ADR 0029 |
| F15-04 | Jitter buffer baixo no vídeo da tela, com medição | PENDING | F15-01 |
| F15-05 | RNNoise local no microfone | PENDING | ADR próprio |

## F15-01

Escopo: `packages/media/src/screen-quality.ts`, `session.ts` (`setScreenShare` ganha `mode`, com padrão `detail`), testes.

Testes automáticos: `pnpm --filter @openmeet/media test` (2026-11-04, Windows 11): 80/80 passando, typecheck ok.

Falta validar numa chamada real com o SFU: codec negociado (VP9 ou reserva) em `getStats`, fps e resolução nos dois perfis, rede ruim, PC fraco e áudio do PC em estéreo. Também falta a revisão independente.

## F15-02

Seletor "Texto nítido" / "Movimento fluido" ao lado de "Incluir áudio do PC" (`MeetingApp.tsx`), salvo em `openmeet.screenMode` neste aparelho e travado enquanto compartilha. Typecheck e lint ok. `apps/desktop` test: 44 passando, 1 falha que já existia (`web.test.mjs`, "atalhos globais"), também sem esta mudança. Falta ver na tela e numa chamada real.
