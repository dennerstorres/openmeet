# Diagnóstico para chamadas

Se a voz corta: registrar direção afetada, tempo da falha, perdas/jitter/RTT, codec, dispositivo, mudanças de rede e eventos de reconexão. Distinguir captura de microfone (input), encode, upload, SFU, download, decode e dispositivo de saída.

Se não compartilha tela: registrar sistema/versão WebView2/Tauri, `getDisplayMedia` disponível?, permissões, resultado ao escolher janela/monitor, erro DOMException sem dados sensíveis, comportamento `tauri dev` vs build empacotado.

Se falha fora da LAN: verificar ICE candidates, UDP permitido, NAT, TURN e portas. Não concluir que a API HTTPS funcionar prova que a mídia funciona.

Checklist de evidência: horário UTC, versões, ID de correlação pseudônimo, passos, logs sanitizados, métricas, hipótese e teste para falsificá-la.
