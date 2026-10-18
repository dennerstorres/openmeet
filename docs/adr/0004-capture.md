# ADR 0004 — Captura de tela: decisão pendente do POC
Status: Proposed / BLOCKED by G2.

Registro 2026-10-18: o cliente pede compartilhamento com `setScreenShareEnabled` e guarda o erro de mídia. Nenhuma captura foi executada. A decisão continua bloqueada.

Parecer F02-06 de 2026-10-18 (Claude): PROVISÓRIO, sem GO/NO-GO. Pendências e riscos de WebView2 em `docs/reviews/F02-06-parecer.md`.

Hipótese A: `navigator.mediaDevices.getDisplayMedia()` no Tauri/WebView2 suportará seleção de monitor e janela de forma utilizável.

Plano: validar no dev e build, duas versões Windows, múltiplos monitores, minimizar/restaurar, parar/publicar/republicar, erros de permissão.

Se falhar: comparar captura nativa com ponte de frames/WebRTC e Electron como fallback. Escolher somente com evidência técnica e custos de manutenção; não iniciar solução nativa sem design de encoder, timing, backpressure e track publish.
