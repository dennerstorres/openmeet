# ADR 0014 — Cliente web
Status: Accepted. Data: 2026-10-19. Aceito para a F12. O cliente web ainda não está no código.

## Contexto
O cliente hoje é o `.exe` do Windows (Tauri). Quem não pode instalar nada, ou usa outro sistema, não entra. A interface já roda no navegador no `tauri dev`: é React com o mesmo `MeetingModel`, e a mídia é LiveKit no navegador. O que prende ao Windows é pouco: bandeja, atalhos globais, notificação nativa, cofre do Windows, link `openmeet://` e o processo nativo que guarda os tokens (F10-15, F10-17 e F10-18).

## Decisão
A própria instância serve um cliente web em `https://{API_DOMAIN}/`, mesma origem da API. Não há domínio novo, nem CORS, nem escolha de instância: a página fala só com a instância de onde veio. Outra instância é outro endereço.

### Mesmo código, outro alvo
O cliente web é o mesmo frontend de `apps/desktop`, gerado com o alvo `web`. Não nasce um segundo app. O alvo `web` troca três peças e esconde o que só existe no Windows:

| Peça | `.exe` | Web |
| --- | --- | --- |
| Instância | escolhida e fixada | a origem da página |
| Sessão | Rust guarda refresh e access (F10-17, F10-18) | cookies `HttpOnly` da API |
| Chamadas com sessão | `instance_call` no Rust | `fetch` na mesma origem, cookie automático |

### Sessão por cookie
A API ganha um modo de sessão por cookie, ao lado do `Bearer` do `.exe`. Login, bootstrap, Google e refresh, quando o pedido vem do cliente web, gravam:

- `om_access`: access token, `HttpOnly; Secure; SameSite=Strict; Path=/api`, 15 min;
- `om_refresh`: refresh, `HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth`, 30 dias.

O corpo da resposta não leva nenhum dos dois. O JavaScript não lê token, como no `.exe` depois da F10-18. O JWT da sala continua indo ao JavaScript, porque o LiveKit no navegador precisa dele, igual ao `.exe`.

Contra CSRF: `SameSite=Strict`, cabeçalho `Origin` igual ao `API_DOMAIN` e o cabeçalho `X-OpenMeet-Web: 1` em todo pedido que muda estado. Sem os três, cookie não autentica. Rotação, reuso de família (F10-03), logout com corte (F10-05) e `livekit_hold` valem igual.

### Página servida pela API
A imagem da API gera o bundle web e o serve em `/`, com CSP própria e fixa no deploy:

`default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' wss://{LIVEKIT_DOMAIN}; media-src 'self' blob: mediastream:; img-src 'self' blob: data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`

Mais estreita que a do `.exe` (ADR 0005), porque aqui o domínio do LiveKit é conhecido no deploy. `/api/*` continua igual. O Caddy não muda.

### O que fica igual
Bootstrap, login, servidores, salas, convites, presença, anel de quem fala, cards, destaque, grade, fixar, tela cheia, ensurdecer, volume por pessoa, microfone, câmera, troca de dispositivo, compartilhar tela ou janela, reconexão, métricas e diagnóstico.

### O que muda no navegador
- **Áudio do PC no compartilhamento (ADR 0008):** Chrome e Edge no Windows entregam áudio de aba e de sistema; Firefox não entrega. A marca só aparece quando o navegador suporta; sem faixa, o aviso de hoje continua.
- **Escolha de saída de som:** depende de `setSinkId`. Sem suporte, o seletor some.
- **Google (ADR 0010):** abre o Google numa janela nova do navegador em vez do navegador do sistema. A espera pelo segredo de poll continua igual.
- **Convite (ADR 0012):** a página `/convite/:code` ganha "Abrir no navegador", que leva ao cliente web com o código. O `openmeet://` continua para quem tem o `.exe`.
- **Aba em segundo plano:** a chamada continua; o navegador pode reduzir timers. A presença pergunta de novo quando a aba volta.

### O que não existe na web
Bandeja, atalhos globais, notificação do sistema, cofre do Windows e o aviso de "Fechar o OpenMeet". Fechar a aba sai da chamada; a sessão fica no cookie até expirar ou sair da conta.

### Navegadores
Chrome, Edge e Firefox atuais, em computador. Celular não está no escopo: a lista de fora do MVP já exclui apps móveis, e o navegador do celular não foi testado.

## Alternativas
- **Segundo app em `apps/web`:** duplicaria a tela. Recusada.
- **Access token na memória da página:** mais simples, mas desfaz na web o que a F10-18 fechou no `.exe`. Recusada.
- **Caddy servindo os arquivos:** exigiria copiar o bundle para o host. A API já tem o workspace no build. Recusada.

## Consequência
SPEC passa a ter dois clientes. RF-02 vale como "armazenamento seguro": cofre do Windows no `.exe`, cookie `HttpOnly` na web. O G2 continua sendo do `.exe`; a web tem o G12.
