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
- Refresh token rotativo e revogável. O access token aponta para essa sessão e deixa de valer no logout e na rotação. O armazenamento nativo do refresh ainda não existe: ele fica só na memória da janela.
- Encerrar a sala ou remover um membro grava a decisão e pede ao LiveKit para desconectar. Se o SFU falhar, a API responde 502 e a decisão no banco permanece.
- Login e bootstrap têm limite de tentativas. `TRUST_PROXY=1` considera só o primeiro hop encaminhado.
- Sem E2EE declarado no MVP; proteger signaling, REST e media transport; limitar retenção de logs.
- TLS nas interfaces públicas; TURN UDP/TCP/TLS conforme rede; portas de mídia não são proxy HTTP tradicional.

## Decisões aguardando teste
- API `getDisplayMedia()` e seleção de origem no WebView2 sob Tauri 2.
- Permissão de câmera/mic em ambiente empacotado versus `tauri dev`.
- Troca de áudio de saída, dispositivo Bluetooth e minimização do app.
- Captura de áudio do sistema está fora do MVP; não misturar com captura visual.

## Endpoints v1
Existem: `GET /health/live`, `GET /health/ready`, `GET /api/v1/instance`,
`POST /api/v1/auth/bootstrap`, `POST /api/v1/auth/login`, `POST /api/v1/auth/refresh`, `POST /api/v1/auth/logout`, `GET /api/v1/auth/me`,
`POST /api/v1/admin/users`, `GET|POST /api/v1/rooms`, `GET /api/v1/rooms/:id`, `PATCH /api/v1/rooms/:id`,
`DELETE /api/v1/rooms/:id/members/:userId`, `POST /api/v1/rooms/:id/invites`, `DELETE /api/v1/rooms/:id/invites/:inviteId`,
`POST /api/v1/rooms/:id/join`. `POST /api/v1/poc/join` só existe com `POC_JOIN=1` e só em loopback.
Ainda não existem: `DELETE /api/v1/rooms/:id`, `GET /api/v1/admin/users`, `PATCH /api/v1/admin/users/:id`. `packages/shared` ainda não publica OpenAPI.
