# Matriz de testes reais — preencher durante execução

| Caso | Ambiente | Passos | Resultado | Evidência | Estado |
|---|---|---|---|---|---|
| M01 | Windows 11 / PC A | Abrir Tauri empacotado; enumerar mic/cam | — | — | NOT_RUN |
| M02 | Windows 10/11 / PC B | Entrar na mesma sala em outra rede | — | — | NOT_RUN |
| M03 | PCs A+B | Áudio nos dois sentidos por 10 min | — | — | NOT_RUN |
| M04 | PCs A+B | Vídeo de ambos em 720p alvo | — | — | NOT_RUN |
| M05 | PC A | Selecionar monitor, transmitir e interromper | — | — | NOT_RUN |
| M06 | PC A | Selecionar janela específica, transmitir e interromper | — | — | NOT_RUN |
| M07 | PCs A+B | Desligar/religar internet por 5 s | — | — | NOT_RUN |
| M08 | PC B em 4G/5G | Conexão via TURN se necessário | — | — | NOT_RUN |
| M09 | PC A | Trocar dispositivo durante chamada | — | — | NOT_RUN |
| M10 | PC A | Minimizar e restaurar Tauri; verificar tracks | — | — | NOT_RUN |
| M11 | 5 PCs/clients | Teste 60 min com câmera e voz | — | — | NOT_RUN |
| M12 | API | Token sem permissão negado | — | — | NOT_RUN |

**Métricas mínimas:** WebView2 version, app version, LiveKit version, Windows build, rede, RTT, jitter, packet loss, fps/resolução, qualidade percebida, uso CPU/RAM e log sanitizado.

**Se execução não ocorreu:** não preencher colunas como PASS; usar WAITING_VALIDATION na tarefa dependente.
