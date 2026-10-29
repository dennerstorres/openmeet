# ADR 0028 — Sessões por aparelho no painel de contas

Status: Accepted. Data: 2026-10-29. Pedida pelo usuário.

## Contexto

O administrador quer saber, para cada conta, onde ela está logada: web ou desktop, qual versão e quando foi o último acesso. Uma conta pode ter várias sessões ao mesmo tempo (dois PCs, desktop e web).

## Decisão

- Cada linha de `refresh_sessions` guarda `client_kind` (`web` ou `desktop`), `client_version` e `client_agent` (user agent, até 256 caracteres). Migration `0014_session_client.sql`.
- O tipo vem do servidor (`webMode`: cookie web ou cliente nativo), não do cliente. A versão vem do cabeçalho `x-openmeet-version`, validado (até 32 caracteres, só `[0-9A-Za-z.+-]`); fora disso fica nulo.
- Como cada refresh cria uma linha nova na mesma família, a linha viva mais recente de cada família é a sessão do aparelho, e o `created_at` dela é o último acesso (renova a cada 15 minutos com o app aberto).
- `GET /api/v1/admin/users` passa a devolver `sessions` por conta: só famílias com linha não revogada e não expirada. Só o administrador vê, como antes.
- Nada de IP nem localização: o user agent basta para distinguir os aparelhos.

## Consequências

Sessões abertas antes da migration aparecem como "desconhecido" até o próximo refresh. O painel só existe na web (o desktop bloqueia rotas admin, S-06).
