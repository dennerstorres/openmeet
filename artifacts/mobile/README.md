# F12-08 — evidência de layout

Capturas de 2026-10-23 em Edge headless com toque emulado. Dados e participantes fictícios. Não são evidência de mídia funcional.

Reprodução local: iniciar `pnpm --filter @openmeet/desktop exec vite --mode web --host 127.0.0.1`, depois `node artifacts/mobile/check-layout.mjs`. O script usa o Playwright do runtime local do Codex (caminho no início do arquivo), Edge instalado e porta 1420. API e conexão LiveKit interceptadas exclusivamente no contexto do navegador de teste.

Confere overflow horizontal, dock, menus, Grade, tela cheia e navegação. Os PNGs mostram login, salas, chamada e ajustes em diferentes viewports. Testes físicos, teclado virtual, Safari e Chrome Android pendentes.
