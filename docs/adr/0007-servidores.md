# ADR 0007 — Servidores dentro de uma instância
Status: Accepted. Data: 2026-10-19. Aceito para a F09. O código ainda não tem servidores.

## Contexto
O dono de uma VPS quer uma API e um banco, com vários servidores: trabalho, família, RPG. Cada servidor tem várias salas. A pessoa entra uma vez nessa API e só vê os servidores de que participa.

O ADR 0003 continua valendo. Outra VPS é outra instância. Não há conta global nem federação. Servidor aqui é uma comunidade dentro da instância, não uma segunda implantação.

O áudio do compartilhamento fica fora. A captura de sistema continua prova separada.

## Decisão
Uma instância tem muitos servidores. A sala deixa de ser solta e passa a pertencer a um servidor.

Quem entra vê, na lateral, os servidores de que é membro e, ao escolher um, as salas dele. A disposição dessa tela está no ADR 0009. Não há canal de texto.

Só o administrador da instância cria servidor. Na criação, ele vira o dono. Dono e moderador do servidor criam salas e convites. O administrador não enxerga um servidor do qual não seja membro.

O convite é do servidor. Tem expiração, limite de uso e revogação, como o convite de sala de hoje. O link que abre o aplicativo está no ADR 0012. Aceitar o convite torna a pessoa participante daquele servidor. Entrar numa sala exige ser membro do servidor. Todo membro vê todas as salas do servidor.

O identificador da sala é único dentro do servidor. Dois servidores podem ter uma sala `geral`. A chamada no LiveKit usa o id da sala, não o identificador, para os nomes não colidirem.

Os papéis do servidor são `owner`, `moderator` e `participant`. O papel da instância (`admin`, `moderator`, `participant`) continua só para a instalação. Remover alguém do servidor tira o acesso às salas dele. A associação por sala deixa de ser a porta de entrada.

## Migração
A migração cria um servidor `Geral`. As salas atuais entram nele. Cada usuário que participa de alguma sala vira membro desse servidor. O administrador da instância vira o dono. Os convites de sala existentes são revogados.

## Fora deste desenho
Mensagens, amigos, categorias, sala privada, vários donos, transferência de dono, federação e áudio do sistema.

## Consequência
Quando este ADR for aceito, a SPEC deixa de tratar a sala como a única lista da instância. Até lá, o código permanece com a lista única.
