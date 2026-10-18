# SPEC — OpenMeet (codinome) v0.1

## Visão
Cliente desktop Windows para salas de reunião persistentes ou temporárias, com áudio, vídeo, compartilhamento de janela/monitor e diagnóstico de qualidade; implantação self-hosted, contas independentes por instância, sem dependência de uma conta global.

## Personas e jornadas
- **Operador:** instala a stack numa VPS, configura domínio/TLS/portas, inicializa administrador e controla inscrições.
- **Moderador:** cria sala, convida usuários, remove participantes, encerra reunião conforme política.
- **Participante:** configura instância, autentica, escolhe sala, entra rapidamente, ajusta dispositivos, câmera, microfone e compartilha tela.

## In scope — MVP
1. Configurar múltiplas URLs de instâncias; identidade e sessão locais por instância (sem federação).
2. Bootstrap seguro de administrador único, inscrição controlada, login, logout, refresh com revogação e recuperação de conta via procedimento administrativo documentado.
3. Salas persistentes, convites com expiração/revogação e lista de participantes; reunião temporária pode ser criada via API sem histórico de chat.
4. Áudio bidirecional, mute de publicação, mute local individual, volume individual, escolha de entrada/saída quando suportada, câmera liga/desliga e alternância de dispositivos.
5. Compartilhar monitor ou janela com consentimento explícito; visualização em destaque e parar compartilhamento com sinal claro.
6. Reconexão, estado de conexão, métricas WebRTC (perda, jitter, RTT quando disponíveis), logs diagnósticos sem conteúdo de mídia.
7. Bandeja do sistema e preferências persistidas localmente; atalhos globais apenas após verificação de conflitos e consentimento.
8. Deploy Docker Compose de um nó, TLS, LiveKit, banco, TURN/STUN conforme topologia e documentação de firewall.
9. Instalador Windows e pipelines CI com verificações de segurança, licenses e artefatos.

## Out of scope — MVP
Mensagens persistentes, federação, apps móveis, macOS/Linux, gravações, transcrição, E2EE, plugins, quadro branco, acesso remoto, múltiplos nós, bots, integrações externas, áudio de sistema durante compartilhamento (investigação separada).

## Requisitos funcionais
- RF-01: Usuário adiciona instância por HTTPS; cliente verifica metadados e não envia credenciais a host inesperado.
- RF-02: Login por instância e persistência de sessão em armazenamento seguro nativo.
- RF-03: Tokens LiveKit são emitidos pelo backend somente após autorização explícita; escopo de sala e TTL reduzido.
- RF-04: Usuário escolhe sala autorizada e entra/sai sem recriar o cliente.
- RF-05: Cada track de microfone/câmera/tela apresenta estado local, remoto e erros visíveis.
- RF-06: Controle individual de volume/mute de recepção é somente local.
- RF-07: Moderador remove participante, revoga convites e vê confirmação operacional; servidores revalidam permissão.
- RF-08: Captura de tela permite selecionar origem e interromper; origem não muda silenciosamente.
- RF-09: Diagnósticos exportáveis com consentimento, sem tokens, senhas, conteúdo audiovisual ou dados pessoais desnecessários.
- RF-10: Ao falhar rede, aplicativo informa reconexão e diferencia falha recuperável de fatal.

## Requisitos não funcionais
- Segredo jamais incluído no repo, logs ou CI; TLS em produção; Argon2id com parâmetros documentados.
- Sem pré-requisito de Node/Rust para o usuário final (runtime WebView2 considerado pela instalação).
- Suporte inicial Windows 10/11 em versões suportadas pelo Tauri/WebView2; matriz de versões testadas explicitamente.
- Teste funcional de cinco participantes simultâneos e reunião contínua de 60 min em ambiente homologado.
- Meta de p95 de entrada <= 5s em rede estável e sessão pronta; reconexão <=15s após queda de 5s, mediante servidor alcançável. São metas, não garantias.
- Monitoramento: logs JSON no backend, requestId/roomId pseudonimizados e healthchecks; retenção configurável.
- Não prometer E2EE no MVP. SRTP/DTLS de transporte não equivale a E2EE entre participantes.

## Aceite do produto
Todos os itens de `docs/ACCEPTANCE.md` marcados PASS com evidência, sem falha crítica de segurança, e POC aprovada no gate G2. Testes não realizados são NOT_RUN, nunca PASS.
