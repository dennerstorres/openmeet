# Fase 12 — cliente web

Objetivo: implementar o ADR 0014. A instância serve em `https://{API_DOMAIN}/` o mesmo cliente do `.exe`, com sessão em cookie `HttpOnly`. Não começar antes do ADR aceito. Não marcar `DONE` nem PASS sem a prova pedida.

## Execução
F12-08 selecionada READY → IN_PROGRESS → WAITING_VALIDATION em 2026-10-23: navegação, login, cards, dock e menus adaptados para 320px em diante, toque e orientação horizontal. Arquivos: MeetingApp.tsx, App.css, index.html, SPEC/ADR0014 e registros. Sem alteração no transporte/autenticação. Layouts em Edge emulado (320/390/768/844/1280), overflow, navegação, grade, tela cheia e menus verificados. Typecheck, lint, builds e 16 testes desktop PASS. Evidência e fixture em artifacts/mobile; não é aprovação de mídia. Falta celular físico, teclado virtual, Safari/iOS, Chrome/Android e revisão independente.

Uma tarefa por branch, na ordem das dependências do `PLAN.md`. Nada desta fase muda o `.exe`: o alvo desktop continua com o processo nativo da F10.

## Critério de saída
G12. Navegador real, dois PCs e Chrome, Edge e Firefox ficam `WAITING_VALIDATION` até alguém provar.

## F12-01
Aceitar o ADR 0014 e atualizar a SPEC: visão com dois clientes, RF-02 como armazenamento seguro, RF novo do cliente web, navegadores suportados. Sem código.

## F12-02
Sessão por cookie na API. Login, bootstrap, Google e refresh gravam `om_access` e `om_refresh` quando o pedido traz `X-OpenMeet-Web: 1` e `Origin` igual ao `API_DOMAIN`; o corpo não leva token. As rotas aceitam `Bearer` ou o cookie, nunca os dois juntos. Pedido que muda estado sem os dois cabeçalhos não se autentica por cookie. Logout apaga os cookies e faz o corte da F10-05. Testes: cookie com os atributos certos, corpo sem token, CSRF recusado sem cabeçalho e com outra origem, reuso de família derruba o cookie, `.exe` com `Bearer` igual a hoje.

## F12-03
Alvo `web` do frontend. `vite build --mode web` gera `dist-web`. A instância é a origem da página; o passo de escolher instância some. O broker de sessão chama as rotas com `credentials: "same-origin"` e o cabeçalho web, sem guardar token. Bandeja, atalhos, notificação nativa, cofre, `openmeet://` e `PocApp` não entram no bundle. Teste do bundle como o da F10-14.

## F12-04
A API serve o bundle web. O Dockerfile gera `dist-web` e copia para a imagem; a API serve `/` e os assets com a CSP do ADR 0014, `frame-ancestors 'none'`, `X-Content-Type-Options` e cache longo só nos arquivos com hash. `/api/*` e `/convite/:code` continuam iguais. Testes: CSP e cabeçalhos, `index.html` sem cache, rota desconhecida cai no `index.html` sem pegar `/api`.

## F12-05
Convite e Google no navegador. `/convite/:code` ganha "Abrir no navegador", que entrega o código ao cliente web sem pôr o código no log. Google abre numa janela nova e continua pelo poll; o resultado grava os cookies. Testes do código fora do log e do fluxo Google com o fake atual.

## F12-06
Mídia conforme o navegador. Detecta `setSinkId` e o suporte a áudio de tela; esconde o que faltar. Diagnóstico registra o navegador. Teste de modelo para os dois casos.

## F12-07
Prova humana. Chrome, Edge e Firefox, em dois PCs, contra a stack real: entrar, criar servidor e sala, convite, câmera, microfone, tela, áudio de aba no Chrome, ensurdecer, reconexão e sair da conta. Registrar navegador e versão. Fica `WAITING_VALIDATION` até rodar.
