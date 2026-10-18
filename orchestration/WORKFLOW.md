# Workflow Grok-first

## Papéis
Grok 4.7: executor padrão de 75% das tarefas. Claude: arquitetura e segurança. Codex: qualidade, testes, regressões. Não há necessidade de seis agentes simultâneos.

## Ciclo
1. Coordenador seleciona tarefa READY, verifica dependências e gera branch `task/<ID>-slug`.
2. Grok implementa em etapas pequenas, adiciona testes e registra execução real.
3. Grok marca IMPLEMENTED; se exige dispositivo ou pessoa real, marca WAITING_VALIDATION.
4. Gate indicado aciona Claude (ADR/security) e/ou Codex (code/test review). Revisões registram achados com severidade.
5. Grok corrige achados; reexecuta CI e testes relevantes.
6. Se evidências e revisão satisfazem o gate, estado VERIFIED e depois DONE; próxima READY é liberada.

## Política multiagente
- Nunca compartilhar mesma worktree em processos de escrita paralelos; usar `git worktree` ou sessões sequenciais.
- Um reviewer deve receber diff e testes já executados; revisão não se confunde com execução de testes.
- Falha de limite de uso ou interrupção: registrar handoff no HISTORY; outro agente retoma sem apagar estado.
- Nunca usar automação com aprovações irrestritas para comandos destrutivos, deploy e secrets.
- Orquestração entre CLIs não é presumida como integração nativa; handoff via Git, arquivos e prompts.
