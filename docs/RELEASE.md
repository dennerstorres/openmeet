# Instalador Windows

O bundle é NSIS, instalado por usuário, sem assinatura. A versão sai de `apps/desktop`. O workflow `.github/workflows/release.yml` roda por `workflow_dispatch` ou numa tag `v*`. O artefato leva o `setup.exe` e `SHA256SUMS`. Só a tag cria o GitHub Release. Nenhuma tag foi enviada.

Build local, com Rust 1.98.1:

```
pnpm --filter @openmeet/shared --filter @openmeet/media build
pnpm --filter @openmeet/desktop exec tauri build --bundles nsis
node scripts/installer-checksum.mjs apps/desktop/src-tauri/target/release/bundle/nsis
```

O instalador baixa o WebView2 quando a máquina não tem esse runtime. A máquina de destino não precisa de Node nem de Rust. Instalar numa máquina sem a toolchain de desenvolvimento continua sem evidência. O arquivo não é assinado, então o Windows pode avisar.

Firewall, TLS e backup estão em `docs/DEPLOYMENT.md`. Os limites de autenticação estão em `docs/ENVIRONMENT.md`.

## Atualização automática (ADR 0018)

O app checa `latest.json` da última GitHub Release do repositório que publicou (o endpoint entra só na build da release; uma build local não checa nada) ao abrir e a cada 6 horas, e só instala quando a pessoa confirma, fora de chamada. O workflow `release` assina o instalador e gera `*-setup.exe.sig` e `latest.json`.

Secrets do repositório, obrigatórios para a release:

- `TAURI_SIGNING_PRIVATE_KEY`: conteúdo da chave privada do updater.
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: senha dessa chave.

A chave pública fica em `apps/desktop/src-tauri/tauri.conf.json` (`plugins.updater.pubkey`). A privada nunca entra no Git. Perder a chave obriga reinstalação manual com uma chave nova. Uma build local sem `createUpdaterArtifacts` continua funcionando sem a chave.

A tag precisa ser `v` + a versão do `tauri.conf.json`; o workflow recusa divergência.
