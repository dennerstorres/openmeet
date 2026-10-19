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

Se uma ação exige contexto fora da máquina do agente (2 PCs, rede, VPS) marcar WAITING_VALIDATION e fornecer roteiro ao humano, nunca declarar PASS.
