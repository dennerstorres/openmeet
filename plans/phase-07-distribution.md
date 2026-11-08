# Fase 07 — distribution

## F07-17 — Release 0.2.24

READY → IN_PROGRESS em 2026-11-07, por pedido explícito do usuário. Escopo: publicar a telemetria F15-06 da rampa inicial da tela, atualizar `apps/desktop/package.json`, `tauri.conf.json`, `Cargo.toml` e a entrada do pacote desktop em `Cargo.lock` para `0.2.24`, executar gates locais, integrar por fast-forward na `main`, criar `v0.2.24` e publicar pelo workflow existente. Conferir instalador, assinatura, `latest.json` e `SHA256SUMS`; instalação, atualização e chamada real ficam `WAITING_VALIDATION`.

Gates locais PASS em Windows 11: workspace 27/27, shared 79/79, mídia 87/87, servidor 128/128, desktop 50/50 e scripts de release 6/6; formatação, lint, typecheck, build e `cargo check` com Rust 1.98.1 PASS. O aviso preexistente de chunk principal acima de 500 kB permanece. Falta commit, push, CI, publicação e conferência dos assets.

WAITING_VALIDATION: commit `a11e8ad`, `main` e tag anotada `v0.2.24` enviados atomicamente. CI da tag 42427235195 PASS e workflow de release 42427235208 PASS (`windows-installer` 11m17s, publicação 6s). Os quatro assets foram baixados: instalador com 8.403.471 bytes e SHA-256 `5f19cdcc28f3738e69a7f85f1094a64434163e6a8c413fc1431b8f77297c42f8`, igual ao `SHA256SUMS` e ao digest do GitHub; `latest.json` declara `0.2.24`, URL correta e a mesma assinatura do `.sig`. O CI redundante da `main` 42427235269 permanecia no passo de testes no último acompanhamento; a execução idêntica da tag passou. Falta instalar, validar a atualização 0.2.23 → 0.2.24 e fazer a chamada real que exporta `screenRamp`.

## F07-15 — Release 0.2.21

READY → IN_PROGRESS em 2026-11-04, por pedido explícito do usuário. Escopo: ícones compactos de câmera/tela, correção do salto do botão de configurações no tooltip, registros, quatro manifests em `0.2.21`, commit/push na `main`, tag e publicação pelo workflow. Gates locais e conferência dos quatro assets são obrigatórios; instalação e atualização reais ficam `WAITING_VALIDATION`.

Gates locais PASS em Windows 11: desktop 45/45, scripts de release 6/6, typecheck, ESLint, Prettier e build. O aviso de chunk acima de 500 kB permanece o preexistente.

WAITING_VALIDATION: commit `9806a63`, `main` e tag `v0.2.21` enviados. Workflow 41954982856 PASS; instalador 10m48s e publicação concluída. Release pública com quatro assets; download conferido contra `SHA256SUMS` (`421168734f39504b77ae887df2ea82b956bab8f7c640ce632870b54a2a2d65b4`) e `latest.json` consistente. Falta instalar e validar atualização 0.2.20 → 0.2.21 em Windows real.

## F07-14 — Release 0.2.20

READY → IN_PROGRESS em 2026-11-04, por pedido explícito do usuário. Escopo: três correções visuais F04-05 feitas após a 0.2.19, registros, quatro manifests em `0.2.20`, commit/push na `main`, tag `v0.2.20` e publicação pelo workflow. Gates locais: desktop, scripts de release, typecheck, lint, formatação e build; depois conferir os quatro assets publicados. Instalação e atualização reais ficam `WAITING_VALIDATION`.

Gates locais PASS em Windows 11: desktop 45/45, scripts de release 6/6, typecheck, ESLint, Prettier e build. O aviso de chunk acima de 500 kB permanece o preexistente.

WAITING_VALIDATION: commit `1794bb4`, `main` e tag `v0.2.20` enviados. Workflow 41945056162 PASS; instalador 8m20s e publicação concluída. Release pública com quatro assets; download conferido contra `SHA256SUMS` (`f448ddb9d3392640e426d212b3b9f2273b116d3fba677a595755d3e9351ca9ca`) e `latest.json` aponta para versão, URL e assinatura corretas. Falta instalar e validar atualização 0.2.19 → 0.2.20 em Windows real.

## F07-13 — Release 0.2.19

READY → IN_PROGRESS em 2026-11-04, por pedido explícito do usuário. Escopo: correção visual F04-05 no rodapé lateral e nos pares ícone/chevron do dock, registros, quatro manifests em `0.2.19`, commit e push na `main`, tag `v0.2.19` e publicação do instalador pelo workflow. Gates locais: testes do desktop, scripts de release, typecheck, lint, formatação e build. Instalação e atualização reais ficam `WAITING_VALIDATION`.

Gates locais PASS em Windows 11: desktop 45/45, scripts de release 6/6, typecheck, ESLint, Prettier e build. O aviso de chunk acima de 500 kB permanece o preexistente.

WAITING_VALIDATION: commit `ed7038a`, `main` e tag `v0.2.19` enviados. Workflow 41911229682 PASS (`windows-installer` 10m41s e publicação 19s). Release pública com quatro assets; download do instalador conferido contra `SHA256SUMS` (`f09ef7cd4526c2b6d3464b62e0f68ae1366723aa7952a8586aeb1c7b54053abd`) e `latest.json` aponta para versão, URL e assinatura corretas. Falta instalar e validar atualização 0.2.18 → 0.2.19 em Windows real.

## F07-12 — Release 0.2.18

READY → IN_PROGRESS em 2026-11-04. Retomar versão deixada pelo Claude sobre 093699b, por pedido do usuário. Branch `codex/F07-12-release-0.2.18`. Arquivos: quatro manifests de versão do desktop, teste de anexos, PLAN.md, este plano e HISTORY.md. Validar testes de release, anexos/permissões, CI e artefatos publicados. CI do merge falhou porque attachments.test.ts ainda esperava 409 para upload em sala de voz, agora permitido pelo ADR 0031. Instalação e atualização em máquina real ficam WAITING_VALIDATION.

WAITING_VALIDATION: testes locais 20/20 e scripts de release 6/6 PASS; CI 41898690823 e CI da tag 41899548742 completos PASS. Main e tag `v0.2.18` enviadas em 6734f70. Publicação PASS: https://github.com/dennerstorres/openmeet/actions/runs/41899548934. Release https://github.com/dennerstorres/openmeet/releases/tag/v0.2.18 com quatro assets; download verificado contra SHA256SUMS, versão/URL/assinatura referenciada no manifest consistentes. Falta instalar e validar atualização 0.2.17 → 0.2.18 em Windows real.

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
