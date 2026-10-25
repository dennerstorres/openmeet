# OpenMeet

Reuniões de áudio, vídeo e compartilhamento de tela com servidor próprio: app desktop Windows e cliente web. Cada instalação do servidor é uma instância independente, sem conta global e sem serviço pago obrigatório. A mídia passa pelo LiveKit da própria instância.

## Servidor

A stack de um nó está em `infra/compose`: API, PostgreSQL 17.6, LiveKit v1.13.10 e Caddy 2.10.2. O operador precisa de Docker, dois nomes DNS e UDP liberado para a mídia.

```
node infra/compose/host.mjs --api-domain api.exemplo.com --livekit-domain livekit.exemplo.com --up
```

O script grava `infra/compose/.env` e o YAML do LiveKit fora do Git. Na primeira vez mostra o `BOOTSTRAP_TOKEN` uma vez. Esse token entra na tela para criar o administrador. Os outros segredos ficam só no arquivo. O passo a passo está em `docs/DEPLOYMENT.md`.

## Aplicativo Windows

O instalador NSIS, por usuário, fica na página de Releases do GitHub. Ele não tem assinatura de código do Windows, então o SmartScreen avisa na primeira instalação. A partir dele, o app se atualiza sozinho com pacotes assinados e só instala quando a pessoa confirma (ADR 0018). Quem participa não precisa de Node nem de Rust. O build está em `docs/RELEASE.md`.

Na primeira abertura, a pessoa cola o endereço HTTPS da API e entra com o usuário daquela instância.

## Desenvolvimento

Node.js LTS, pnpm, Rust e Docker. O contrato dos agentes está em `AGENTS.md`. Requisitos em `SPEC.md`, tarefas em `PLAN.md`.

## Licença

Apache-2.0. Veja `LICENSE` e `NOTICE`.
