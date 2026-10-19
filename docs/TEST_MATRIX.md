# Matriz de testes reais — preencher durante execução

| Caso | Ambiente | Passos | Resultado | Evidência | Estado |
|---|---|---|---|---|---|
| M01 | Windows 11 / PC A | Abrir Tauri empacotado; enumerar mic/cam | — | — | NOT_RUN |
| M02 | Windows 10/11 / PC B | Entrar na mesma sala em outra rede | — | — | NOT_RUN |
| M03 | PCs A+B | Áudio nos dois sentidos por 10 min | — | — | NOT_RUN |
| M04 | PCs A+B | Vídeo de ambos em 720p alvo | — | — | NOT_RUN |
| M05 | PC A | Selecionar monitor, transmitir e interromper | Os dois PCs compartilharam o monitor. O outro viu a tela e ela sumiu ao parar. | Relato em 2026-10-19 | PASS |
| M06 | PC A | Selecionar janela específica, transmitir e interromper | Os dois lados compartilharam uma janela. O outro viu e a imagem sumiu ao parar. | Relato em 2026-10-19 | PASS |
| M07 | PCs A+B | Desligar/religar internet por 5 s | — | — | NOT_RUN |
| M08 | PC B em 4G/5G | Conexão via TURN se necessário | — | — | NOT_RUN |
| M09 | PC A | Trocar dispositivo durante chamada | — | — | NOT_RUN |
| M10 | PC A | Minimizar e restaurar Tauri; verificar tracks | — | — | NOT_RUN |
| M11 | 5 PCs/clients | Teste 60 min com câmera e voz | — | — | NOT_RUN |
| M12 | API | Token sem permissão negado | — | — | NOT_RUN |

**Gates:** G2 cobre M01–M10 e os itens do ADR 0004 (dev e build, Windows 10 e 11, vários monitores, minimizar/restaurar, parar e republicar, permissão negada). M11 é G4. M12 é G3. M05 e M06 estão PASS. Os outros casos seguem NOT_RUN. A reunião mostra troca de dispositivo, relógio e métricas para observar M09 e M11. Os dois seguem NOT_RUN.

**2026-10-19:** dois PCs com o instalador entraram na mesma sala. Microfone, câmera e compartilhamento de tela funcionaram. M05 e M06 passaram: monitor e janela nos dois lados, a imagem apareceu e sumiu ao parar. Seguem sem PASS: duração, resolução, rede distinta, queda, TURN, troca de dispositivo, minimizar e diagnóstico.

**Métricas mínimas:** WebView2 version, app version, LiveKit version, Windows build, rede, RTT, jitter, packet loss, fps/resolução, qualidade percebida, uso CPU/RAM e log sanitizado.

**Se execução não ocorreu:** não preencher colunas como PASS; usar WAITING_VALIDATION na tarefa dependente.
