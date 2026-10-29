# Licenças de terceiros

Revisão da F08-01, em 2026-10-29, sobre os lockfiles da `main` (`pnpm-lock.yaml` e `apps/desktop/src-tauri/Cargo.lock`). O OpenMeet é Apache-2.0. Nenhuma dependência obriga a trocar essa licença.

## JavaScript (produção)

`pnpm licenses list --prod`: 183 pacotes.

| Licença | Pacotes |
|---|---|
| MIT | 156 |
| Apache-2.0 | 11 (LiveKit, MediaPipe, PGlite, `@swc/helpers`…) |
| BSD-3-Clause | 5 |
| ISC | 5 |
| Apache-2.0 OR MIT | 1 (`@tauri-apps/api`) |
| Apache-2.0 AND BSD-3-Clause | 1 (`@bufbuild/protobuf`) |
| MIT OR GPL | 1 (`machina`, usado sob MIT) |
| Unlicense | 1 (`postgres`) |
| 0BSD | 1 (`tslib`) |
| MPL-2.0 | 1 (`web-push`) |

## Rust (app desktop)

`cargo metadata`: 571 crates. A maioria é `MIT OR Apache-2.0` ou MIT. Também aparecem Unicode-3.0, Zlib, BSD-2/3-Clause, ISC, CC0-1.0, CDLA-Permissive-2.0 (`webpki-root-certs`) e Apache-2.0 com LLVM-exception. `r-efi` oferece LGPL só como uma das alternativas, e usamos MIT/Apache.

## Copyleft fraco (MPL-2.0)

São os pacotes `web-push` (servidor) e `cssparser`, `cssparser-macros`, `selectors`, `dtoa-short` e `option-ext` (Rust, via Tauri). A MPL vale por arquivo. Como esses pacotes são usados sem modificação, o código do OpenMeet continua Apache-2.0. Se um desses arquivos for alterado, o arquivo alterado tem de ser publicado sob MPL-2.0.

## Fora do repositório

O kit Fluent/Teams do Figma (`docs/Teams UI Kit Libraries/`) serviu só de referência visual (ADR 0026). Ele está no `.gitignore` e não é distribuído. A UI usa `@fluentui/react-components` (MIT) e não leva nome, logo nem cor de marca do Teams.

## Como refazer

```
pnpm licenses list --prod
cargo metadata --format-version 1 --manifest-path apps/desktop/src-tauri/Cargo.toml
```

Repita a revisão a cada dependência nova. GPL, AGPL ou SSPL obrigatórias bloqueiam o merge.
