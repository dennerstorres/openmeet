# Auditoria de segurança — 2026-10-19

Leitura estática do código. Sem teste de invasão, sem runtime do instalador e sem mudança de comportamento. Não há receita de ataque neste arquivo.

Escopo lido: autenticação, salas, token LiveKit, desktop Tauri (CSP, capability, cofre, permissão de mídia), Compose, Caddy, LiveKit, backup e o cliente em `packages/shared` e `packages/media`.

## Resumo

Não achei um caminho sem credencial que entregue o banco, a sala ou o PC. O que há de grave exige conta de administrador, refresh já roubado, falha do SFU, ou script rodando dentro da janela do app.

| ID | Severidade | Achado |
| --- | --- | --- |
| S-01 | alta | Administrador entra em qualquer sala sem ser membro |
| S-02 | alta | Não dá para bloquear conta nem derrubar as outras sessões |
| S-03 | alta | Refresh já revogado não derruba a sessão que nasceu dele |
| S-04 | alta | Remover ou encerrar pode deixar a pessoa na chamada |
| S-05 | alta | O cofre devolve o refresh de qualquer origem que o JS peça |
| S-06 | média | CSP libera `https:` e `wss:` para qualquer host |
| S-07 | média | Captura de mídia também vale para a porta de desenvolvimento |
| S-08 | média | A janela não recusa navegação para outra origem |
| S-09 | média | O token da sala sempre pode publicar |
| S-10 | média | O login da conta aparece para os outros membros |
| S-11 | média | Limite de login é memória local e confia no primeiro `X-Forwarded-For` |
| S-12 | média | Token de instalação continua reconhecível depois do bootstrap |
| S-13 | baixa | Prova de mídia divide a janela com o cofre |
| S-14 | baixa | `core:default` concede mais do que a tela usa |
| S-15 | baixa | CSP sem `base-uri`; estilo inline permitido |
| S-16 | baixa | Fechar a janela esconde e mantém a sessão |
| S-18 | média | Sair da conta não corta o token da chamada |
| S-19 | média | O `.env` da stack não está nomeado no ignore do build |
| S-20 | média | TURN com TLS externo publica a porta sem terminador |
| S-21 | baixa | Nome de exibição aceita caractere de controle |
| S-17 | baixa | Backup SQL em claro; portas de mídia abertas no host |

## Achados

### S-01 | alta | Administrador entra em qualquer sala sem ser membro

Confirmado em `apps/server/src/rooms/service.ts`. `listRooms` (por volta da linha 128) devolve todas as salas quando `actor.role === "admin"`. `joinRoom` (por volta da linha 252) pula o convite para esse papel e `issueRoomToken` (por volta da linha 301) emite token com `canPublish` e `canSubscribe`. Não grava membership.

Impacto: a conta de administrador, se for usada por outra pessoa, lê e publica em qualquer reunião da instância. Isso vale também com membership removida: a expulsão não segura esse papel. A lista REST de membros não ganha essa linha. A chamada mostra quem o LiveKit anunciar. O SPEC RF-11 diz que a conta só vê o que é membro.

Correção: admin não recebe token de mídia sem membership. Lista de suporte, se existir, não entra na sala. Entrada excepcional fica auditada e visível para quem está na chamada.

Teste que falta: admin sem membership recebe 403 em `POST /rooms/:id/join` e não recebe URL nem token.

### S-02 | alta | Não dá para bloquear conta nem derrubar as outras sessões

`disabled_at` existe em `apps/server/drizzle/0001_identity.sql` (por volta da linha 14). Nenhuma rota grava nele. `logout` em `apps/server/src/auth/service.ts` (por volta da linha 222) revoga só o refresh apresentado. O ADR 0006 deixa as outras sessões do mesmo usuário vivas. O refresh dura 30 dias (`startSession`, por volta da linha 120). Não há troca de senha nem recuperação administrativa, apesar do item 2 do SPEC.

Impacto: um refresh roubado continua válido depois que a pessoa sai nos outros aparelhos. O operador não tem procedimento na API para cortar a conta.

Correção: ação de administrador para desativar a conta, revogar todas as `refresh_sessions` dela e impedir login. Troca de senha revoga as sessões antigas. Documentar o procedimento.

Teste que falta: depois de desativar, login, refresh e access token dessa conta respondem 401. As sessões de outra conta continuam.

### S-03 | alta | Refresh já revogado não derruba a sessão que nasceu dele

Em `refreshSession` (`apps/server/src/auth/service.ts`, por volta da linha 204), token revogado ou expirado cai em `invalid_session`. Não há caminhada por `replaced_by` para revogar a sessão nova. O teste em `apps/server/test/auth.test.ts` só exige 401 no token velho.

Impacto: se o refresh antigo for apresentado de novo, a sessão que o substituiu continua até os 30 dias.

Correção: reapresentar um refresh que já tem `replaced_by` revoga essa cadeia e exige login de novo.

Teste que falta: o refresh substituto passa a responder 401 depois que o token anterior é apresentado de novo.

### S-04 | alta | Remover ou encerrar pode deixar a pessoa na chamada

`endRoom` e `removeMember` (`apps/server/src/rooms/service.ts`, por volta das linhas 163 e 174) gravam o Postgres e só depois chamam o SFU. Se o SFU falha, a API responde `media_disconnect_failed` (502) e o banco não volta atrás. Sem o `removeParticipant` com `revokeTokenTs`, o token LiveKit de 10 minutos segue válido.

Impacto: a pessoa removida, ou a sala encerrada, pode continuar na mídia quando o LiveKit não confirma o corte. No meio do `await` de `joinRoom`, um token novo pode sair depois do `revokeTokenTs`. Esse token não é coberto pelo corte anterior.

Correção: revogar no SFU antes de tratar a operação como feita. Assinar o token na mesma trava que revalida sala e membership. Se o SFU falhar, a API deixa a tentativa repetível e não entrega token novo.

Teste que falta: já existe cobertura de "falha do SFU mantém o banco". Falta afirmar que um `join` seguinte não emite token e que a repetição chama o SFU de novo até o corte.

### S-05 | alta | O cofre devolve o refresh de qualquer origem que o JS peça

`session_load`, `session_save` e `session_clear` em `apps/desktop/src-tauri/src/shell.rs` (por volta das linhas 276–309) aceitam a origem que o frontend manda. `accept_origin` só valida o formato. A capability em `apps/desktop/src-tauri/capabilities/default.json` não amarra a origem. O modelo em `packages/shared/src/meeting.ts` (por volta da linha 282) também guarda o access token na memória da janela.

Impacto: script que rode na janela `main` lê o refresh das instâncias já salvas no cofre do Windows, não só o da tela atual. Não achei `innerHTML` nem `dangerouslySetInnerHTML` nos fontes lidos. O efeito depende de script nessa origem.

Correção: o processo nativo só entrega refresh da origem que ele confirmou. O ideal é o Rust fazer o refresh e não devolver o segredo ao JavaScript.

Teste que falta: `session_load` com outra origem `https` é recusado.

### S-06 | média | CSP libera qualquer https e wss

`apps/desktop/src-tauri/tauri.conf.json` (por volta da linha 24) usa `connect-src` com `https:` e `wss:`. O ADR 0005 aceita isso porque a CSP do Tauri é fixa e cada pessoa escolhe o servidor. `script-src` cai em `'self'`. Não há `unsafe-eval`.

Impacto: a política não reforça o pin de `prepareInstanceRequest`. Script na origem do app pode abrir conexão com outro host. O cliente normal não manda senha para host diferente do confirmado.

Correção: não alargar a CSP. No desenho seguinte, o REST autenticado sai do webview e fica no processo nativo. O webview só fala com o destino de mídia já autorizado.

### S-07 | média | Captura de mídia também vale para a porta de desenvolvimento

`is_app_origin` em `apps/desktop/src-tauri/src/lib.rs` (por volta das linhas 3–34) responde Allow para microfone, câmera, captura de tela e autoplay. A lista inclui `http://localhost:1420` e `http://127.0.0.1:1420` também no build que não é de debug. Não executei o WebView2, então não afirmo se o Windows ainda mostra o seletor de tela.

Correção: no release, Allow só para a origem do bundle. Captura de tela separada de câmera e microfone.

### S-08 | média | A janela não recusa navegação para outra origem

`lib.rs` não registra filtro de navegação. A capability gerada em `apps/desktop/src-tauri/gen/schemas/capabilities.json` está `"local": true` e sem contexto remoto. Pelo modelo do Tauri 2, URL remota não herda estes comandos. O risco que fica é a janela passar a mostrar `http://127.0.0.1:1420` e cair no Allow do S-07.

Correção: cancelar navegação fora da origem do bundle. Não adicionar `remote` na capability.

### S-09 | média | O token da sala sempre pode publicar

`issueRoomToken` concede `canPublish: true` para todo membro. Mute de publicação fica no cliente. Um cliente modificado, com conta que já pode entrar, continua publicando. `canPublishData` é falso e não há `roomAdmin`. Isso está certo no segundo ponto.

O cliente pede o compartilhamento com `audio: false` em `packages/media/src/session.ts`. O token não lista `canPublishSources`, então a mesma concessão cobre microfone, câmera, tela e áudio da tela.

Correção: o grant lista só as fontes autorizadas. Áudio do PC não entra no token padrão. O corte feito por moderador vira revogação ou mute no SFU, não só estado na tela.

### S-10 | média | O login da conta aparece para os outros membros

`getRoom` (`apps/server/src/rooms/service.ts`, por volta da linha 143) devolve `username` junto com o nome de exibição. O username é o identificador do login.

Correção: membro vê nome de exibição e papel. Username fica para o administrador da conta, não para a sala.

### S-11 | média | Limite de login é memória local e confia no primeiro X-Forwarded-For

`clientAddress` em `apps/server/src/auth/limit.ts` (por volta da linha 35), com `TRUST_PROXY=1` no Compose, usa o primeiro salto de `X-Forwarded-For`. O mapa de tentativas não tem teto de chaves e vive no processo. Não há limite no refresh. O Caddyfile não fixa o tratamento do header. Não confirmei em runtime se o Caddy apaga o valor enviado pelo cliente. Outro container que alcance `api:3000` escolhe esse IP. A API não publica a porta 3000 no host. Postgres também não publica porta.

Correção: só aceitar o IP que o proxy da própria stack gravar, com teto no mapa. Refresh com limite baixo. Documentar que a API não pode ficar alcançável fora do Caddy.

### S-12 | média | Token de instalação continua reconhecível depois do bootstrap

Depois que `bootstrap_completed` é verdadeiro, token certo tende a `bootstrap_closed` (409) e token errado a `bootstrap_rejected` (401). A comparação está em `bootstrapAdmin`. O valor segue no ambiente do container e o `host.mjs` imprime esse valor uma vez no stdout.

A janela mais sensível é antes do primeiro administrador: quem lê o stdout nessa hora cria a conta. Depois de fechado, a diferença 409/401 ainda confirma se o valor está certo.

Correção: não imprimir o token no stdout. Depois de fechado, a rota responde sempre o mesmo código e o processo deixa de carregar o valor.

### S-13 | baixa | Prova de mídia divide a janela com o cofre

`apps/desktop/src/App.tsx` abre `PocApp` com `?poc=1`. Essa tela fala com a URL que a pessoa digitar e divide a origem e o IPC do S-05 com a sessão real. Não lê token na query. Não há `openmeet://` no `tauri.conf.json`.

Correção: prova fora do instalador, ou numa webview sem os comandos de sessão.

### S-14 | baixa | core:default concede mais do que a tela usa

A capability inclui `core:default` além dos comandos próprios. Não há plugin de shell, fs, http, opener nem updater no `Cargo.toml`. A feature `devtools` não está ligada. Não abri o `openmeet-desktop.exe`.

Correção: listar só as permissões que o `listen` do shell precisa e negar o toggle de devtools de forma explícita.

### S-15 | baixa | CSP sem base-uri; estilo inline permitido

O objeto `csp` não define `base-uri`. `style-src` inclui `'unsafe-inline'`. Não há HTML injetado nos arquivos de UI lidos.

Correção: `base-uri 'none'`. Tirar o estilo inline se o CSS empacotado não precisar.

### S-16 | baixa | Fechar a janela esconde e mantém a sessão

`CloseRequested` em `shell.rs` esconde a janela. O access token segue na memória até `endSession`. A saída da conta está no item Sair da bandeja.

Correção: deixar esse contrato visível. Se fechar tiver de encerrar a conta, chamar o mesmo caminho do Sair.

### S-17 | baixa | Backup SQL em claro; portas de mídia abertas no host

`infra/compose/pg-copy.mjs` grava o dump em `infra/compose/generated`, fora do Git, e recusa dump que contenha a senha do Postgres. O arquivo ainda tem hashes de senha e de sessão. `mode: 0o600` não vira ACL no Windows. O Compose publica `7881/tcp` e `7882/udp` em todas as interfaces. Isso é o transporte WebRTC, não um segundo login. O compose de POC em `infra/livekit` prende as portas em `127.0.0.1` e está marcado como local.

Correção: dump cifrado ou ACL explícita no Windows. Firewall do host só com as portas de mídia e 443. Não usar o compose `--dev` numa VPS.

### S-18 | média | Sair da conta não corta o token da chamada

`logout` em `apps/server/src/auth/service.ts` só revoga o refresh. O JWT do LiveKit não carrega a sessão da API e segue válido por até 10 minutos. O cliente em `packages/shared/src/meeting.ts` desconecta a própria mídia. Outra cópia do token não é cortada. Conta com `disabled_at` também não dispara `removeParticipant`.

Correção: logout e desativação usam o mesmo corte do S-04 para as salas em que essa identity está.

### S-19 | média | O `.env` da stack não está nomeado no ignore do build

O Compose constrói a API com contexto na raiz (`infra/compose/docker-compose.yml`) e o Dockerfile faz `COPY . .`. O `.dockerignore` lista `.env` e `.env.*` sem o caminho `infra/compose/.env`. A imagem final só copia `/out`, então o arquivo tende a não ir para o filesystem publicado. O contexto e o cache do estágio de build são o problema se o matcher não ignorar esse caminho. Não rodei o build para provar o matcher.

Correção: ignorar `infra/compose/.env` pelo caminho. O contexto do build deve ser o código do servidor, não o repositório inteiro.

### S-20 | média | TURN com TLS externo publica a porta sem terminador

`TURN_EXTERNAL_TLS=1` em `infra/compose/render-livekit.mjs` grava `external_tls: true` sem certificado. `docker-compose.turn.yml` publica `3478/udp` e `5349` em todas as interfaces. Nenhum arquivo deste repositório sobe o terminador TLS. A autenticação do TURN fica no padrão da imagem, sem senha estática no YAML.

Correção: não publicar `5349` nesse modo sem o terminador no mesmo Compose. Tratar relay sem credencial efêmera como configuração inválida.

### S-21 | baixa | Nome de exibição aceita caractere de controle

`parseDisplayName` em `apps/server/src/auth/service.ts` só corta espaço e cobra tamanho. O nome da instância, ao contrário, recusa controle. Esse nome vai para o claim `name` do LiveKit e para o rótulo da chamada. A tela usa texto React, então o efeito é rótulo enganoso, não HTML.

Correção: recusar controle e caracteres bidi antes de gravar e antes de assinar o token.

## O que está sólido

- Senha com Argon2id (19 MiB, 2 iterações). Usuário inexistente também verifica um hash. Login e bootstrap têm limite.
- Refresh e convite são aleatórios de 32 bytes e o banco guarda SHA-256. Convite criado antes da remoção não readmite.
- Access token é HMAC, não obedece o `alg` do header, e morre quando a sessão daquele refresh é revogada.
- SQL das rotas usa parâmetro. Não achei concatenação de entrada na query.
- CORS só nas origens do app. Resposta de auth e sala leva `cache-control: no-store`. Erro de auth não devolve stack.
- `POC_JOIN` no Compose é `0` e o entrypoint recusa `1`. Com a flag ligada, a rota exige loopback e emite token para a identity que o cliente mandar, no formato de um id de usuário. Por isso ela não pode apontar para o LiveKit real.
- Cliente recusa HTTP público, usuário e senha na URL da instância, e não manda o REST para outra origem.
- Não há `roomAdmin` nem `canPublishData` no token da sala. Um administrador de conta não pode ser criado pela rota de usuários. Há índice de um único admin.
- Segredos do Compose são obrigatórios, sem default no arquivo. `.env` e `generated/` estão no `.gitignore` e no `.dockerignore`. A API roda como `node`. Postgres não publica porta.
- Diagnóstico só sai com consentimento. JWT no texto é redatado. `localStorage` guarda o endereço da instância, não o token.
- Não há deep link, updater, `withGlobalTauri`, nem comando nativo que receba caminho ou comando do sistema.

## Fora deste código

Quem opera a VPS, ou quem lê `LIVEKIT_API_SECRET`, emite token de qualquer sala. O SPEC já diz que não há E2EE. Isso não é vazamento do cliente. É o modelo do servidor.

ADR 0010 (Google) e ADR 0012 (`openmeet://`) ainda não estão implementados. Quando entrarem, o retorno OAuth precisa de state e redirect fixo, e o link não pode carregar refresh nem aceitar origem arbitrária.

## O que não foi executado

Não subi a stack, não abri o instalador e não medi o WebView2. Severidade de S-07 e S-08 no Windows real continua por confirmar.

## Desenho da correção

O plano de correção, com teste e PR por achado, está em `docs/reviews/security-fixes-design-2026-10-19.md`.
