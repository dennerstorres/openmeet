# Contribuição

## Issues

Descreva o bug, os passos para reproduzir, a versão do app e do servidor e o Windows/navegador usado. Não cole tokens, senhas, `.env` nem logs com dados de outras pessoas. Vulnerabilidade vai pelo canal privado de `SECURITY.md`, não por issue.

## Pull requests

- Uma tarefa por branch, ligada a um item da `SPEC.md` ou do `PLAN.md`. Mudança de arquitetura começa por um ADR em `docs/adr/`.
- Inclua testes. Antes do PR, rode `pnpm typecheck`, `pnpm lint` e os testes do pacote que você mexeu (`pnpm --filter ./apps/server test`, `./apps/desktop`, `./packages/shared`).
- Mudanças em autenticação, mídia, captura ou permissões precisam de revisão de outro mantenedor.
- Não adicione serviço pago ou SaaS obrigatório, nem dependência GPL/AGPL/SSPL (veja `docs/THIRD_PARTY.md`).
- TypeScript strict, sem `any`, Prettier do repositório.

## Licença

O projeto é Apache-2.0. Ao enviar uma contribuição, você concorda que ela é licenciada nos mesmos termos (seção 5 da `LICENSE`).
