# OpenMeet

Cliente desktop Windows para reuniões de áudio, vídeo e tela, com servidor próprio. Cada instalação é uma instância independente. Não há conta global.

O repositório permanece privado até o mantenedor decidir publicar.

## Servidor

A stack de um nó está em `infra/compose`: API, PostgreSQL 17.6, LiveKit v1.13.10 e Caddy 2.10.2. O operador precisa de Docker, dois nomes DNS e UDP liberado para a mídia.

```
node infra/compose/host.mjs --api-domain api.exemplo.com --livekit-domain livekit.exemplo.com --up
```

O script grava `infra/compose/.env` e o YAML do LiveKit fora do Git. Na primeira vez mostra o `BOOTSTRAP_TOKEN` uma vez. Esse token entra na tela para criar o administrador. Os outros segredos ficam só no arquivo. O passo a passo está em `docs/DEPLOYMENT.md`.

## Aplicativo Windows

O instalador é NSIS, por usuário, sem assinatura. Quem participa não precisa de Node nem de Rust. O build está em `docs/RELEASE.md`. Nenhuma tag `v*` foi publicada, então ainda não há download pronto.

Na primeira abertura, a pessoa cola o endereço HTTPS da API e entra com o usuário daquela instância.

## Desenvolvimento

Node.js LTS, pnpm, Rust e Docker. O contrato dos agentes está em `AGENTS.md`. Requisitos em `SPEC.md`, tarefas em `PLAN.md`.

## Licença

Apache-2.0. Veja `LICENSE` e `NOTICE`.
