# Fase 07 — distribution

Objetivo: Infra Docker + instalador.

## F07-06 — 0.2.2
READY → WAITING_VALIDATION em 2026-10-26. Pedido explícito de trocar a versão, gerar o `.exe`, commitar e enviar a `main`. O NSIS 0.2.2 local reúne a intensidade do blur e imagens/perfil por servidor; checksum, suíte TypeScript e testes Rust passaram. Falta instalar o bundle e validar câmera e imagens com dois clientes. Sem tag, GitHub Release ou deploy.

## F07-04 — 0.2.1
READY → WAITING_VALIDATION em 2026-10-23. Pedido explícito de novo `.exe`, commit e push na `main`. O NSIS 0.2.1 local reúne atalhos/configurações, blur e presença de servidor; checksum, suíte TypeScript e testes Rust passaram. Faltam instalar o bundle, validar câmera e presença com dois clientes e aplicar a migration 0007 em implantação real. Sem tag, GitHub Release ou deploy público nesta tarefa.

## F07-03 — 0.2.0
READY → IN_PROGRESS → WAITING_VALIDATION em 2026-10-23. Pedido explícito de deploy e exe versionado inclui F04-05/F12-08. `v0.2.0` foi publicada com NSIS e `SHA256SUMS`; download repetido confirmou o hash. Coolify implantou `96d206e` e produção respondeu 200 em `/` e `/health/ready`. O job do GitHub Actions não iniciou por limite da conta, por isso a publicação dos artefatos locais foi manual. Preservadas as pendências de instalação, mídia e aparelho físico; nenhuma migration nova nesta entrega.

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

## F07-07 — 0.2.3 pelo GitHub Release
READY → WAITING_VALIDATION em 2026-10-26. Pedido explícito de tornar o repo público e publicar a release. Auditoria do histórico com gitleaks v8.21.2 (93 commits, todas as branches) sem achados. A tag `v0.2.2` falhou no `rust-toolchain` sem `toolchain`; corrigido com `1.98.1` e versão subida para 0.2.3, porque a 0.2.2 já foi instalada à mão. Falta instalar a 0.2.3 e validar a atualização para a próxima versão.
