# Arquitetura v0.1

## Componentes
- `apps/desktop`: Tauri 2 + React/Vite, UI, controles de mídia e integração nativa. Janelas web não são tratadas como browser genérico: documentar permissões WebView2.
- `apps/server`: Fastify REST, autenticação, salas, convites, política de acesso, emissão de tokens LiveKit.
- `packages/shared`: tipos OpenAPI e validação.
- `packages/media`: adapters `MediaProvider` e implementação LiveKit, desacoplados da UI.
- `packages/ui`: componentes sem dependências de backend.
- `infra`: Compose, configuração LiveKit, reverse proxy, provisionamento e backup.

## Fluxo de reunião
1. Desktop conecta HTTPS à instância configurada; usuário autentica.
2. Desktop consulta salas; solicita `POST /api/v1/rooms/:id/join`.
3. Backend valida usuário, membership/invite e restrições da sala.
4. Backend emite token de LiveKit com room grant restrito, TTL curto e identidade opaca.
5. Desktop conecta direto no SFU via signaling e ICE/WebRTC; mídia não passa pela API Fastify.
6. Ao sair ou ser removido, publicações e tracks param e políticas do servidor são aplicadas.

## Estado
- PostgreSQL: usuários, refresh sessions, rooms, memberships, invites, auditoria, configurações.
- LiveKit: participantes ativos, tracks, qualidade/conexão.
- Cliente: preferências locais e estado transitório.
- Não salvar estado de participante em Postgres como verdade online; não adicionar Socket.IO sem necessidade específica.

## Segurança
- Sem master account global; cada instalação é independente.
- Proteger bootstrap inicial com token de instalação de uso único ou mecanismo equivalente, não página aberta indefinidamente.
- Segredos de aplicação em env/secret store, não versionar credenciais.
- Refresh token rotativo e revogável; armazenamento seguro nativo após avaliação de plugin e permissões.
- Sem E2EE declarado no MVP; proteger signaling, REST e media transport; limitar retenção de logs.
- TLS nas interfaces públicas; TURN UDP/TCP/TLS conforme rede; portas de mídia não são proxy HTTP tradicional.

## Decisões aguardando teste
- API `getDisplayMedia()` e seleção de origem no WebView2 sob Tauri 2.
- Permissão de câmera/mic em ambiente empacotado versus `tauri dev`.
- Troca de áudio de saída, dispositivo Bluetooth e minimização do app.
- Captura de áudio do sistema está fora do MVP; não misturar com captura visual.

## Endpoints v1 propostos
`GET /health/live`, `GET /health/ready`, `GET /api/v1/instance`,
`POST /api/v1/auth/login`, `POST /api/v1/auth/refresh`, `POST /api/v1/auth/logout`, `GET /api/v1/auth/me`,
`GET|POST /api/v1/rooms`, `GET|PATCH|DELETE /api/v1/rooms/:id`, `POST /api/v1/rooms/:id/join`, `POST /api/v1/rooms/:id/invites`,
`GET /api/v1/admin/users`, `PATCH /api/v1/admin/users/:id`.
Endpoints finais deverão ser versionados em OpenAPI e testados.
