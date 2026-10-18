# AGENTS — instruções vinculantes para todos os agentes

## Prioridades
1. Segurança e integridade dos dados.
2. Evidência verificável dos critérios de aceite.
3. Simplicidade arquitetural e reversibilidade.
4. Experiência do usuário e desempenho.
5. Rapidez de entrega.

## Antes de codificar
Ler `SPEC.md`, `PLAN.md`, `orchestration/WORKFLOW.md`, `orchestration/QUALITY_GATES.md`, `docs/ARCHITECTURE.md`, ADRs relevantes e plano da fase. Escolher somente tarefa `READY` sem dependência bloqueante. Registrar task ID, escopo, planos de teste e arquivos que pretende alterar.

## Durante execução
- Grok é executor padrão; Claude e Codex são revisores especializados, sem escrita concorrente na mesma worktree.
- Preferir mudanças pequenas e autocontidas. Um módulo/tarefa por branch.
- Não criar features fora da SPEC. Necessidade de mudança arquitetural → ADR antes.
- Não substituir testes reais por mocks para aprovação de áudio/vídeo/tela.
- Não desabilitar autenticação, TLS ou autorização para 'fazer funcionar' em produção.
- Nunca salvar secrets, tokens, dumps de usuários, mídia ou credenciais em commits/logs.
- Comandos destrutivos, deploy público e mudanças na segurança devem exigir autorização humana.
- Não assumir funcionamento de `getDisplayMedia()` nem captura de áudio de sistema no WebView2 até verificar no POC.
- Não adicionar integração de API paga obrigatória ou serviços SaaS.
- Manter tipagem estrita, migrations versionadas, logs estruturados e testes de permissão.
- Não misturar identidade multi-instância no backend: instância separada é implantação separada.

## Conclusão de tarefa
Executar testes aplicáveis e registrar comandos, data, plataforma e resultado. Atualizar `PLAN.md`, plano de fase e `HISTORY.md`. `DONE` só após revisão exigida e gates evidenciados. Se teste manual ausente: `WAITING_VALIDATION` ou `BLOCKED`, nunca DONE.

## Convenções iniciais
Monorepo pnpm, TypeScript strict, Node LTS, Fastify, Drizzle/Postgres, React/Vite/Tauri 2. Evitar `any` e secrets hardcoded. Prettier com `trailingComma: all`, `printWidth: 160`. Fixar versões verificadas em lockfile após bootstrap, não presumir releases no planejamento.

## Handoff
Escrever em `HISTORY.md`: task ID, branch/commit, mudanças, comandos, resultados, riscos, bloqueios, próximos passos. Revisor lê diff e critérios, reporta severidade e evidências; não alegar execução não realizada.
