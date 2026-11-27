# Fase 17 — diagnóstico e otimização da qualidade do compartilhamento de tela

Aberta em 2026-11-27 na branch `audit/F17-screen-quality`, a partir da `main` em `b111b88`. O sintoma relatado no `.exe` Windows é texto borrado de forma intermitente, nitidez que muda durante o compartilhamento e a impressão de que o navegador fica melhor. O proprietário está de férias: nada aqui depende de chamada com a equipe, e nenhuma conclusão sobre qualidade real vem de teste simulado.

Relação com outras fases: continua a F15 (ADR 0029) e não altera escopo, IDs nem documentos da F16 (mobile, PR #2, ainda aberto e não integrado na `main` em 2026-11-27). Esta branch não contém os arquivos da F16. Depois do merge do PR #2, rebasear esta branch na `main`. Os conflitos previstos são só de texto, em `PLAN.md`, `HISTORY.md` e `orchestration/QUALITY_GATES.md` (G16 e G17 no fim da lista), e a resolução mantém os dois blocos integralmente. `SPEC.md` não foi alterado: a F17 não cria funcionalidade, então não colide com o item 25 e os RF-28 a RF-31 da F16.

Relatório técnico: [`docs/reviews/F17-codex-audit.md`](../docs/reviews/F17-codex-audit.md). Gate: **G17** em `orchestration/QUALITY_GATES.md`.

| ID | Tarefa | Estado | Depende | Responsável | Gate |
|---|---|---|---|---|---|
| F17-01 | Auditoria técnica do pipeline (captura → codificação → transporte → seleção de camada → decodificação → render), navegador × WebView2 | IMPLEMENTED | — | Claude (auditor) | G17 |
| F17-02 | Instrumentação e métricas por track (envio e recepção, layout, DPR), consentida e limitada | IMPLEMENTED | F17-01 | Claude | G6,G17 |
| F17-03 | Bancada reproduzível: analisador de traço, fixtures de cenário e relatório offline | IMPLEMENTED (parcial: sem SFU local automatizado) | F17-02 | Claude | G17 |
| F17-04 | Experimentos de codec, resolução, simulcast, `contentHint` e qualidade explícita | IMPLEMENTED (interruptores); experimentos NOT_RUN | F17-02 | Claude + Humano | G17 |
| F17-05 | Investigação de `adaptiveStream`, `dynacast` e `pixelDensity` | IMPLEMENTED (interruptores); experimentos NOT_RUN | F17-02 | Claude + Humano | G17 |
| F17-06 | Correções comprovadas e testes de regressão | PENDING (sem correção de padrão até haver evidência de F17-04/05) | F17-04,F17-05 | Grok | G4,G17 |
| F17-07 | Revisão técnica independente do diff e do relatório | APPROVED (três leituras Codex; veredito final Sim, exceto F17-08; limitações aceitas documentadas) | F17-01..F17-05 | Codex | G17 |
| F17-08 | Validação manual posterior no `.exe` e no navegador | WAITING_VALIDATION | F17-07 | Humano | G17 |

## F17-01 — auditoria

Escopo: `screen-quality.ts`, `room-options.ts`, `session.ts`, `stats.ts`, `Cards.tsx`, `MeetingApp.tsx`, `App.css` e o código do `livekit-client` 2.23.0 que os consome. Aceite: cada achado tem arquivo e linha e é classificado como **confirmado** (lido no código) ou **hipótese** (depende de medição). Resultado no relatório.

## F17-02 — instrumentação

Escopo: `packages/media/src/screen-trace.ts` (novo), campos extras em `stats.ts`, coleta a cada 2 s em `session.ts` enquanto conectado e `noteScreenView` chamado por `MeetingApp.tsx`.

Cada amostra é por track (envio ou recepção). Ela registra a resolução pedida e a efetiva, o codec, o bitrate real por delta, o bitrate alvo e a banda estimada, o FPS e o tempo limitado por CPU ou banda. Registra também o `contentHint` efetivo, a implementação do encoder/decoder, perdas, frames descartados, congelamentos, PLI, o tamanho do elemento e o `devicePixelRatio`. Cada troca de layout, tela cheia ou foco na tela gera um registro de visão. Limites: 240 amostras e 60 visões, com o mais antigo descartado primeiro. Fica só em memória e só entra no JSON depois do consentimento já existente. Não há mídia, nome, SDP, IP, SSRC nem trackSid; o receptor é um índice local.

Aceite: testes de parser, deltas, contador reiniciado, limites e exportação sem consentimento. O timer não mantém processo vivo.

## F17-03 — bancada

Implementado: `analyzeScreenTrace` (puro) separa as hipóteses: fração do tempo limitado por CPU ou banda, envio abaixo do pedido, `contentHint` trocado, quadros recebidos menores que o elemento em pixels físicos e trocas de resolução recebida. Há fixtures de três cenários em `packages/media/test/screen-f17.test.ts` e `scripts/screen-trace-report.mjs`, que compara exportações do `.exe` e do navegador lado a lado, offline.

Não implementado nesta rodada: execução automatizada com `livekit-server --dev` local e Chromium com captura falsa (`--use-fake-ui-for-media-stream`, `--auto-select-desktop-capture-source`). Fica descrito no relatório como próximo passo. A bancada simulada **não** prova qualidade no WebView2.

## F17-04 / F17-05 — experimentos

Ativação: chave local `openmeet.screenExperiment` (em `localStorage`, no aparelho de quem testa), com **uma variável por vez**. Combinação, valor desconhecido ou chave ausente significam produção. O rótulo vai no diagnóstico (`screenExperiment`). Valores aceitos:

`codec=vp8|vp9|h264`, `simulcast=on|off`, `resolution=1080p15|1440p15`, `contentHint=detail|text`, `adaptiveStream=on|off`, `dynacast=on|off`, `pixelDensity=screen`, `focusQuality=high` (este desliga `adaptiveStream` e fixa a camada alta da tela remota).

Aceite: sem experimento, as opções de publicação e de sala são idênticas às do ADR 0029 (teste). Cada experimento muda só o próprio parâmetro (teste). A execução real fica NOT_RUN até a F17-08.

## F17-06 — correções

Não há mudança de padrão de produção nesta rodada. Os candidatos estão priorizados no relatório. Cada um só entra com a evidência da exportação e com teste.

## F17-07 — revisão

Revisor independente lê o diff de `audit/F17-screen-quality` e confere cada linha citada no relatório contra o `livekit-client` 2.23.0. Também avalia privacidade da telemetria (G6) e o risco de regressão em câmera e áudio.

Resultado (2026-11-27): três leituras e três confirmações curtas do Codex, registradas em [`F17-codex-review.md`](../docs/reviews/F17-codex-review.md). Veredito final: G17 pode ser aprovado, exceto F17-08. Limitações aceitas (não bloqueantes): pedido de resolução por sessão, `getStats` antigo em voo após o stop, `rtpId` ausente no contador, numeração foco × track e reserva VP8 não medida.

## F17-08 — validação manual

Roteiro no relatório (seção "Homologação manual"). Exige dois PCs, ou um PC com `.exe` e navegador, e o SFU real. Permanece `WAITING_VALIDATION` até a execução humana.

## Verificações desta rodada

Ver `HISTORY.md` (2026-11-27, F17) e o relatório.
