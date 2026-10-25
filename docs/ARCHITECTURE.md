# Arquitetura v0.1

## Componentes
- `apps/desktop`: Tauri 2 + React/Vite, UI, controles de mídia e integração nativa. Janelas web não são tratadas como browser genérico: documentar permissões WebView2.
- `apps/server`: Fastify REST, autenticação, salas, convites, política de acesso, emissão de tokens LiveKit.
- `packages/shared`: tipos OpenAPI e validação.
- `packages/media`: adapters `MediaProvider` e implementação LiveKit, desacoplados da UI.
- `packages/ui`: componentes sem dependências de backend.
- `infra`: Compose, configuração LiveKit, reverse proxy, provisionamento e backup. `infra/compose` é a stack de um nó. `infra/livekit` continua o POC em loopback com `--dev`.

## Fluxo de reunião
1. Desktop conecta HTTPS à instância configurada; usuário autentica.
2. Desktop consulta salas; solicita `POST /api/v1/rooms/:id/join`.
3. Backend valida usuário, membership/invite e restrições da sala.
4. Backend emite token de LiveKit com room grant restrito, TTL curto e identidade opaca.
5. Desktop conecta direto no SFU via signaling e ICE/WebRTC; mídia não passa pela API Fastify.
6. Ao sair ou ser removido, publicações e tracks param e políticas do servidor são aplicadas.

## Estado
- PostgreSQL: usuários, refresh sessions, salas, servidores, memberships, convites, auditoria, configurações de presença e preferência visível/invisível. O estado online continua efêmero. Ícones e avatares ficam na tabela `images` (`bytea`, até 256 KB), com apelido e avatar por servidor em `server_members`. ADR 0019.
- LiveKit: participantes ativos, tracks, qualidade/conexão.
- Cliente: preferências locais e estado transitório. O diagnóstico exportado leva fase, métricas e tempos de reconexão, e só sai com consentimento. Token, JWT, Bearer e e-mail não entram.
- Presença da plataforma: heartbeat efêmero em memória na API de um nó, separado da ocupação de sala do LiveKit. O banco guarda somente política do servidor e preferência visível/invisível; nunca grava online/ausente como verdade durável. ADR 0017.
- Não salvar estado de participante em Postgres como verdade online; não adicionar Socket.IO sem necessidade específica.

## Segurança
- Sem master account global; cada instalação é independente. O ADR 0010 propõe login com Google, com as chaves só no servidor. O código ainda entra por usuário e senha.
- Proteger bootstrap inicial com token de instalação de uso único ou mecanismo equivalente, não página aberta indefinidamente.
- Segredos de aplicação em env/secret store, não versionar credenciais.
- Refresh token rotativo e revogável. O access token aponta para essa sessão e deixa de valer no logout e na rotação. No aplicativo Tauri, o refresh fica no cofre de credenciais do Windows, uma entrada por origem. Fora do Tauri, ele continua só na memória. O access token não é gravado. A preferência de atalho fica num JSON local, sem segredo.
- Encerrar a sala ou remover um membro grava a decisão e pede ao LiveKit para desconectar. Se o SFU falhar, a API responde 502 e a decisão no banco permanece.
- Login e bootstrap têm limite de tentativas. `TRUST_PROXY=1` considera só o primeiro hop encaminhado.
- Sem E2EE declarado no MVP; proteger signaling, REST e media transport; limitar retenção de logs.
- TLS nas interfaces públicas; TURN UDP/TCP/TLS conforme rede; portas de mídia não são proxy HTTP tradicional.

## Decisões aguardando teste
- API `getDisplayMedia()` e seleção de origem no WebView2 sob Tauri 2.
- Permissão de câmera/mic em ambiente empacotado versus `tauri dev`.
- Troca de áudio de saída, dispositivo Bluetooth e minimização do app.
- O ADR 0008 propõe o áudio do PC junto do compartilhamento, desligado por padrão. A captura atual continua só com imagem. Captura nativa do Windows não faz parte desse desenho.

## Endpoints v1
Existem: `GET /health/live`, `GET /health/ready`, `GET /api/v1/instance`,
`POST /api/v1/auth/bootstrap`, `POST /api/v1/auth/login`, `POST /api/v1/auth/refresh`, `POST /api/v1/auth/logout`, `GET /api/v1/auth/me`,
`POST /api/v1/admin/users`, `GET|POST /api/v1/rooms`, `GET /api/v1/rooms/:id`, `PATCH /api/v1/rooms/:id`,
`DELETE /api/v1/rooms/:id/members/:userId`, `POST /api/v1/rooms/:id/invites`, `DELETE /api/v1/rooms/:id/invites/:inviteId`,
`POST /api/v1/rooms/:id/join`. Servidores (ADR 0007): `GET|POST /api/v1/servers`, `GET /api/v1/servers/:id`, `GET|POST /api/v1/servers/:id/rooms`, `POST /api/v1/servers/:id/invites`, `DELETE /api/v1/servers/:id/invites/:inviteId`, `POST /api/v1/servers/:id/join`, `DELETE /api/v1/servers/:id/members/:userId`, `POST /api/v1/auth/google/start`, `GET /api/v1/auth/google/callback` e `POST /api/v1/auth/google/poll` (ADR 0010: navegador do sistema, estado, nonce e PKCE; a página de retorno não mostra token; o app busca a sessão uma vez com um segredo que não passa pelo navegador), `GET /api/v1/servers/:id/presence` (ADR 0011: pergunta ao LiveKit quem está em cada sala aberta, nome vindo do banco, nada gravado; 503 `presence_unavailable` quando o SFU não responde), `POST /api/v1/invites/accept` (ADR 0012: o código basta, o servidor vem do convite). ADR 0019: `POST /api/v1/profile/avatar`, `POST /api/v1/servers/:id/icon` (só dono), `POST /api/v1/servers/:id/profile` (o próprio membro) e `GET /api/v1/images/:id` (404 para quem não divide servidor com a imagem; no `.exe` pelo comando `instance_image`). `GET /convite/:code` é uma página HTML sem script e sem sessão que só aponta para `openmeet://convite?host=…&code=…`; o log de requisição troca o código por `[redacted]`. O desktop registra `openmeet://` (deep-link e instância única) e só repassa ao webview links `openmeet://convite`; o webview pede confirmação antes de mandar o código, e um link de outra instância só troca de instância depois do clique. As rotas de sala agem no servidor dono da sala: convite, remoção e acesso são do servidor. `POST /api/v1/rooms` sem `serverId` cai no servidor mais antigo que a conta gerencia; o admin sem servidor ganha `Geral`. O LiveKit usa o id da sala. `POST /api/v1/poc/join` só existe com `POC_JOIN=1` e só em loopback.
Ainda não existem: `DELETE /api/v1/rooms/:id`, `GET /api/v1/admin/users`, `PATCH /api/v1/admin/users/:id`. `packages/shared` ainda não publica OpenAPI.
