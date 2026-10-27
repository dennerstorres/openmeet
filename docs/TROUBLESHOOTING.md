# Diagnóstico para chamadas

Se a voz corta: registrar direção afetada, tempo da falha, perdas/jitter/RTT, codec, dispositivo, mudanças de rede e eventos de reconexão. Distinguir captura de microfone (input), encode, upload, SFU, download, decode e dispositivo de saída.

Se não compartilha tela: registrar sistema/versão WebView2/Tauri, `getDisplayMedia` disponível?, permissões, resultado ao escolher janela/monitor, erro DOMException sem dados sensíveis, comportamento `tauri dev` vs build empacotado.

Se falha fora da LAN: verificar ICE candidates, UDP permitido, NAT, TURN e portas. Não concluir que a API HTTPS funcionar prova que a mídia funciona.

Checklist de evidência: horário UTC, versões, ID de correlação pseudônimo, passos, logs sanitizados, métricas, hipótese e teste para falsificá-la.

## Chat não chega ou atrasa (SSE)

Sintoma: a mensagem só aparece ao trocar de sala ou recarregar, "digitando…" nunca aparece, ou o chat fica reconectando.

1. **A rota responde?** Com um token de acesso válido: `curl -N -H "Authorization: Bearer <token>" https://<API_DOMAIN>/api/v1/events`. Deve chegar `retry: 3000` e um evento `ready` na hora, e `: keepalive` a cada 25 s. Não cole o token em issue nem em log.
2. **Chega tudo de uma vez quando a conexão fecha?** É buffer no proxy. Tirar o middleware `buffering` do Traefik, deixar `text/event-stream` fora do `compress`, `proxy_buffering off` no Nginx. Ver `docs/DEPLOYMENT.md`.
3. **Cai a cada 30 a 60 s?** Timeout ocioso do proxy, do balanceador ou da CDN abaixo do keep-alive de 25 s. Subir para mais de 30 s.
4. **429 em `/api/v1/events`?** A conta já tem 5 fluxos abertos (abas, `.exe`). Fechar abas; o fluxo de um cliente que caiu some quando o proxy fecha a conexão.
5. **401?** Sessão expirada ou revogada: sair e entrar de novo.
6. **Depois de reiniciar a API?** O cliente recebe `reset` e recarrega pelo histórico; nada se perde. Se a tela não atualizar, trocar de sala força a leitura.
7. **Duas réplicas da API?** O chat em tempo real exige uma réplica só.
8. **Anexo falha com 413?** Proxy com limite de corpo abaixo de ~14 MB, ou arquivo acima de `ATTACHMENT_MAX_BYTES`.
9. **Notificação não aparece?** No Windows, conferir as notificações do sistema e o "Não perturbe"; na web, a permissão do site. O nível `none` silencia, e a conversa aberta e em foco não notifica.

Registrar: horário UTC, cliente (`.exe` ou navegador e versão), status HTTP do `/api/v1/events`, proxy na frente e se o problema some na rede local.
