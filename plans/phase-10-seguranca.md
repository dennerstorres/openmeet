# Fase 10 — correções de segurança

Objetivo: fechar os achados S-01 a S-21 da auditoria `docs/reviews/security-audit-2026-10-19.md`. Correção, arquivos e teste de cada item estão em `docs/reviews/security-fixes-design-2026-10-19.md`, seção PR Plan. Não marcar `DONE` nem PASS sem o teste pedido.

## Execução
Uma tarefa por branch, na ordem das dependências do `PLAN.md`. A numeração não é fila de deploy. As migrations do desenho começam em `0003`, porque a F09-01 usou `0002_servers.sql`. Fazer backup antes da primeira delas. `POC_JOIN` continua 0.

## Critério de saída
G10. O que depende do WebView2 instalado, do SFU ou do Caddy real fica `WAITING_VALIDATION` até alguém provar.

## F10-01
PR 1 do desenho. Recusar controle e bidi nos nomes (S-21).

## F10-02
PR 2 do desenho. Sala só para membro, sem username (S-01, S-10).

## F10-03
PR 3 do desenho. Reuso de refresh revoga a família (S-03).

## F10-04
PR 4 do desenho. Corte no SFU repetível e join na mesma trava (S-04). Depende de F10-02.

## F10-05
PR 5 do desenho. Desativar conta, senha, recuperação e corte no logout (S-02, S-18). Depende de F10-03 e F10-04.

## F10-06
PR 6 do desenho. Grant só com as fontes autorizadas (S-09). Depende de F10-04. A F09-06 implementou o ADR 0008: o grant precisa listar também `screen_share_audio`, senão a marca "Incluir áudio do PC" deixa de funcionar. O desenho original dizia "sem áudio do PC" porque o ADR 0008 ainda não estava no código.

## F10-07
PR 7 do desenho. Limite só atrás do segredo do proxy (S-11).

## F10-08
PR 8 do desenho. Bootstrap sem oráculo e sem stdout (S-12).

## F10-09
PR 9 do desenho. Contexto de build sem o .env da stack (S-19).

## F10-10
PR 10 do desenho. TURN sem TLS externo e sem 5349 solto (S-20).

## F10-11
PR 11 do desenho. Backup cifrado e contrato de firewall (S-17).

## F10-12
PR 12 do desenho. Mídia e navegação só na origem do bundle (S-07, S-08).

## F10-13
PR 13 do desenho. Capability mínima e CSP de base (S-14, S-15).

## F10-14
PR 14 do desenho. Prova de mídia fora do instalador (S-13).

## F10-15
PR 15 do desenho. Cofre de um slot, recusa outra origem (S-05).

## F10-16
PR 16 do desenho. Contrato visível da bandeja (S-16).

## F10-17
PR 17 do desenho. Login, refresh e logout no processo nativo (S-05, S-18). Depende de F10-05, F10-07 e F10-15.

## F10-18
PR 18 do desenho. Salas e join no processo nativo (S-06). Depende de F10-17.

## Observação
Não substituir teste real de mídia, cofre ou proxy por mock para aprovar a fase.
