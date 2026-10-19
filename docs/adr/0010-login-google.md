# ADR 0010 — Login com Google
Status: Accepted. Data: 2026-10-19. Aceito para a F09. O login ainda é usuário e senha.

## Contexto
A pessoa quer entrar com a conta Google, além do usuário e senha. Cada instalação continua dona dos próprios usuários. O operador cria o projeto no Google Cloud e guarda as chaves no servidor dele.

Isso é uma integração externa, hoje fora do MVP. Aceitar este ADR libera só o login Google. Não abre outras integrações.

## O que o operador cria
No Google Cloud, um cliente OAuth do tipo aplicativo da Web. A URI de redirecionamento é `https://<domínio-da-api>/api/v1/auth/google/callback`.

As chaves ficam no ambiente do servidor: `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET`. Não entram no Git, no instalador nem no aplicativo. Sem as duas, o botão não aparece. A instância só informa `googleLogin: true` ou `false`. O segredo não sai na resposta.

## Decisão
O aplicativo abre o navegador do sistema. O login do Google não acontece dentro do WebView.

1. O aplicativo pede um início à API. A API guarda um estado e um identificador de espera, por poucos minutos.
2. O navegador vai ao Google.
3. O Google volta para a API. A API confere o estado, troca o código e valida o token: emissor Google, audiência igual ao client id, e-mail verificado.
4. O navegador mostra só "Pode voltar ao OpenMeet". Nenhum token aparece nessa página.
5. O aplicativo busca a sessão uma vez. A espera é consumida. Access token e refresh seguem o mesmo cofre do login por senha.

A pessoa é reconhecida pelo `sub` do Google, que é estável. O e-mail fica guardado, mas não é a chave. A primeira entrada cria um participante, com nome vindo do Google e usuário derivado do e-mail. Não vira administrador e não entra sozinho em servidor nenhum. O convite continua mandatório.

O primeiro administrador continua nascendo pelo token de instalação e pela senha. Login Google não consome esse token.

Usuário desativado não entra. Senha continua válida para quem já tem. Ligar a conta Google a um usuário de senha já existente fica fora.

Se o Google falhar, o login por senha segue.

## Fora deste desenho
Vários provedores, restrição a um domínio Workspace, juntar contas, login dentro do WebView e colocar a chave no aplicativo.

## Consequência
Quando este ADR for aceito, a tela de entrar ganha o botão se o servidor tiver as chaves. Até lá, só usuário e senha.
