# F16 — matriz de validação real Android/iOS

Estado inicial: **todos NOT_RUN** em 2026-11-22. Evidência exigida pelo [G16](../orchestration/QUALITY_GATES.md) e por [MOBILE_SPEC](MOBILE_SPEC.md).

| ID | Plataforma | Caso / resultado esperado | Estado | Evidência |
|---|---|---|---|---|
| A01 | Android físico | APK inicia, URL HTTPS fixa, sessão mantém isolamento por instância | NOT_RUN | — |
| A02 | Android físico + desktop | Entrar em sala, mic bidirecional, câmera frente/trás | NOT_RUN | — |
| A03 | Android físico | Bloquear tela >=10 min, mic e áudio continuam; encerrar limpa serviço | NOT_RUN | — |
| A04 | Android físico | Bluetooth comunica ida/volta; conectar/remover headset e alternar speaker durante chamada | NOT_RUN | — |
| A05 | Android físico | MediaProjection transmite **outro app**, stop/revogação encerra publicação | NOT_RUN | — |
| A06 | Android físico + desktop | Recebe tela desktop, amplia texto, câmera/grade/fixar | NOT_RUN | — |
| A07 | Android físico | Wi-Fi -> celular -> Wi-Fi, TURN, reconexão e perda de permissão | NOT_RUN | — |
| A08 | Android físico | DMs, salas voz/texto, convites, upload, presença e autorização negativa | NOT_RUN | — |
| I01 | iPhone físico | xtool compila/assina/instala LiveKit POC gratuito | NOT_RUN | — |
| I02 | iPhone físico + desktop | Sala, mic e câmera frente/trás; permissões recusadas têm tratamento | NOT_RUN | — |
| I03 | iPhone físico | Tela bloqueada >=10 min, áudio e microfone, retorno à chamada | NOT_RUN | — |
| I04 | iPhone físico | BT fone com mic e speaker, conectar/remover e interrupção por telefonia | NOT_RUN | — |
| I05 | iOS 27+ físico | ScreenCaptureKit transmite tela inteira/outro app, stop visível | NOT_RUN | — |
| I06 | iOS anterior a 27 físico | ReplayKit Broadcast Extension assinada, compartilhamento externo | NOT_RUN | — |
| I07 | iPhone físico + desktop | Recebe compartilhamento desktop legível e controla zoom/pin | NOT_RUN | — |
| I08 | iPhone físico | Wi-Fi/celular, recuperação, Keychain, login Google, logout e revogação | NOT_RUN | — |
| I09 | iPhone físico | expiração de perfil Personal Team e reinstalação documentada | NOT_RUN | — |
| X10 | Android+iOS+desktop | Chat, voz, vídeo e compartilhamento simultâneos; matriz de 5 participantes/60 min | NOT_RUN | — |
| X11 | Android+iOS+desktop | Diagnóstico consentido sem secrets; permissão insuficiente é recusada pela API | NOT_RUN | — |
| X12 | Android+iOS | Efeitos de voz/blur/sons/rádio e notificações: viável, indisponível ou bloqueado com justificativa explícita | NOT_RUN | — |

## Procedimento para cada teste
- Guardar data, SO/versão, modelo, versão do app, versão do LiveKit, tipo de rede e participantes. Nenhum token, áudio bruto, convite privado ou e-mail em logs.
- Usar sala de teste em instância self-hosted com SFU/TURN real, usuário autorizado, outro cliente (desktop/web) e, para X10, cinco participantes.
- Medir bitrate, FPS/resolução, RTT, jitter, packet loss e observações de legibilidade de tela conforme aplicável.
- Testar rotas de recusa: câmera/microfone/captura negados, BT indisponível, perfil expirado, login inválido, mudança de instância, refresh revogado e fechamento de chamada em background.
- Estados: `NOT_RUN`, `PASS`, `FAIL`, `BLOCKED`; apenas PASS com evidência física. Tarefas relacionadas ficam `WAITING_VALIDATION` se não executadas. Não converter ausência de dispositivo anterior a iOS 27 em PASS de I06.
- Paridade é **critério de produto**, não autorização para afirmar que SO permite sempre microfone/câmera em segundo plano. Registrar limites reais e obter aceite de exceções.

## Registro de execução
```text
Teste: I__/A__/X__
Data e operador:
Modelo/OS/app:
Servidor/LiveKit:
Passos exatos:
Resultado: PASS | FAIL | BLOCKED
Métricas/observação:
Evidência (arquivo/issue/PR sem conteúdo sensível):
Defeito/reteste:
```
