# ADR 0012 — Convite por link
Status: Accepted. Data: 2026-10-19. Aceito para a F09. O convite ainda é o código colado.

## Contexto
O convite de hoje é um código colado na tela. O ADR 0007 muda o convite para o servidor. Este desenho troca o código colado por um link que abre o aplicativo.

## Decisão
Quem cria o convite copia um link `openmeet://convite?host=<domínio-da-api>&code=<código>`. O código continua secreto. O banco guarda só o hash. Expiração, limite de uso e revogação seguem as regras do convite.

O instalador registra o protocolo `openmeet://`. O clique abre o aplicativo.

O host do link é a instância. O código só é enviado a essa API. Se o aplicativo estava em outra instância, ele troca antes de aceitar. Sem sessão, o código fica na memória até o login e só então é aceito. Aceitar torna a pessoa participante do servidor. Não entra sozinho numa sala.

Uma página `https://<domínio-da-api>/convite/<código>` existe para quem abre o link no navegador. Ela só pede para voltar ao OpenMeet e repete o protocolo. Não mostra token de sessão. O log dessa rota não grava o código.

Colar o código na tela continua válido para o mesmo convite.

## Fora deste desenho
Link que entra direto numa sala, convite de amigo e página que cria conta.

## Consequência
Quando este ADR for aceito, o convite copiado é o link. Até lá, a tela continua com o código.
