# Deploy self-hosted — design (não implementado)

## Topologia alvo
Um host Linux com Fastify, PostgreSQL, LiveKit, reverse proxy HTTPS e TURN/STUN (integrado ou separado). Docker Compose para desenvolvimento e produção; credenciais de produção geradas fora do Git.

## Obrigatório ao implementar
1. DNS para API, SFU e eventuais endpoints TURN/TLS.
2. Certificados HTTPS/WSS válidos e regras de proxy para signaling.
3. Portas de mídia WebRTC UDP/TCP conforme configuração efetiva do LiveKit; nunca assumir que Cloudflare Tunnel resolve UDP.
4. Configuração ICE e endereço IP público confiável, testando NAT e redes celulares.
5. Segredos via `.env` privado ou secret manager; `.env.example` sem valores válidos.
6. Migrações, backups e procedimento de restauração testado.
7. Healthchecks e observabilidade sem mídia ou credenciais.
8. Política de atualização e compatibilidade cliente/servidor.

**Não declarar pronto** antes de teste externo com duas redes e restauração de backup real.

Referências: https://docs.livekit.io/transport/self-hosting/ ; https://docs.livekit.io/transport/self-hosting/ports-firewall/
