# ADR 0006 — Access token preso à sessão
Status: Accepted. Data: 2026-10-18.

Decisão: o access token HMAC carrega o id da refresh session. Logout, rotação e expiração da sessão invalidam esse access token na hora. Outra sessão do mesmo usuário continua válida.

Consequência: cada request autenticado consulta a sessão no banco. Não fica a janela de 15 minutos depois do logout. O segredo continua em `AUTH_SECRET`; não entrou biblioteca JWT.
