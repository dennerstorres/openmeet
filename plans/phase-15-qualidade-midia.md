# Fase 15 — qualidade e desempenho da mídia (ADR 0029)

| ID | Tarefa | Estado | Depende |
|---|---|---|---|
| F15-01 | Perfis de compartilhamento de tela (`detail`/`motion`), VP9 + reserva, prioridade alta, áudio do PC estéreo | IMPLEMENTED | aceite do ADR 0029 |
| F15-02 | Escolha do perfil na UI ao compartilhar | PENDING | F15-01 |
| F15-03 | `adaptiveStream` + `dynacast` no Room | PENDING | ADR 0029 |
| F15-04 | Jitter buffer baixo no vídeo da tela, com medição | PENDING | F15-01 |
| F15-05 | RNNoise local no microfone | PENDING | ADR próprio |

## F15-01

Escopo: `packages/media/src/screen-quality.ts`, `session.ts` (`setScreenShare` ganha `mode`, com padrão `detail`), testes.

Testes automáticos: `pnpm --filter @openmeet/media test` (2026-11-04, Windows 11): 80/80 passando, typecheck ok.

Falta validar numa chamada real com o SFU: codec negociado (VP9 ou reserva) em `getStats`, fps e resolução nos dois perfis, rede ruim, PC fraco e áudio do PC em estéreo. Também falta a revisão independente.
