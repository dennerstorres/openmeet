# ADR 0027 — PWA e notificação push no cliente web
Status: Accepted. Data: 2026-10-29. Aprovada pelo usuário. Ainda não está no código.

## Contexto
O cliente web (ADR 0014) roda só com a aba aberta. No celular (F12-08) ele não fica na tela inicial e abre com a barra do navegador. Os avisos de mensagem da ADR 0024 só chegam com a aba viva. O `.exe` resolve isso com bandeja e notificação nativa, mas a web não tem nada parecido.

## Decisão
O cliente web vira PWA instalável, com service worker que faz cache seguro e recebe Web Push padrão (VAPID). Nada disso usa serviço pago: o push vai para o serviço do próprio navegador (FCM, Mozilla, Apple), que é gratuito e não precisa de conta.

### Manifest
`/manifest.webmanifest` com nome, `start_url: "/"`, `scope: "/"`, `display: "standalone"`, cores do tema e ícones 192, 512 e maskable. Só existe no alvo `web`; o `.exe` não registra service worker.

### Cache sem prender versão velha
- **HTML (`/`, rotas do app):** sempre network-first. O cache só entra se a rede falhar, e aí a página mostra "sem conexão" em vez de um app velho tentando falar com a API.
- **Assets com hash (`/assets/*`):** cache-first e imutáveis. Cada build gera nomes novos, então um asset nunca é trocado por baixo.
- **`/api/*`, SSE, LiveKit, `/convite/*`:** nunca passam pelo cache. O SW nem intercepta.
- **Limpeza:** o cache tem nome por versão do build. No `activate`, os caches de outras versões são apagados.
- **Atualização:** o SW novo instala e fica em `waiting`. O app mostra "Nova versão disponível — recarregar". Fora de chamada, recarrega ao clicar. Durante chamada, o aviso espera a pessoa sair. Nada de `skipWaiting` automático no meio de uma reunião.
- **Escape:** `/sw.js` é servido com `Cache-Control: no-cache`, para o navegador sempre checar a versão. Um SW "kill switch" (que se desregistra) fica documentado para emergência.

### Push
- **Chaves:** par VAPID por instância, nas variáveis de ambiente (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`). A chave privada nunca vai para log nem para o repositório.
- **Inscrição:** a pessoa ativa nas configurações, o navegador pede permissão e o cliente manda o endpoint para `POST /api/v1/push/subscriptions`. Fica numa tabela `push_subscriptions` (usuário, endpoint, chaves `p256dh`/`auth`, user agent, criada em, último uso), com migration versionada. Uma pessoa pode ter vários aparelhos.
- **Saída:** `DELETE` da inscrição, e também no logout daquele aparelho. Endpoint que responde 404/410 é apagado.
- **O que dispara:** só os eventos que a ADR 0024 já define como aviso: menção, mensagem direta e resposta. Não dispara se a pessoa tem uma aba aberta com foco; o SW confere antes de mostrar.
- **Conteúdo:** o payload vai cifrado (padrão Web Push) e leva só o mínimo: tipo, nome de quem mandou, nome da sala e um trecho curto. Clicar abre ou foca o app na conversa.
- **Permissão:** o pedido só acontece por clique da pessoa, nunca no carregamento.

### Navegadores
Chrome, Edge e Firefox em computador e Android. No iPhone, o push só funciona com o PWA instalado na tela inicial (iOS 16.4+), e isso precisa de teste físico.

## Alternativas
- **Só manifest, sem SW:** instala, mas não tem push. Recusada porque o usuário pediu push.
- **Workbox / `vite-plugin-pwa` com precache de tudo:** é a causa clássica de app preso em versão velha. Se a lib entrar, entra só com as regras acima, sem precache de HTML.
- **Serviço de push terceiro (OneSignal etc.):** é SaaS, e o AGENTS.md proíbe. Recusada.

## Consequência
A SPEC ganha um item de PWA e push para o cliente web. A API ganha uma tabela, duas rotas e um envio de push no caminho de notificação da ADR 0024, então o push depende da ADR 0024 estar implementada. O CSP da ADR 0014 ganha `worker-src 'self'` e `manifest-src 'self'`. Testes: unitário das regras de cache; teste de permissão das rotas (só o dono vê ou apaga a inscrição); teste manual de atualização (deploy novo com o app aberto, precisa aparecer o aviso e não pode quebrar) e de push em Chrome, Firefox e Android.
