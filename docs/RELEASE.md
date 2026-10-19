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
