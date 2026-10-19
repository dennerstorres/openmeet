# Fase 06 — resilience

Objetivo: Observabilidade e reconexão.

## Execução
F06-01 ficou `IMPLEMENTED` em 2026-10-18. A sessão guarda cada reconexão aberta e o tempo até recuperar ou falhar. Sair no meio não conta como falha. A exportação sai em JSON só depois do consentimento e remove token, JWT, Bearer e e-mail. A queda real de 5 s não rodou.

## Critério de saída
Diagnóstico sanitizado e medições de reconexão. A08 segue `NOT_RUN`.

## Observação
Não concluir fase por implementação superficial ou mocks. Dependências externas e validações reais precisam de evidência ou status WAITING_VALIDATION.
