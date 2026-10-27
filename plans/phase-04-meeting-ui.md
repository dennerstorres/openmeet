# Fase 04 — meeting-ui

Objetivo: UI de reunião e controles.

## F04-05 — controles solicitados em 2026-10-23
READY → IN_PROGRESS → WAITING_VALIDATION. Alterados Icons.tsx, MeetingApp.tsx, session.ts de mídia, processor novo, MeetingModel, allowlists web/nativa, serviço/rota de salas e testes. Sol substituído por ajustes; kick só da sala (ADR 0015); ganho de entrada 0–200%. Testes cobrem RBAC negativo, membership preservado, erro do SFU, contrato nativo, processor/restart/cleanup. Comandos e resultados em HISTORY.md. Prova de áudio e desconexão real em dois PCs e revisão independente exigidas antes de DONE.

Ajuste de 2026-10-23: consentimento de atalhos saiu da tela principal e passou para Configurações no menu da conta. Menus de conta e de dispositivos fecham ao clicar fora. O bundle web continua sem shell nem texto de atalhos nativos.

## F04-06 — blur de fundo da câmera
READY → IN_PROGRESS → WAITING_VALIDATION em 2026-10-23. Entregue: sem efeito/blur moderado, processamento só no cliente, assets MediaPipe empacotados, compatibilidade detectada, preservação ao trocar câmera e erro visível. A CSP `wasm-unsafe-eval`, sem `unsafe-eval` de JavaScript, foi autorizada pelo usuário. Testes cobrem ciclo do processor, troca de track e incompatibilidade; typecheck/lint/build e CSP passam. Falta câmera real em desktop/web/celular. Não tratar teste sem câmera como prova visual nem de desempenho.

## F04-08 — intensidade do blur de fundo
READY → IN_PROGRESS → WAITING_VALIDATION em 2026-10-25. Alterados `video-background.ts`, `session.ts` e `index.ts` de mídia, `MeetingApp.tsx`, `PocApp.tsx` e o teste do processor. Slider "Intensidade do desfoque" (raio 2–30 px, padrão 10) logo abaixo da opção de blur; valor salvo em `localStorage` (`openmeet.blurRadius`), o efeito continua nascendo desligado. Com o blur ligado, a troca chama `switchTo` no mesmo processor e não republica a faixa. Teste cobre limite, valor salvo, troca sem novo processor e ajuste com efeito desligado. Falta prova humana: câmera real em desktop e web, mexer no slider durante a chamada e conferir que o outro lado vê a mudança sem queda de vídeo.

Roteiro pendente: abrir web e instalador; conferir ambos os ícones e menus por teclado; falar entre dois PCs com volume em 0/50/100/200%; trocar microfone, mutar/desmutar, sair/entrar e reconectar; verificar ausência de eco local e áudio da tela inalterado. Como admin membro do servidor, desconectar participante pela sidebar, conferir encerramento da mídia remota e novo ingresso permitido; como participante, chamada direta deve retornar 403. SFU indisponível deve mostrar erro e permitir repetir. Nada disso foi marcado PASS por mock.

## F04-09 — efeitos de voz no microfone
READY → IN_PROGRESS → WAITING_VALIDATION em 2026-10-26, branch `task/F04-09-efeitos-de-voz`. Entregue: `voice-effects.ts` (grafo por efeito), `InputGain` com efeito → ganho e monitor, worklet em `apps/desktop/public/media/pitch-shift-worklet.js`, `setVoiceEffect`/`setVoiceMonitor` na sessão, seletor e "Ouvir minha voz" nos ajustes; o monitor desliga ao fechar o painel e o efeito volta a "Sem efeito" ao desconectar. Teste do worklet em tom de 440 Hz confere o pitch com tolerância de 8%: o crossfade gera bandas laterais na taxa do grão, o que pode soar levemente trêmulo na voz real.

Arquivos previstos: `input-gain.ts` vira cadeia de áudio (efeito → ganho) ou ganha um módulo `voice-effects.ts` chamado por ele; worklet de pitch em `packages/media/src/worklets/`; `session.ts` e `index.ts` de mídia; painel em `MeetingApp.tsx`; testes em `packages/media/test/`.

Escopo: Desligado, Robô, Rádio, Telefone, Eco, Caverna, Grave, Esquilo e Monstro. Troca no mesmo processor, sem republicar. Nada salvo; nasce desligado. "Ouvir minha voz" local, com aviso de fone, desligado ao fechar o painel. Sem `AudioWorklet`, esconder os efeitos de pitch. Erro no efeito volta para voz normal com aviso.

Testes automatizados: grafo montado por efeito; troca sem novo processor; reinício do grafo na troca de dispositivo mantém o efeito; destruir libera nós e worklet; ganho continua valendo com efeito; ausência de `AudioWorklet` filtra a lista; falha do worklet cai para Desligado. Typecheck, lint, format:check, build desktop e web; CSP sem mudança.

Prova humana antes de DONE: dois PCs, cada efeito ouvido do outro lado no `.exe` e na web (Chrome, Edge, Firefox); latência percebida nos efeitos de pitch; sem eco com alto-falante; mute, troca de microfone e reconexão mantêm o efeito; áudio da tela sem efeito; CPU aceitável em 10 min com efeito ligado.

## F04-10 — biblioteca de sons do servidor
READY → IN_PROGRESS → WAITING_VALIDATION em 2026-10-26, branch `task/F04-10-biblioteca-de-sons`, em três commits (API; ponte e mídia; UI). Entregue: `sound.ts` em shared (validador e codificador WAV), migration `0009_sounds.sql`, `rooms/sounds.ts` e rotas, `instance_sound` no Rust, `fetchSound` web/nativo, chamadas no `MeetingModel`, portão de voz e barramento de sons no `InputGain`, `playSound`/`stopSound`/`setSoundVolume` na sessão e `sounds.tsx` (biblioteca do servidor da chamada, envio, importar e apagar com dois cliques). Renomear existe na API e não tem tela. Durante o som com mic mutado, o próprio botão do mic aparece ligado. Grande: dividir em commits de API, ponte nativa, mídia e UI.

Arquivos previstos: migration `0009` (`sound`, `server_sound`); rotas de sons no servidor com testes de permissão; leitor/validador WAV em `packages/shared`; rotas na lista fechada do Rust (F10-18) e no cliente web; `packages/media/src/sound-board.ts` (conversão para WAV 24 kHz mono, tocar/parar, ganho do painel); `input-gain.ts` com a entrada dos sons e a voz em zero para tocar mutado; painel em `MeetingApp.tsx`.

Escopo: listar a biblioteca do servidor, subir, renomear o próprio som, tocar, parar, importar o próprio som para outro servidor, tirar da biblioteca (dono do som, dono e moderadores do servidor) e apagar de vez (dono do som). Volume do painel salvo neste aparelho. Mutado, a faixa abre só durante o som com a voz em zero.

Testes automatizados: WAV fora do formato, cabeçalho mentiroso, dados truncados, mais de 20 s e nome com controle/bidi recusados; não membro não lista nem baixa; importar som alheio ou para servidor sem membership dá 403; moderador tira mas não apaga de vez; apagar de vez some das duas bibliotecas; limite de upload por tempo; conversão no cliente gera WAV válido e corta acima de 20 s com erro; tocar corta o anterior; som fora do efeito e do ganho do mic; mutado desmuta, zera a voz e remuta ao fim e ao Parar; troca de dispositivo não deixa som órfão. Typecheck, lint, format:check, `cargo test`, builds desktop e web; CSP sem mudança.

Prova humana antes de DONE: migration em implantação real; dois PCs no `.exe` e na web; som ouvido do outro lado com mic aberto e mutado; voz não vaza durante som mutado; indicador de mic volta ao estado anterior; importar para outro servidor e tocar lá; moderador remove; alto-falante sem eco do próprio som.
## F04-11 — rádio da sala
READY em 2026-10-26 com o aceite do ADR 0022. Depende de F04-09.

Arquivos previstos: `packages/media/src/radio.ts` (captura sem filtros, preset de música, publicação como `screen_share_audio` com nome `openmeet-radio`), `session.ts` (ligar, trocar entrada, desligar, exclusão com áudio do PC, fim ao sair), `layout.ts` (card do rádio separado do áudio da tela), volume e mute locais por card em `playback.ts`, controles em `MeetingApp.tsx` e `Cards.tsx`; testes em `packages/media/test/`.

Escopo: escolher entrada, ligar e desligar o rádio, trocar entrada com ele ligado, card "Rádio de <nome>" com volume 0–100% e mute locais, ensurdecer cala o rádio, aviso de direito autoral e de eco ao ligar, aviso quando a entrada for a mesma do microfone. Rádio e áudio do PC do compartilhamento se excluem.

Testes automatizados: captura pede `deviceId` exato e desliga eco, ruído e ganho automático; publica com fonte e nome certos e preset de música; desligar despublica e para a captura; sair da sala e desconexão encerram; ligar rádio com áudio do PC ligado desliga um deles com aviso; faixa remota `openmeet-radio` vira card de rádio e não card de tela; volume e mute do card não mexem no microfone nem no áudio da tela; diagnóstico sem nome de dispositivo. Typecheck, lint, format:check, builds desktop e web; grant e CSP sem mudança.

Prova humana antes de DONE: dois PCs no `.exe` e na web; VB-Audio Cable e mixagem estéreo listados; música estéreo ouvida do outro lado; volume e mute locais; sair encerra; LiveKit real aceita rádio e compartilhamento com áudio sem confundir faixas; rede ruim sem cortar a voz.

## Execução
Consultar as tarefas `F04-*` em `PLAN.md`, seus pré-requisitos e os quality gates. Dividir implementações em pequenos commits e evidenciar testes.

## Critério de saída
M09, A05-A07 e 60 min com cinco pessoas.

## F04-01
A janela padrão confirma `GET /api/v1/instance` antes de enviar senha. Login, bootstrap, salas e entrada usam só essa origem. Sair da sala volta à lista. A prova de mídia fica em `?poc=1`. O ADR 0005 libera `https:` e `wss:` na CSP. O refresh fica na memória do processo, separado por origem, e some ao reiniciar: o cofre nativo ainda não foi avaliado. Controles de mídia ficam na F04-02. A fase não fecha aqui.

## F04-02
Na reunião, o microfone e a câmera ligam e desligam a publicação. O volume e o silêncio de cada áudio remoto mudam só o elemento neste PC. A falha do controle aparece na tela. A janela não foi aberta. A fase não fecha aqui.

## F04-03
A reunião tem o botão de compartilhar e o de parar. Compartilhar abre o seletor; parar encerra a publicação em vez de trocar a origem. A tela compartilhada fica em destaque e as câmeras ficam na grade. O aviso diz monitor, janela ou guia. O áudio do sistema continua desligado. A janela não foi aberta. A fase não fecha aqui.

## F04-04
A reunião troca microfone, saída e câmera sem criar outra sala. O relógio segue na reconexão e zera ao sair ou numa falha fatal. As métricas aparecem a cada 5 s. Sair de uma sala persistente deixa essa sala na lista do mesmo cliente. A janela não foi aberta. Os 60 min com cinco pessoas não rodaram. M09, M11 e A05 seguem sem PASS. A fase não fecha aqui.

## Observação
Não concluir fase por implementação superficial ou mocks. Dependências externas e validações reais precisam de evidência ou status WAITING_VALIDATION.
