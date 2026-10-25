# ADR 0016 — blur local do fundo da câmera

Data: 2026-10-23. Estado: aceito pelo usuário, implementação em `WAITING_VALIDATION`.

## Decisão

O cliente pode aplicar blur moderado ao fundo da câmera antes de publicar a faixa no LiveKit. O efeito usa `@livekit/track-processors` e MediaPipe no próprio aparelho; nenhum quadro é enviado a API, CDN ou serviço de processamento. O runtime WebAssembly e o modelo de segmentação ficam no bundle e são servidos pela mesma origem.

A opção nasce desligada. Cliente incompatível mantém a câmera normal e informa que o efeito não está disponível. Ao trocar dispositivo, o processor acompanha a faixa reiniciada pelo SDK; se uma faixa nova for criada, o cliente reaplica a preferência. Falha no processor não impede desligar o efeito nem deve derrubar a reunião.

## Adendo 2026-10-25 — intensidade (F04-08)

O usuário escolhe o raio do blur entre 2 e 30 px; 10 continua o padrão. Só o raio fica salvo neste aparelho, o efeito segue nascendo desligado. A troca reaproveita o processor da faixa publicada (`switchTo`), sem republicar a câmera. O teto de 30 px limita custo e preserva o recorte; nada muda na CSP nem no processamento local.

## Segurança e desempenho

WebAssembly exige uma diretiva CSP específica, limitada a `wasm-unsafe-eval`; `unsafe-eval` geral continua proibido. O usuário autorizou essa mudança em 2026-10-23. Modelo e runtime têm aviso Apache-2.0 no bundle e versão fixada no lockfile.

O efeito consome GPU/CPU e bateria. WebView2, Chrome, Edge, Firefox e celular físico exigem prova; testes unitários não aprovam qualidade de recorte, FPS, temperatura nem uso prolongado. A UI avisa o custo local e não promete suporte quando as APIs necessárias faltam.
