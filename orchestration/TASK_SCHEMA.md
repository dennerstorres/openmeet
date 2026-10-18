# Esquema de tarefa

```yaml
id: F02-04
name: Screen capture POC
dependencies: [F02-02]
status: PENDING
owner: grok
files_scope: [apps/desktop, packages/media, docs/TEST_MATRIX.md]
acceptance:
  - Monitor selection tested in packaged Windows app
  - Window selection tested in packaged Windows app
  - Stop sharing removes published track
checks:
  - pnpm lint
  - pnpm typecheck
  - manual:M05
  - manual:M06
reviewers: [claude]
evidence: []
blockers: []
```

Estados: PENDING → READY → IN_PROGRESS → IMPLEMENTED → (WAITING_VALIDATION) → VERIFIED → DONE. BLOCKED pode ser usado quando há dependência não resolvida.

`DONE` exige evidência não vazia para cada critério manual/testável e revisão obrigatória registrada. Não sobrescrever histórico para mascarar falhas.
