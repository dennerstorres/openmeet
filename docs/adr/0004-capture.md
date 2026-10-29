# ADR 0004 — Captura de tela: decisão pendente do POC
Status: Accepted — GO em 2026-10-29.

Registro 2026-10-18: o cliente pede compartilhamento com `setScreenShareEnabled` e guarda o erro de mídia. Nenhuma captura foi executada. A decisão continua bloqueada.

Parecer F02-06 de 2026-10-18 (Claude): PROVISÓRIO, sem GO/NO-GO. Pendências e riscos de WebView2 em `docs/reviews/F02-06-parecer.md`.

Hipótese A: `navigator.mediaDevices.getDisplayMedia()` no Tauri/WebView2 suportará seleção de monitor e janela de forma utilizável.

Plano: validar no dev e build, duas versões Windows, múltiplos monitores, minimizar/restaurar, parar/publicar/republicar, erros de permissão.

Se falhar: comparar captura nativa com ponte de frames/WebRTC e Electron como fallback. Escolher somente com evidência técnica e custos de manutenção; não iniciar solução nativa sem design de encoder, timing, backpressure e track publish.

## Decisão F02-06 — GO (2026-10-29)
Decisão humana (Denner Torres). O OpenMeet está em uso contínuo nas reuniões da equipe da empresa, com participantes no desktop (Tauri/WebView2) e no cliente web ao mesmo tempo. Microfone, câmera e compartilhamento de tela funcionam. Isso se soma ao teste de dois PCs com o instalador em 2026-10-19. A hipótese A vale: `getDisplayMedia()` no WebView2 é usável. Fica Tauri; nenhuma alternativa nativa ou Electron.
O roteiro formal M01–M12 (`docs/POC_F02.md`) não foi executado item a item. O GO se apoia no uso real relatado, e não nesse roteiro. Um problema novo de captura abre tarefa própria, sem reabrir esta decisão.

