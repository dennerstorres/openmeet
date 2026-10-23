# Fase 04 — meeting-ui

Objetivo: UI de reunião e controles.

## F04-05 — controles solicitados em 2026-10-23
READY → IN_PROGRESS → WAITING_VALIDATION. Alterados Icons.tsx, MeetingApp.tsx, session.ts de mídia, processor novo, MeetingModel, allowlists web/nativa, serviço/rota de salas e testes. Sol substituído por ajustes; kick só da sala (ADR 0015); ganho de entrada 0–200%. Testes cobrem RBAC negativo, membership preservado, erro do SFU, contrato nativo, processor/restart/cleanup. Comandos e resultados em HISTORY.md. Prova de áudio e desconexão real em dois PCs e revisão independente exigidas antes de DONE.

Ajuste de 2026-10-23: consentimento de atalhos saiu da tela principal e passou para Configurações no menu da conta. Menus de conta e de dispositivos fecham ao clicar fora. O bundle web continua sem shell nem texto de atalhos nativos.

Roteiro pendente: abrir web e instalador; conferir ambos os ícones e menus por teclado; falar entre dois PCs com volume em 0/50/100/200%; trocar microfone, mutar/desmutar, sair/entrar e reconectar; verificar ausência de eco local e áudio da tela inalterado. Como admin membro do servidor, desconectar participante pela sidebar, conferir encerramento da mídia remota e novo ingresso permitido; como participante, chamada direta deve retornar 403. SFU indisponível deve mostrar erro e permitir repetir. Nada disso foi marcado PASS por mock.

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
