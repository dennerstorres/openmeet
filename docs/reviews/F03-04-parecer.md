# F03-04 — revisão Codex — 2026-10-18

Resultado: G3 não aprovado. F03-04 BLOCKED por correções e validações pendentes. Revisão da implementação no commit base `d746a5eb35230b7c9806383286c45642ed20763d`; testes e parecer na branch `task/F03-04-auth-review`, sem commit novo.

## Achados

| ID | Severidade | Evidência e impacto | Correção / aceite esperado |
|---|---|---|---|
| A1 | Alta | `apps/server/src/main.ts:12` chama `buildApp()` sem banco. `app.ts` só repassa `options?.db`; DATABASE_URL não é usada no boot. Auth e rooms permanecem 503 mesmo com migrations aplicadas. Readiness devolve 200 e `not_configured` fixo. | Conectar PostgreSQL no runtime, fechar conexão no shutdown e testar readiness e fluxo HTTP com banco real. |
| A2 | Alta | `apps/server/src/rooms/service.ts:161` e `:168`: encerrar/remover apenas atualizam SQL e auditoria. Não há chamada ao SFU para desconectar participantes/encerrar mídia, apesar do 204. JWT anterior continua verificável no teste. | Integrar moderação no LiveKit e tratar falhas parciais; provar desconexão e impedimento de reentrada com token anterior em clientes reais. Validação criptográfica isolada não prova o comportamento do SFU. |
| A3 | Alta | `apps/server/src/auth/service.ts:212` revoga somente refresh; `:223` consulta usuário, sem vincular JWT à sessão. Reprodução em `auth.test.ts`: logout 204, refresh 401, `/auth/me` com access antigo 200. | Garantir revogação da sessão para tokens de acesso ou formalizar política de janela residual; o token atual pode autorizar ações por até 15 minutos. Testar isolamento entre sessões. |
| A4 | Alta | `apps/server/src/rooms/service.ts:252` limpa `removed_at` ao resgatar convite. Reprodução: remover membro, join sem convite 403, join com convite criado antes da remoção 200. | Impedir que convite anterior desfaça remoção; definir readmissão explícita e testar a política. |
| M1 | Média | `apps/server/src/app.ts:20` permite apenas GET/POST no CORS. Preflight PATCH da origem Vite retorna `GET, POST`; PATCH/DELETE de moderação são bloqueados pelo browser. | Ajustar métodos permitidos e testar preflight das operações de encerramento, remoção e revogação. |
| M2 | Média | `apps/server/src/auth/routes.ts` e `app.ts`: não há limitação de tentativas de login/bootstrap. Cada tentativa válida em formato pode executar Argon2. Não foi realizado teste de carga. | Implementar controle de abuso com testes de limite e recuperação, considerando proxy e usuários distintos. |

## Evidência executada

Plataforma: Windows, PowerShell, Node v24.18.0, pnpm 10.30.2. Data: 2026-10-18.

- `pnpm --filter @openmeet/server test`: exit 0, 15 testes, 15 pass, 0 fail. Casos existentes ampliados; o número de testes de topo não mudou.
- `pnpm typecheck`: exit 0 no workspace.
- `pnpm lint`: exit 0 no workspace.
- `pnpm build`: exit 0 no workspace; aviso Vite de chunk maior que 500 kB. Não é build de instalador Tauri.
- Testes usam migration SQL em PGlite, Fastify inject e verificação real de assinatura LiveKit. Não substituem PostgreSQL externo, HTTP em processo independente ou mídia real.
- Novas verificações negativas: token adulterado/de outra chave, refresh expirado, corpo inválido, usuário inexistente, escalada por participante, isolamento de listagem/detalhe de salas, join anônimo, convites expirados/revogados/de outra sala e grants/TTL LiveKit.
- A3, A4 e M1 são testes de caracterização: afirmam o comportamento defeituoso para reproduzi-lo. PASS significa reprodução confirmada, não aceite. Ao corrigir, inverter as expectativas para a política segura.

## Limites e handoff

Sem alteração de código de produção, deploy, secrets ou serviços em execução. Sem aprovação G2 ou G3. Testes de concorrência em PostgreSQL, matriz completa de moderadores, captura de logs para sanitização, abuso sob carga e mídia em dois PCs não executados. Os adapters PGlite existentes usam BEGIN/COMMIT manuais; esta execução foi sequencial por fixture e não demonstra isolamento concorrente.

Próximo passo: Grok corrigir os achados em tarefa própria, incluindo integração do banco e moderação real. Atualizar as expectativas das reproduções e reexecutar os testes; voltar para revisão de segurança e validação operacional antes de VERIFIED/DONE.
