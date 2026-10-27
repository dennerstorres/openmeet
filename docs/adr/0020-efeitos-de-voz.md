# ADR 0020 — efeitos de voz no microfone

Data: 2026-10-26. Estado: aceito pelo usuário em 2026-10-26.

## Decisão

O participante escolhe um efeito de voz num painel dos ajustes. O efeito é aplicado no próprio aparelho, antes de publicar o microfone, e todos na sala ouvem a voz já modificada. Nenhum áudio vai para API, CDN ou serviço de processamento; não há dependência paga nem SaaS.

O efeito entra no mesmo `TrackProcessor` do volume de entrada (`InputGain`, F04-05), porque o LiveKit aceita um processor por faixa. A cadeia fica: captura com cancelamento de eco e ruído do navegador → efeito → ganho → publicação. O efeito vem depois do cancelamento para não atrapalhar o eco nem o ruído.

Efeitos iniciais:
- Nós nativos do Web Audio: Robô, Rádio, Telefone, Eco e Caverna.
- `AudioWorklet` próprio de pitch shift: Grave, Esquilo e Monstro. Adiciona cerca de 20–40 ms de latência.

O efeito nasce desligado em toda entrada na sala e não fica salvo. Troca de efeito vale na hora, no mesmo processor, sem republicar o microfone. Troca de dispositivo, mute e reconexão preservam o efeito escolhido. O áudio do compartilhamento de tela não passa pela cadeia.

"Ouvir minha voz" toca a saída processada só neste aparelho, com aviso para usar fone por causa da microfonia. Desliga sozinho ao fechar o painel.

## Segurança e compatibilidade

O módulo do worklet é um arquivo do bundle servido pela mesma origem, coberto por `script-src 'self'`. Sem `blob:`, sem `unsafe-eval` e sem mudança na CSP do `.exe` nem da web.

Sem `AudioWorklet`, os efeitos de pitch somem da lista e os outros seguem. Falha no efeito volta para a voz normal com aviso, sem derrubar o microfone nem a reunião.

Qualidade, latência e CPU só valem com microfone real em WebView2, Chrome, Edge e Firefox. Teste unitário prova o grafo e o ciclo de vida, não o som.

## Fora do escopo

Efeito por participante remoto, efeitos enviados por outra pessoa, gravação, upload de impulso de reverb, modelo de IA de troca de voz e avisar a sala de que um efeito está ativo.
