# Fase 07 — distribution

Objetivo: Infra Docker + instalador.

## F07-03 — 0.2.0
READY → IN_PROGRESS em 2026-10-23. Pedido explícito de deploy e exe versionado inclui F04-05/F12-08. Arquivos: versões em package.json/Tauri/Cargo.lock, documentação de entrega. Testes: pnpm test/typecheck/lint, build NSIS, SHA256SUMS, resposta HTTPS/health e assets após deploy. Preservar pendências de mídia/aparelho físico; nenhuma migration nova nesta entrega.

## F07-01
`IMPLEMENTED` em 2026-10-18 na branch `task/F07-01-compose`.

A stack de um nó está em `infra/compose`: Postgres, API, LiveKit sem `--dev` e Caddy. O POC em `infra/livekit` não mudou. O YAML do LiveKit é gerado fora do Git e recusa chave vazia. TURN só entra com domínio e um modo completo, certificados ou TLS externo. O backup usa `pg_dump` no serviço Postgres e recusa um dump que contenha a senha.

No Docker local, o `pg_dump` restaurou a linha 7 e a API ficou healthy em `/health/ready`. A VPS, o certificado público e as duas redes não rodaram. Essa parte segue sem PASS.

## F07-02
`IMPLEMENTED` em 2026-10-18 na branch `task/F07-02-installer`.

O bundle Windows é NSIS por usuário, sem assinatura. O build local gerou `OpenMeet_0.1.0_x64-setup.exe`. O workflow `.github/workflows/release.yml` gera o instalador e o `SHA256SUMS`. A publicação só ocorre numa tag `v*`. O GitHub Actions não rodou. Em 2026-10-19 o instalador abriu em dois PCs. Uma máquina limpa, sem toolchain, não foi registrada à parte.

## Critério de saída
Restore test e uso VPS externa. Um restore local não fecha a fase.

## Observação
Não concluir fase por implementação superficial ou mocks. Dependências externas e validações reais precisam de evidência ou status WAITING_VALIDATION.
