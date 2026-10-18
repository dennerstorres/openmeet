# ADR 0001 — Tauri 2 / Windows first
Status: Accepted for POC, contingent on G2.

Decisão: Tauri 2 com React/Vite em Windows 10/11. Rationale: baixo overhead e acesso a integrações desktop. Risco: WebView2 e APIs de captura não equivalem ao Chrome completo. Alternativas: Electron (compatibilidade e custo de bundle/RAM), aplicativo nativo dedicado.

Gatilho de revisão: falha de captura de monitor/janela, permissões, minimize ou suporte ao SDK LiveKit. Registrar benchmark e proposta de fallback; não assumir troca para Rust nativo sem pipeline WebRTC comprovado.
