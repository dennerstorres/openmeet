# Quality Gates

- **G1 Fundação:** lockfile, scripts, lint/typecheck/unit/build, CI e instruções reproduzíveis; sem recursos inventados.
- **G2 Media POC:** dois PCs Windows em redes distintas, mic bidirecional, câmera, monitor, janela, stop share, logs/RTC stats e reconexão. Avaliação GO/NO-GO assinada em ADR 0004. Bloqueia o aceite final e o F08. Não bloqueia a implementação de F03–F07.
- **G3 Auth/API:** RBAC, rotação e revogação de sessões, tokens escopados, testes negativos e code review de segurança.
- **G4 Reuniões:** cinco participantes, controle local/remoto correto, UI de erro, teste de 60 min e review de regressão.
- **G5 Desktop:** bandeja, atalhos com proteção contra conflitos, controle de tracks em background, testes do instalador.
- **G6 Observabilidade:** diagnóstico exportável sanitizado, falhas de rede reproduzidas e comportamento de reconexão medido.
- **G7 Infra/release:** TLS/ICE/TURN em VPS real, teste de restauração, CI de release e instalador Windows.
- **G8 OSS:** licença de projeto/dependências revisada, SECURITY.md, contribuições e documentação pública verificadas.
- **G9 Servidores e sala:** os ADR 0007–0013. Servidores isolados na mesma API, convite por link sem vazar o código, cards e layouts, presença sem gravar ocupação no Postgres, ensurdecer local, áudio do PC com falha visível e Google sem segredo no cliente. Prova humana de link, anel e áudio do PC fica `WAITING_VALIDATION`, nunca PASS por inspeção.
- **G10 Segurança:** cada achado S-01 a S-21 fechado com o teste que o desenho pede, sem afrouxar auth, TLS ou autorização e com `POC_JOIN` em 0. Itens que só um build instalado ou a stack real provam (WebView2, SFU, Caddy) ficam `WAITING_VALIDATION`.

- **G12 Web:** ADR 0014. Cliente web na mesma origem da API, sem token legível por JavaScript, cookie `HttpOnly; Secure; SameSite=Strict`, CSRF recusado sem `Origin` e cabeçalho web, CSP sem `unsafe-inline` e com só o domínio do LiveKit, e o `.exe` sem regressão. Chrome, Edge e Firefox reais ficam `WAITING_VALIDATION` até prova humana.

**G16 Mobile (F16):** ADR 0032 aceito para código de produção; viabilidade iOS sem macOS demonstrada por X01-X04, com xtool, LiveKit Swift, assinatura Personal Team e iPhone físico; testes A01-A08, I01-I09 e X10-X12 da `docs/MOBILE_TEST_MATRIX.md` com resultados/evidências reais. Exige mic/áudio contínuo com tela bloqueada, Bluetooth (inclusive alternância de rota), câmera, compartilhamento da **tela inteira de outros apps** e recepção de tela entre Android/iOS/desktop. Testar login/refresh seguro, revogação, permissão negada, TURN/reconexão, regressão desktop/web, cinco participantes/60 min e revisão de segurança. Restrições App Store/APNs e requisitos por versão iOS explicitados; não aceitar PWA como substituto, não alegar GO por compilação isolada. Se aparelho/Apple ID não disponível: `WAITING_VALIDATION`/`NOT_RUN`, nunca PASS.

Se uma ação exige contexto fora da máquina do agente (2 PCs, rede, VPS) marcar WAITING_VALIDATION e fornecer roteiro ao humano, nunca declarar PASS.
