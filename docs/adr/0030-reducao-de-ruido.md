# ADR 0030 — redução de ruído do microfone com RNNoise local

Data: 2026-11-04. Estado: aceito pelo usuário em 2026-11-04.

## Contexto

O ADR 0029 deixou a F15-05 condicionada a um ADR próprio, por causa da dependência nova, do WASM e da licença. O `noiseSuppression` do navegador ajuda pouco com teclado e ventilador. O Krisp do LiveKit é pago e fica fora pela regra de não usar SaaS.

## Decisão

- Usar `@sapphi-red/web-noise-suppressor` 0.4.1 (MIT, versão fixa), que traz o RNNoise (BSD-3-Clause) compilado em WASM, com variante SIMD.
- O worklet e os dois `.wasm` ficam em `apps/desktop/public/media/rnnoise/`, servidos pela própria origem. O processamento roda só no aparelho; o áudio não vai a nenhum serviço.
- Grafo do microfone: fonte → RNNoise → efeito de voz → ganho → portão → faixa publicada. O rádio e o áudio do PC não passam por ele.
- Opção "Reduzir ruído do microfone" nos ajustes, desligada por padrão e salva neste aparelho. Troca sem republicar a faixa.
- Se o `AudioContext` não estiver a 48 kHz, ou se o worklet falhar, a voz segue sem a redução e aparece um aviso.
- A CSP não muda: `wasm-unsafe-eval` já existe por causa do ADR 0016, e o `connect-src 'self'` cobre o download do WASM.

## Riscos

- Mais CPU no microfone, que precisa ser medida em PC fraco e celular.
- O filtro do navegador continua ligado junto, e o efeito somado precisa ser ouvido.
- Contexto a 44,1 kHz (alguns fones Bluetooth) não tem a redução.
- Atualizar a biblioteca exige copiar de novo os arquivos de `public/media/rnnoise/`.
