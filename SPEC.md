# SPEC — OpenMeet (codinome) v0.1

## Visão
Cliente desktop Windows e cliente web, servido pela própria instância, para salas de reunião persistentes ou temporárias, com áudio, vídeo, compartilhamento de janela/monitor e diagnóstico de qualidade; implantação self-hosted, contas independentes por instância, sem dependência de uma conta global. Uma instância pode ter vários servidores, e cada servidor tem suas salas.

## Personas e jornadas
- **Operador:** instala a stack numa VPS, configura domínio/TLS/portas, inicializa administrador, cria servidores e controla inscrições.
- **Dono ou moderador do servidor:** cria salas, convida para o servidor, remove participantes e encerra reunião conforme política.
- **Participante:** configura instância, autentica, escolhe servidor e sala, entra rapidamente, ajusta dispositivos, câmera, microfone e compartilha tela.

## In scope — MVP
1. Configurar múltiplas URLs de instâncias; identidade e sessão locais por instância (sem federação).
2. Bootstrap seguro de administrador único, inscrição controlada, login, logout, refresh com revogação e recuperação de conta via procedimento administrativo documentado.
3. Salas persistentes, convites com expiração/revogação e lista de participantes; reunião temporária pode ser criada via API sem histórico de chat.
4. Áudio bidirecional, mute de publicação, mute local individual, volume individual, volume de entrada do microfone (0–200%, padrão 100%), escolha de entrada/saída quando suportada, câmera liga/desliga, alternância de dispositivos e blur local opcional do fundo quando o cliente suportar processamento de vídeo.
5. Compartilhar monitor ou janela com consentimento explícito; visualização em destaque e parar compartilhamento com sinal claro.
6. Reconexão, estado de conexão, métricas WebRTC (perda, jitter, RTT quando disponíveis), logs diagnósticos sem conteúdo de mídia.
7. Bandeja do sistema e preferências persistidas localmente; atalhos globais apenas após verificação de conflitos e consentimento.
8. Deploy Docker Compose de um nó, TLS, LiveKit, banco, TURN/STUN conforme topologia e documentação de firewall.
9. Instalador Windows e pipelines CI com verificações de segurança, licenses e artefatos.
10. Vários servidores dentro de uma instância, com salas pertencentes a um servidor. ADR 0007. Não implementado.
11. Tela em três colunas, card por pessoa, card por compartilhamento, destaque, grade, fixar e tela cheia. ADR 0009. Não implementado.
12. Presença nas salas e anel de quem fala. ADR 0011. Não implementado.
13. Convite do servidor por link `openmeet://`. ADR 0012. Não implementado.
14. Ensurdecer o áudio remoto só neste PC. ADR 0013. Não implementado.
15. Áudio do PC opcional no compartilhamento, desligado por padrão. ADR 0008. Não implementado.
16. Login com Google quando o servidor tem as chaves. ADR 0010. Não implementado.
17. Cliente web em `https://{API_DOMAIN}/`, mesmo frontend do `.exe`, sessão em cookie `HttpOnly`, para Chrome, Edge e Firefox atuais em computador. Sem bandeja, atalhos globais, notificação do sistema nem cofre do Windows. ADR 0014. Não implementado.
18. Lista dos membros de cada servidor com presença online, ausente e desconectada; invisibilidade opcional conforme política do dono. ADR 0017.
19. Ícone do servidor, avatar da conta e, em cada servidor, apelido e avatar próprios. ADR 0019.
20. Efeitos de voz locais no microfone, ouvidos por toda a sala. ADR 0020. Não implementado.

## Out of scope — MVP
Mensagens persistentes, federação, apps móveis, macOS/Linux, gravações, transcrição, E2EE, plugins, quadro branco, acesso remoto, múltiplos nós, bots, integrações além do login Google, captura nativa do áudio do Windows, juntar conta Google a uma conta de senha e link que entra direto numa sala.

## Requisitos funcionais
- RF-01: Usuário adiciona instância por HTTPS; cliente verifica metadados e não envia credenciais a host inesperado.
- RF-02: Login por instância e persistência de sessão em armazenamento seguro: cofre do Windows no `.exe`, cookie `HttpOnly; Secure; SameSite=Strict` na web. Nenhum dos dois expõe token ao JavaScript.
- RF-03: Tokens LiveKit são emitidos pelo backend somente após autorização explícita; escopo de sala e TTL reduzido.
- RF-04: Usuário escolhe sala autorizada e entra/sai sem recriar o cliente.
- RF-05: Cada track de microfone/câmera/tela apresenta estado local, remoto e erros visíveis.
- RF-06: Controle individual de volume/mute de recepção é somente local.
- RF-07: Moderador remove participante, revoga convites e vê confirmação operacional; servidores revalidam permissão.
- RF-08: Captura de tela permite selecionar origem e interromper; origem não muda silenciosamente.
- RF-09: Diagnósticos exportáveis com consentimento, sem tokens, senhas, conteúdo audiovisual ou dados pessoais desnecessários.
- RF-10: Ao falhar rede, aplicativo informa reconexão e diferencia falha recuperável de fatal.
- RF-11: Uma conta entra na API e só vê os servidores de que é membro. A sala pertence a um servidor. O administrador da instância cria o servidor e vira dono. ADR 0007.
- RF-12: A janela tem barra de servidores, sidebar de salas e área de cards. Dá para ver outro servidor sem sair da chamada. ADR 0009.
- RF-13: Cada pessoa tem um card, com ou sem câmera. Cada compartilhamento tem o seu. Há destaque, grade, fixar e tela cheia. ADR 0009.
- RF-14: A sidebar mostra quem está em cada sala. O anel verde marca quem fala na sala atual. A ocupação não fica gravada no Postgres. ADR 0011.
- RF-15: O convite copiado é um link da instância. O código não vai para outra API. Aceitar entra no servidor e não entra sozinho numa sala. ADR 0012.
- RF-16: Ensurdecer corta o áudio remoto neste PC, guarda o volume de cada card e não mexe no microfone nem avisa o servidor. ADR 0013.
- RF-17: "Incluir áudio do PC" nasce desligado. Se a origem não entregar a faixa, a imagem continua e a tela avisa. ADR 0008.
- RF-18: Login Google abre o navegador do sistema. As chaves ficam no servidor. Sem elas, o botão não aparece. Não cria o administrador. ADR 0010.
- RF-19: A instância serve o cliente web na mesma origem da API, sem escolher outra instância. Cookie só autentica com `Origin` da instância e `X-OpenMeet-Web: 1`. O que o navegador não suporta (áudio do PC, saída de som) some da tela em vez de falhar. ADR 0014.
- RF-20: O usuário pode desfocar o fundo da câmera localmente. Modelo e runtime ficam no bundle da aplicação; clientes incompatíveis mostram a indisponibilidade e continuam enviando câmera sem efeito. ADR 0016.
- RF-21: Cada servidor lista seus membros com presença efêmera. Atividade recente fica online, ausência fica ausente e heartbeat expirado fica desconectado. O dono decide se aceita invisibilidade e se dono/moderadores identificam invisíveis; para os demais, invisível aparece desconectado. ADR 0017.
- RF-22: A navegação do servidor separa salas, membros e administração. Salas e sua criação ficam na coluna de canais; membros ficam em painel direito recolhível; convite e política de presença ficam nas configurações do servidor; criar ou entrar por convite parte de Adicionar servidor. Nomes Unicode devem atravessar web e ponte nativa em UTF-8.
- RF-23: O dono troca o ícone do servidor. Cada membro troca só o próprio apelido e avatar naquele servidor; sem eles vale o perfil da conta. Imagem só PNG, JPEG ou WebP, validada pelo conteúdo, até 256 KB e 512 px, guardada no Postgres e lida só por quem divide um servidor com ela. ADR 0019.
- RF-24: O usuário escolhe um efeito de voz (Robô, Rádio, Telefone, Eco, Caverna, Grave, Esquilo, Monstro) aplicado no aparelho antes de publicar o microfone. Nasce desligado em toda entrada, troca sem republicar, preserva o cancelamento de eco e não afeta o áudio da tela. "Ouvir minha voz" toca só localmente. Sem `AudioWorklet`, os efeitos de pitch somem. ADR 0020.

## Requisitos não funcionais
- Segredo jamais incluído no repo, logs ou CI; TLS em produção; Argon2id com parâmetros documentados.
- Sem pré-requisito de Node/Rust para o usuário final (runtime WebView2 considerado pela instalação).
- Suporte inicial Windows 10/11 em versões suportadas pelo Tauri/WebView2; matriz de versões testadas explicitamente. Web: Chrome, Edge e Firefox atuais em computador; responsividade mínima para navegador de celular (F12-08), mídia em aparelho físico ainda não validada.
- Teste funcional de cinco participantes simultâneos e reunião contínua de 60 min em ambiente homologado.
- Meta de p95 de entrada <= 5s em rede estável e sessão pronta; reconexão <=15s após queda de 5s, mediante servidor alcançável. São metas, não garantias.
- Monitoramento: logs JSON no backend, requestId/roomId pseudonimizados e healthchecks; retenção configurável.
- Não prometer E2EE no MVP. SRTP/DTLS de transporte não equivale a E2EE entre participantes.

## Aceite do produto
Todos os itens de `docs/ACCEPTANCE.md` marcados PASS com evidência, sem falha crítica de segurança, e POC aprovada no gate G2. Testes não realizados são NOT_RUN, nunca PASS.
