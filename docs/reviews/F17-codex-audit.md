# F17 — auditoria da qualidade do compartilhamento de tela

Data: 2026-11-27. Branch `audit/F17-screen-quality` (worktree isolada, sem push), base `main` `b111b88` (0.2.25). Auditor: Claude, executando o pedido de auditoria da F17. O nome do arquivo segue o que o pedido definiu. Escopo e tarefas: [`plans/phase-17-screen-quality.md`](../../plans/phase-17-screen-quality.md).

Nenhuma chamada real foi feita. Tudo que depende de SFU, WebView2 ou rede real está marcado como **hipótese** ou **NOT_RUN**.

## 1. Diagnóstico resumido

O pipeline atual (ADR 0029/F15) publica a tela em **VP9 com uma única camada espacial (L1T3)**, com reserva VP8, 1440p30 a até 4 Mbps e `maintain-resolution`. Quem recebe usa `adaptiveStream` + `dynacast`, e o jitter buffer da tela é zero.

A leitura do código do `livekit-client` 2.23.0 mostra um fato que contradiz o objetivo do perfil "Texto nítido". **O SDK sobrescreve o `contentHint` da tela para `motion` sempre que publica VP9.** Isso tira o encoder do Chromium do modo de conteúdo de tela, justamente o modo que refina áreas estáticas, como texto, até ficarem nítidas.

Somado a `maintain-resolution` e à estimativa de banda que oscila, o resultado esperado é o sintoma relatado: a resolução fica, mas o quantizador sobe e desce, e o texto alterna entre borrado e nítido. Esse é o **mecanismo mais provável**. O efeito visual ainda precisa ser medido (F17-04, experimento `contentHint` e `codec`).

A diferença entre o `.exe` e o navegador **não tem causa confirmada no código**: WebView2 e Edge usam o mesmo Chromium e a mesma configuração de mídia, e o Tauri não passa argumentos extras ao WebView2. As hipóteses estão na seção 3, e a telemetria nova foi feita para separá-las.

## 2. Problemas confirmados (lidos no código)

| # | Achado | Onde | Efeito |
|---|---|---|---|
| C1 | Com VP9 sem simulcast SVC, a tela recebe `scalabilityMode = 'L1T3'` e o SDK força `mediaStreamTrack.contentHint = 'motion'`, com o comentário de que o caminho de tela do Chrome com L1T3 limita a 5 fps. O `contentHint: "detail"` pedido em `screenCapture` é descartado na publicação. | `livekit-client/dist/livekit-client.esm.mjs:33150-33168`; pedido em `packages/media/src/screen-quality.ts:45`, codec em `:54` | O perfil "Texto nítido" nunca chega ao encoder como conteúdo de tela; a única diferença real entre os perfis é resolução/FPS/bitrate/degradação. |
| C2 | Com L1T3 existe **uma** camada espacial: `adaptiveStream` não consegue entregar uma resolução menor ao card pequeno nem trocar para maior ao destacar. Ele só alterna camadas temporais e pausa o track invisível. | SDK `:33150-33171`; `packages/media/src/room-options.ts` | A troca de nitidez ao mudar grade, destaque e tela cheia **não** vem de troca de camada espacial em VP9. Se ela aparecer na medição, vem do encoder (QP/banda) ou de um receptor em VP8 de reserva. |
| C3 | `backupCodec: true` publica VP8 com simulcast **além** do VP9 quando há na sala um receptor que não decodifica VP9 (Firefox/Safari antigos). | `screen-quality.ts:56`; SDK `:33176-33185` | Nesse caso o emissor codifica duas vezes 1440p: CPU dobra e aumenta a chance de `qualityLimitationReason = cpu`. |
| C4 | `adaptiveStream` sem `pixelDensity` usa densidade **1** quando `devicePixelRatio ≤ 2`. Com Windows a 125–175 %, o SDK pede uma camada dimensionada pelo tamanho CSS, menor que os pixels físicos do card. | SDK `getPixelDensity`, `:16061-16076`; `room-options.ts` | Afeta só os caminhos com camadas espaciais (reserva VP8, `codec=h264`/`vp8`, simulcast). Não afeta o VP9 de produção (C2). |
| C5 | Cada troca de lugar do card (palco ↔ faixa ↔ tela cheia) desmonta o `<video>` e faz novo `attach`. O SDK recalcula a visibilidade e as dimensões a cada `attach`. | `apps/desktop/src/meeting/Cards.tsx:210-220` (`VideoSink`), `:115` (faixa) | Pode haver um instante com dimensões pequenas ou zero até o `ResizeObserver` medir. Com camada espacial, isso pede a camada baixa por um momento. |
| C6 | Com `adaptiveStream` ligado, `setVideoQuality` é recusado (`isManualOperationAllowed`): hoje não existe forma de fixar "alta qualidade" para a tela destacada. | SDK `:34204-34211` | Motivou o experimento `focusQuality=high`, que desliga `adaptiveStream` só nessa execução. |
| C7 | A telemetria anterior cobria só os 15 s iniciais do **envio** (F15-06). Não havia dado do receptor, da resolução decodificada, de perdas, de frames descartados, do tempo limitado nem do layout/DPR. | `packages/media/src/session.ts` (`collectScreenRampSample`) | Sem isso não dá para atribuir a causa. Corrigido na F17-02 (seção 4). |

O render está correto para texto: `.card.share video` usa `object-fit: contain` (`apps/desktop/src/App.css:1603`), sem `transform`, `filter` nem escala CSS no vídeo. O jitter buffer zero (`lowerScreenLatency`, `session.ts:286`) atua só no vídeo da tela. Ele aumenta as travadas sob perda, mas não reduz a nitidez.

## 3. Hipóteses pendentes (precisam da telemetria nova)

| # | Hipótese | Como a exportação separa |
|---|---|---|
| H1 | Texto borrado intermitente = QP alto sob banda oscilante com `contentHint=motion` (C1). | `bandwidthLimitedMsDelta` e `targetBitrateKbps` oscilando, `width/height` estáveis, `contentHint = motion`. Comparar com `contentHint=detail` e `codec=vp8`/`h264`. |
| H2 | No `.exe`, o encoder VP9 roda em software (`libvpx`) e fica limitado por CPU a 1440p30. No navegador da mesma máquina, ou em outra máquina, há margem. | `cpuLimitedShare`, `implementation`, `powerEfficient` no envio do `.exe` × navegador. |
| H3 | Um receptor na sala sem VP9 ativa a reserva VP8 (C3), e o emissor dobra a CPU. | Mais de um codec em `codecs` e `cpuLimited` alto só nessas sessões. |
| H4 | O receptor do `.exe` com escala do Windows > 100 % recebe uma camada menor que os pixels físicos (C4). Só vale para VP8/H.264. | `upscaled > 0` com `devicePixelRatio > 1`; repetir com `pixelDensity=screen`. |
| H5 | Trocas de layout causam queda breve (C5) ou keyframe atrasado por causa do jitter buffer zero. | `screenViews` alinhado com `recvSizeChanges`, `freezeCountDelta`, `pliCountDelta`. |
| H6 | "Melhor no navegador" é efeito de ambiente (outra máquina, outra rede, outra escala) e não do WebView2. | Mesma máquina e mesma rede, uma exportação de cada cliente, lado a lado no `screen-trace-report`. |

## 4. Soluções implementadas nesta rodada

Nenhum **padrão de produção** mudou. Sem experimento ativo, as opções de publicação e de sala são idênticas às do ADR 0029, e há teste que garante isso.

1. **Telemetria por track (F17-02).** O arquivo novo `packages/media/src/screen-trace.ts` coleta a cada 2 s, enquanto conectado, uma amostra do envio local de tela e uma de cada tela remota, com no máximo 240 amostras. O que entra em cada amostra:
   - resolução pedida e efetiva, codec e `contentHint` efetivo (expõe o C1);
   - bitrate real por delta, bitrate alvo e banda estimada;
   - FPS e tempo limitado por CPU ou banda, em ms por intervalo;
   - implementação e eficiência do encoder/decoder;
   - perdas, frames descartados, congelamentos e PLI por intervalo;
   - maior elemento que exibe o track e `devicePixelRatio`.

   `noteScreenView` registra cada troca de layout, tela cheia ou foco na tela, com no máximo 60 registros; é chamado de `MeetingApp.tsx`. Tudo fica só em memória e entra no JSON apenas com o consentimento já existente. Os campos ficam em lista branca; os rótulos de implementação são cortados em 60 caracteres e os de layout em 20. Não entram mídia, nome, SDP, IP, SSRC nem trackSid: o receptor vira um índice local. O timer usa `unref`.
2. **Interruptores de experimento (F17-04/05).** O arquivo `packages/media/src/screen-experiment.ts` aceita uma variável por vez na chave local `openmeet.screenExperiment`. Valores: `codec=vp8|vp9|h264`, `simulcast=on|off`, `resolution=1080p15|1440p15`, `contentHint=detail|text` (reaplicado depois da publicação para desfazer o C1), `adaptiveStream=on|off`, `dynacast=on|off`, `pixelDensity=screen` e `focusQuality=high`. Combinação ou valor inválido equivalem a produção. O rótulo segue no diagnóstico.
3. **Bancada offline (F17-03).** `analyzeScreenTrace` é uma função pura. Há fixtures de três cenários (CPU com hint trocado, upscaling com troca de camada, envio abaixo do pedido) e o script `scripts/screen-trace-report.mjs`, que compara N exportações em uma tabela.

## 5. Testes e verificações

Windows 11, Node via pnpm, 2026-11-27, na worktree `openmeet-F17`:

- `pnpm --filter @openmeet/media test`: **96/96 PASS** (eram 87; +9 em `test/screen-f17.test.ts`).
- `pnpm --filter @openmeet/media typecheck` e `build` PASS; `pnpm --filter @openmeet/desktop typecheck` PASS.
- Workspace: `pnpm format:check`, `lint`, `typecheck`, `build` PASS; `pnpm test` com workspace 27/27, shared 79/79, mídia 96/96 e servidor 128/128. O desktop falhou uma vez em `apps/desktop/test/update.test.mjs:79`, um teste de temporização de 10 ms sem relação com mídia, sob a carga da execução paralela, e passou 50/50 em duas reexecuções isoladas.
- `node scripts/screen-trace-report.mjs <fixture>`: tabela gerada corretamente com um JSON sintético.

Limitações: os testes provam o parser, os deltas, os limites, a privacidade e a não regressão das opções de produção. **Não** provam qualidade visual nem comportamento do WebView2, do SFU ou do encoder. Não houve teste com `livekit-server` local nem Chromium com captura falsa.

## 6. Experimentos disponíveis (uma variável por execução)

| Experimento | Valor | Pergunta |
|---|---|---|
| Produção | (sem chave) | linha de base |
| `contentHint=detail` | reaplica o hint após publicar VP9 | H1: o hint de tela melhora o texto? Observar FPS (o SDK diz que o Chrome limita a 5 fps). |
| `codec=vp8` | VP8 com simulcast de tela | H1/H2 sem SVC, com hint preservado |
| `codec=h264` | H.264 (encoder de hardware provável no Windows) | H2: CPU × nitidez |
| `resolution=1080p15` / `1440p15` | só tamanho e FPS | custo da resolução no encoder |
| `simulcast=off` | sem camadas (relevante com VP8/H.264) | efeito de camadas |
| `adaptiveStream=off` / `dynacast=off` | receptor/emissor | H4/H5 |
| `pixelDensity=screen` | conta o DPR real | H4 |
| `focusQuality=high` | sem adaptiveStream e com camada alta fixa na tela remota | "alta qualidade explícita" |

Para ativar, no DevTools do WebView2 ou do navegador: `localStorage.setItem("openmeet.screenExperiment", "codec=h264")`, depois recarregar e entrar na sala. Para voltar à produção: `localStorage.removeItem("openmeet.screenExperiment")`. As variáveis de sala (`adaptiveStream`, `dynacast`, `pixelDensity`, `focusQuality`) valem no **receptor**. As de publicação valem no **emissor**.

## 7. Possíveis regressões

- A coleta a cada 2 s chama `getStats` em cada track de tela: custo pequeno, mas contínuo durante a chamada. Só roda com tela presente e o buffer é limitado.
- A exportação ficou maior (até cerca de 240 amostras); continua dentro do fluxo consentido.
- Câmera e áudio: nenhuma opção de publicação de câmera ou áudio mudou. `roomOptions` só difere com experimento de sala, que também afeta câmeras e deve ser lido como tal.
- `codec=vp8|h264` desliga `backupCodec`: correto para esses codecs, mas um receptor sem H.264 não veria a tela nessa execução.
- `contentHint=detail` com VP9 pode cair a cerca de 5 fps segundo o próprio SDK. É exatamente o que o experimento mede.

## 8. Recomendações priorizadas

1. **(F17-08, humano)** Rodar a linha de base e `contentHint=detail`, `codec=vp8` e `codec=h264`, cada um no `.exe` e no navegador da **mesma máquina e rede**, e comparar no `screen-trace-report`. É a menor ação que confirma ou descarta H1/H2/H6.
2. **(F17-06, se H1 confirmar)** Escolher o codec por perfil: "Texto nítido" sem SVC (VP8 ou H.264, com hint `detail`) e "Movimento fluido" em VP9. A mudança é reversível, tem teste e depende de ADR complementar ao 0029.
3. **(F17-06, se H2 confirmar)** Reduzir para 1080p15 ou 1440p15 quando `cpuLimitedShare` estiver alto, ou preferir H.264 por hardware.
4. **(F17-06, se H4 confirmar)** `adaptiveStream: { pixelDensity: "screen" }`, medindo o custo extra de banda das câmeras.
5. **(F17-03)** Automatizar a bancada com `livekit-server --dev` local, sem custo, e Chromium headful com captura falsa, para medir regressões de taxa e camada em CI. Não substitui a prova no WebView2.
6. **(F17-07)** Revisão independente antes de qualquer mudança de padrão.

## 9. Homologação manual (F17-08)

Pré-requisitos: `.exe` desta branch (build local) ou navegador apontando para a mesma instância; consentimento de diagnóstico; nada pessoal na tela (usar um documento de texto e um editor de código).

1. **Emissor A** (`.exe`) compartilha a tela inteira com "Texto nítido" por 2 minutos. **Receptor B** (outro PC, ou o navegador) alterna grade → destaque → tela cheia → grade, a cada 20 s.
2. A e B exportam o diagnóstico. Rodar `node scripts/screen-trace-report.mjs a.json b.json`.
3. Repetir o passo 1 com A no navegador da mesma máquina.
4. Repetir os passos 1 e 2 para cada experimento da seção 6, um por vez, sempre removendo a chave antes do próximo.
5. Registrar por execução: nitidez percebida (nota de 1 a 5) em 0–15 s e depois de 60 s, os valores do relatório e a escala do Windows dos dois PCs.
6. Repetir uma vez com rede limitada (Wi-Fi fraco ou limitador do roteador) e uma com um PC fraco.

Critério de saída: uma causa atribuída com dados, de H1 a H6, e uma proposta F17-06 com teste. Enquanto isso não acontecer, F17-08 continua **WAITING_VALIDATION**.

## 10. Pontos para os revisores (F17-07)

- **Grok:** conferir as linhas do SDK citadas em C1–C6 contra `livekit-client` 2.23.0; rodar os experimentos de `codec` na bancada automatizada quando ela existir; preparar F17-06 só depois das exportações.
- **Codex/Claude (revisão independente):** privacidade dos campos novos do diagnóstico (G6/G17); garantir que `roomOptions(null)` e `screenPublish(mode, null)` continuam idênticos ao ADR 0029; avaliar se `noteScreenView` em `MeetingApp.tsx` dispara só nas trocas reais; avaliar o custo do `getStats` periódico.
