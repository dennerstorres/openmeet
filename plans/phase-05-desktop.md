# Fase 05 — desktop

Objetivo: Integração Windows em background.

## Execução
F05-01 ficou `IMPLEMENTED` em 2026-10-18, com a F04-04 ainda em `WAITING_VALIDATION`. Fechar a janela esconde o aplicativo; sair é pelo menu da bandeja. Os atalhos `Ctrl+Shift+Alt+M`, `+C` e `+O` só registram depois do consentimento, e um atalho já em uso fica de fora. O refresh da sessão vai para o cofre do Windows. A notificação avisa mute ou câmera quando a janela está oculta.

## Critério de saída
Tray/atalhos sem interrupções, build empacotado testado. A bandeja não foi clicada. O instalador continua na F07.

## Observação
Não concluir fase por implementação superficial ou mocks. Dependências externas e validações reais precisam de evidência ou status WAITING_VALIDATION.
