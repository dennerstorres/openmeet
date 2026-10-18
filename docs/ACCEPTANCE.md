# Critérios de aceite e classificação

Evidência aceita: commit/PR, logs sanitizados, execução CI, vídeo ou checklist humano com plataforma, data e passos. Não inventar aprovação.

- A01: build `.exe`/instalador Windows em máquina sem toolchain dev.
- A02: autenticação HTTPS com conta independente por instância.
- A03: usuário sem room access recebe 403 e não recebe token LiveKit válido.
- A04: dois Windows em redes diferentes fazem chamada bidirecional de áudio.
- A05: cinco participantes com câmera/microfone permanecem 60 minutos sem falha fatal.
- A06: usuário compartilha monitor e janela escolhidos e para sem publicação residual.
- A07: mute da publicação e mute/volume apenas local para participante remoto.
- A08: desconectar rede por 5s exibe estado e recupera chamada quando rede volta.
- A09: trocar microfone/câmera durante reunião não exige criar nova room.
- A10: logs exportados não contêm tokens, credenciais ou conteúdo de mídia.
- A11: deploy numa VPS limpa restaura banco e funciona após reinicialização.
- A12: checksums/release e documentação de firewall, TLS, limites e requisitos.

## Metas homologáveis
- Entrada p95 <= 5s em rede estável e autenticada.
- Reconexão p95 <= 15s após 5s de perda de rede, com servidor disponível.
- Testar cinco usuários, 60 minutos; publicar condições de hardware, codec, resolução, rede, CPU e BW.

Status: `NOT_RUN`, `PASS`, `FAIL`, `BLOCKED`. Nenhum item passa por inferência.
